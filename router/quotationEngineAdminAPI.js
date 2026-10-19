"use strict";

const express = require("express");
const pgPool = require("../db");
const { verifyAdminToken } = require("../authToken");

const router = express.Router();
const text = (value) => String(value ?? "").trim();
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (res, error) => {
  const status = error.status || (error.code === "23505" ? 409 : 500);
  if (status >= 500) console.error("[admin/quotation-engine]", error);
  return res.status(status).json({ error: error.message || "Quotation engine request failed." });
};

async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = verifyAdminToken(token);
  if (!claims) return res.status(401).json({ error: "Please log in again." });

  try {
    const result = await pgPool.query(
      `SELECT user_id, user_email, user_name, user_role
       FROM "user"
       WHERE user_id = $1 AND LOWER(user_email) = $2 AND user_active = 1
       LIMIT 1`,
      [claims.user_id, claims.email],
    );
    const user = result.rows[0];
    const role = String(user?.user_role || "").replace(/[\s_-]/g, "").toLowerCase();
    if (!user || !["admin", "superadmin"].includes(role)) {
      return res.status(403).json({ error: "Admin or SuperAdmin access required." });
    }
    req.adminUser = user;
    return next();
  } catch (error) {
    console.error("[admin/quotation-engine/auth]", error);
    return res.status(500).json({ error: "Unable to verify admin access." });
  }
}

router.use(requireAdmin);

function positiveId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error(`${label} must be a positive integer.`), { status: 400 });
  return id;
}

async function inTransaction(work) {
  const client = await pgPool.connect();
  let begun = false;
  try {
    await client.query("BEGIN");
    begun = true;
    const result = await work(client);
    await client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[admin/quotation-engine/rollback]", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client, req, action, identifier, summary, payload) {
  const account = req.adminUser.user_email || req.adminUser.user_name || "Unknown";
  await client.query(
    `INSERT INTO quotation_rate_audit_log
       (account, action, identifier, change_summary, data_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [account, action, identifier, summary, JSON.stringify(payload || {})],
  );
}

async function assertDraft(client, versionId) {
  const result = await client.query(
    "SELECT status FROM quotation_rate_versions WHERE version_id = $1 FOR UPDATE",
    [versionId],
  );
  if (!result.rows.length) throw Object.assign(new Error("Rate version not found."), { status: 404 });
  if (result.rows[0].status !== "draft") {
    throw Object.assign(new Error("Only draft versions can be edited. Create a draft first."), { status: 409 });
  }
}

async function copyRateVersion(client, fromId, label, notes, createdBy) {
  const source = await client.query(
    "SELECT version_id FROM quotation_rate_versions WHERE version_id = $1",
    [fromId],
  );
  if (!source.rows.length) throw Object.assign(new Error("Source version not found."), { status: 404 });
  const inserted = await client.query(
    `INSERT INTO quotation_rate_versions (version_label, status, notes, created_by)
     VALUES ($1, 'draft', $2, $3) RETURNING version_id`,
    [label, notes, createdBy],
  );
  const to = inserted.rows[0].version_id;
  await client.query(
    `INSERT INTO quotation_parameters
       (version_id,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order,updated_by)
     SELECT $1,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order,$3
     FROM quotation_parameters WHERE version_id = $2`,
    [to, fromId, createdBy],
  );
  await client.query(
    `INSERT INTO quotation_cost_components
       (version_id,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order)
     SELECT $1,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order
     FROM quotation_cost_components WHERE version_id = $2`,
    [to, fromId],
  );
  await client.query(
    `INSERT INTO quotation_tier_sets
       (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description)
     SELECT $1,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description
     FROM quotation_tier_sets WHERE version_id = $2`,
    [to, fromId],
  );
  await client.query(
    `INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3)
     SELECT target_set.tier_set_id,tier_row.range_min,tier_row.range_max,tier_row.value1,tier_row.value2,tier_row.value3
     FROM quotation_tier_rows tier_row
     JOIN quotation_tier_sets source_set ON source_set.tier_set_id = tier_row.tier_set_id AND source_set.version_id = $1
     JOIN quotation_tier_sets target_set ON target_set.set_key = source_set.set_key AND target_set.version_id = $2`,
    [fromId, to],
  );
  await client.query(
    `INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema)
     SELECT $1,group_key,label,attribute_schema FROM quotation_option_groups WHERE version_id = $2`,
    [to, fromId],
  );
  await client.query(
    `INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order,is_active)
     SELECT destination_group.group_id,rate_option.option_key,rate_option.label,rate_option.attributes,rate_option.sort_order,rate_option.is_active
     FROM quotation_options rate_option
     JOIN quotation_option_groups source_group ON source_group.group_id = rate_option.group_id AND source_group.version_id = $1
     JOIN quotation_option_groups destination_group ON destination_group.group_key = source_group.group_key AND destination_group.version_id = $2`,
    [fromId, to],
  );
  return to;
}

function normalizeTierRow(row) {
  return {
    range_min: Number(row.range_min),
    range_max: row.range_max == null ? null : Number(row.range_max),
    value1: Number(row.value1),
    value2: row.value2 == null ? null : Number(row.value2),
    value3: row.value3 == null ? null : Number(row.value3),
  };
}

function tierValue(value) {
  return value == null || value === "" ? null : Number(value);
}

function sameValue(left, right) {
  return left == null || right == null
    ? left == null && right == null
    : Number(left) === Number(right);
}

router.get("/rates", async (req, res) => {
  try {
    const requestedId = req.query.version_id ? positiveId(req.query.version_id, "Version ID") : null;
    const versionsResult = await pgPool.query(
      "SELECT * FROM quotation_rate_versions ORDER BY version_id DESC",
    );
    const versions = versionsResult.rows;
    const active = versions.find((version) => version.status === "active");
    if (!active) throw Object.assign(new Error("No active quotation rate version found."), { status: 503 });
    const selectedId = requestedId || active.version_id;
    if (!versions.some((version) => Number(version.version_id) === Number(selectedId))) {
      throw Object.assign(new Error("Rate version not found."), { status: 404 });
    }
    const [parameters, tierSets, groups, components] = await Promise.all([
      pgPool.query("SELECT * FROM quotation_parameters WHERE version_id = $1 ORDER BY group_code, sort_order", [selectedId]),
      pgPool.query("SELECT * FROM quotation_tier_sets WHERE version_id = $1 ORDER BY set_key", [selectedId]),
      pgPool.query("SELECT * FROM quotation_option_groups WHERE version_id = $1 ORDER BY group_key", [selectedId]),
      pgPool.query("SELECT * FROM quotation_cost_components WHERE version_id = $1 ORDER BY sort_order", [selectedId]),
    ]);
    res.json({
      versions, parameters: parameters.rows, tierSets: tierSets.rows, groups: groups.rows,
      components: components.rows, activeVersionId: active.version_id, selectedVersionId: selectedId,
    });
  } catch (error) { fail(res, error); }
});

router.get("/tier-sets/:id/rows", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Tier set ID");
    const result = await pgPool.query(
      "SELECT * FROM quotation_tier_rows WHERE tier_set_id = $1 ORDER BY range_min",
      [id],
    );
    res.json({ rows: result.rows });
  } catch (error) { fail(res, error); }
});

router.get("/option-groups/:id/options", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Option group ID");
    const result = await pgPool.query(
      "SELECT * FROM quotation_options WHERE group_id = $1 ORDER BY sort_order",
      [id],
    );
    res.json({ options: result.rows });
  } catch (error) { fail(res, error); }
});

router.get("/history/:identifier", async (req, res) => {
  try {
    const result = await pgPool.query(
      `SELECT audit_id, event_timestamp, account, action, identifier, change_summary, data_payload
       FROM quotation_rate_audit_log WHERE identifier = $1
       ORDER BY event_timestamp DESC, audit_id DESC LIMIT 100`,
      [req.params.identifier],
    );
    res.json({ history: result.rows });
  } catch (error) { fail(res, error); }
});

router.put("/parameters/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Parameter ID");
    const result = await inTransaction(async (client) => {
      const selected = await client.query("SELECT * FROM quotation_parameters WHERE param_id = $1 FOR UPDATE", [id]);
      const parameter = selected.rows[0];
      if (!parameter) throw Object.assign(new Error("Parameter not found."), { status: 404 });
      await assertDraft(client, parameter.version_id);
      if (Number(parameter.is_locked)) throw Object.assign(new Error("This parameter is locked."), { status: 400 });
      if (!Object.prototype.hasOwnProperty.call(req.body, "value")) {
        throw Object.assign(new Error("A parameter value is required."), { status: 400 });
      }
      let beforeValue;
      let afterValue;
      if (parameter.value_type === "number") {
        const number = req.body.value === "" || req.body.value == null ? NaN : Number(req.body.value);
        if (!Number.isFinite(number)) throw Object.assign(new Error("Value must be a number."), { status: 400 });
        if ((parameter.min_allowed != null && number < Number(parameter.min_allowed)) ||
          (parameter.max_allowed != null && number > Number(parameter.max_allowed))) {
          throw Object.assign(new Error("Value outside allowed range."), { status: 400 });
        }
        beforeValue = parameter.value_number;
        afterValue = number;
        await client.query(
          "UPDATE quotation_parameters SET value_number = $1, value_text = NULL, updated_by = $2 WHERE param_id = $3",
          [number, req.adminUser.user_email, id],
        );
      } else if (parameter.value_type === "boolean") {
        if (![true, false, 1, 0, "1", "0"].includes(req.body.value)) {
          throw Object.assign(new Error("Value must be true or false."), { status: 400 });
        }
        beforeValue = Number(parameter.value_number) !== 0;
        afterValue = req.body.value === true || req.body.value === 1 || req.body.value === "1";
        await client.query(
          "UPDATE quotation_parameters SET value_number = $1, value_text = NULL, updated_by = $2 WHERE param_id = $3",
          [afterValue ? 1 : 0, req.adminUser.user_email, id],
        );
      } else {
        beforeValue = parameter.value_text;
        afterValue = String(req.body.value);
        await client.query(
          "UPDATE quotation_parameters SET value_text = $1, value_number = NULL, updated_by = $2 WHERE param_id = $3",
          [afterValue, req.adminUser.user_email, id],
        );
      }
      const changed = parameter.value_type === "text"
        ? beforeValue !== afterValue
        : !sameValue(beforeValue, afterValue);
      if (changed) {
        await audit(client, req, "UPDATE", parameter.param_key, `${parameter.label}: ${beforeValue} → ${afterValue}`, {
          kind: "parameter", version_id: parameter.version_id, parameter_key: parameter.param_key, beforeValue, afterValue,
        });
      }
      return { ok: true };
    });
    res.json(result);
  } catch (error) { fail(res, error); }
});

router.put("/tier-sets/:id/rows", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Tier set ID");
    if (!Array.isArray(req.body.rows) || req.body.rows.some((row) => !isRecord(row))) {
      throw Object.assign(new Error("rows must be an array of tier row objects."), { status: 400 });
    }
    const rows = req.body.rows.map((row) => ({
      range_min: row.range_min === "" || row.range_min == null ? NaN : Number(row.range_min),
      range_max: tierValue(row.range_max),
      value1: row.value1 === "" || row.value1 == null ? NaN : Number(row.value1),
      value2: tierValue(row.value2),
      value3: tierValue(row.value3),
    }));
    if (!rows.length || rows.some((row) => !Number.isFinite(row.range_min) || !Number.isFinite(row.value1) ||
      row.range_max !== null && (!Number.isFinite(row.range_max) || row.range_max < row.range_min) ||
      [row.value2, row.value3].some((value) => value !== null && !Number.isFinite(value)))) {
      throw Object.assign(new Error("Every tier row needs valid numeric range and value fields."), { status: 400 });
    }
    if (new Set(rows.map((row) => row.range_min)).size !== rows.length) {
      throw Object.assign(new Error("Duplicate range_min values are not allowed."), { status: 400 });
    }
    await inTransaction(async (client) => {
      const selected = await client.query(
        `SELECT tier_set.*, rate_version.status FROM quotation_tier_sets tier_set
         JOIN quotation_rate_versions rate_version ON rate_version.version_id = tier_set.version_id
         WHERE tier_set.tier_set_id = $1 FOR UPDATE`,
        [id],
      );
      const set = selected.rows[0];
      if (!set) throw Object.assign(new Error("Tier set not found."), { status: 404 });
      await assertDraft(client, set.version_id);
      const priorResult = await client.query(
        "SELECT * FROM quotation_tier_rows WHERE tier_set_id = $1 ORDER BY range_min FOR UPDATE",
        [id],
      );
      const oldRows = priorResult.rows.map(normalizeTierRow);
      const oldByMin = new Map(oldRows.map((row) => [String(row.range_min), row]));
      const newByMin = new Map(rows.map((row) => [String(row.range_min), row]));
      await client.query("DELETE FROM quotation_tier_rows WHERE tier_set_id = $1", [id]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, row.range_min, row.range_max, row.value1, row.value2, row.value3],
        );
      }

      const fields = ["range_max", "value1", "value2", "value3"];
      let changed = 0;
      for (const row of rows) {
        const before = oldByMin.get(String(row.range_min));
        if (!before) {
          changed += 1;
          const identifier = `tier:${set.set_key}:${row.range_min}:row`;
          await audit(client, req, "CREATE", identifier, `Tier row ${row.range_min} added to ${set.label}`, {
            kind: "tier_row", version_id: set.version_id, set_key: set.set_key,
            range_min: row.range_min, before: null, after: row,
          });
          continue;
        }
        for (const field of fields) {
          if (sameValue(before[field], row[field])) continue;
          changed += 1;
          const identifier = `tier:${set.set_key}:${row.range_min}:${field}`;
          await audit(client, req, "UPDATE", identifier, `${set.set_key} ${row.range_min} ${field}: ${before[field]} → ${row[field]}`, {
            kind: "tier", version_id: set.version_id, set_key: set.set_key,
            range_min: row.range_min, field, beforeValue: before[field], afterValue: row[field],
          });
        }
      }
      for (const row of oldRows) {
        if (newByMin.has(String(row.range_min))) continue;
        changed += 1;
        const identifier = `tier:${set.set_key}:${row.range_min}:row`;
        await audit(client, req, "DELETE", identifier, `Tier row ${row.range_min} removed from ${set.label}`, {
          kind: "tier_row", version_id: set.version_id, set_key: set.set_key,
          range_min: row.range_min, before: row, after: null,
        });
      }
      if (changed) {
        await audit(client, req, "UPDATE", set.set_key, `Tier table ${set.label} updated (${changed} changes)`, {
          kind: "tier_table", version_id: set.version_id, set_key: set.set_key, changed,
        });
      }
    });
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

router.put("/options/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Option ID");
    await inTransaction(async (client) => {
      const selected = await client.query(
        `SELECT rate_option.*, option_group.version_id, option_group.group_key FROM quotation_options rate_option
         JOIN quotation_option_groups option_group ON option_group.group_id = rate_option.group_id
         WHERE rate_option.option_id = $1 FOR UPDATE`,
        [id],
      );
      const option = selected.rows[0];
      if (!option) throw Object.assign(new Error("Option not found."), { status: 404 });
      await assertDraft(client, option.version_id);
      if (req.body.label !== undefined && !text(req.body.label)) {
        throw Object.assign(new Error("Option label cannot be empty."), { status: 400 });
      }
      if (req.body.attributes !== undefined && !isRecord(req.body.attributes)) {
        throw Object.assign(new Error("Option attributes must be a JSON object."), { status: 400 });
      }
      if (req.body.sort_order !== undefined && !Number.isInteger(Number(req.body.sort_order))) {
        throw Object.assign(new Error("Option sort order must be a whole number."), { status: 400 });
      }
      if (req.body.is_active !== undefined && ![true, false, 1, 0, "1", "0"].includes(req.body.is_active)) {
        throw Object.assign(new Error("Option active state must be true or false."), { status: 400 });
      }
      const before = {
        label: option.label, attributes: option.attributes,
        is_active: Number(option.is_active) !== 0, sort_order: Number(option.sort_order),
      };
      const after = {
        label: req.body.label === undefined ? option.label : text(req.body.label),
        attributes: req.body.attributes === undefined ? option.attributes : { ...option.attributes, ...req.body.attributes },
        is_active: req.body.is_active === undefined
          ? Number(option.is_active) !== 0
          : req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === "1",
        sort_order: req.body.sort_order === undefined ? Number(option.sort_order) : Number(req.body.sort_order),
      };
      await client.query(
        `UPDATE quotation_options SET label = $1, attributes = $2::jsonb, is_active = $3, sort_order = $4
         WHERE option_id = $5`,
        [after.label, JSON.stringify(after.attributes), after.is_active ? 1 : 0, after.sort_order, id],
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await audit(client, req, "UPDATE", `option:${option.group_key}:${option.option_key}`, `Option ${option.option_key} updated`, {
          kind: "option", version_id: option.version_id, group_key: option.group_key,
          option_key: option.option_key, before, after,
        });
      }
    });
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

router.post("/option-groups/:id/options", async (req, res) => {
  try {
    const groupId = positiveId(req.params.id, "Option group ID");
    if (!text(req.body.option_key) || !text(req.body.label)) {
      throw Object.assign(new Error("option_key and label are required."), { status: 400 });
    }
    const attributes = req.body.attributes === undefined ? {} : req.body.attributes;
    if (!isRecord(attributes)) throw Object.assign(new Error("Option attributes must be a JSON object."), { status: 400 });
    const sortOrder = req.body.sort_order === undefined ? 0 : Number(req.body.sort_order);
    if (!Number.isInteger(sortOrder)) throw Object.assign(new Error("Option sort order must be a whole number."), { status: 400 });
    const optionKey = text(req.body.option_key);
    const label = text(req.body.label);
    await inTransaction(async (client) => {
      const selected = await client.query("SELECT * FROM quotation_option_groups WHERE group_id = $1 FOR UPDATE", [groupId]);
      const group = selected.rows[0];
      if (!group) throw Object.assign(new Error("Option group not found."), { status: 404 });
      await assertDraft(client, group.version_id);
      await client.query(
        `INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [groupId, optionKey, label, JSON.stringify(attributes), sortOrder],
      );
      await audit(client, req, "CREATE", `option:${group.group_key}:${optionKey}`, `Option ${optionKey} added to ${group.group_key}`, {
        kind: "option", version_id: group.version_id, group_key: group.group_key,
        option_key: optionKey, before: null,
        after: { label, attributes, is_active: true, sort_order: sortOrder },
      });
    });
    res.status(201).json({ ok: true });
  } catch (error) { fail(res, error); }
});

router.delete("/options/:id", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Option ID");
    await inTransaction(async (client) => {
      const selected = await client.query(
        `SELECT rate_option.*, option_group.version_id, option_group.group_key FROM quotation_options rate_option
         JOIN quotation_option_groups option_group ON option_group.group_id = rate_option.group_id
         WHERE rate_option.option_id = $1 FOR UPDATE`,
        [id],
      );
      const option = selected.rows[0];
      if (!option) throw Object.assign(new Error("Option not found."), { status: 404 });
      await assertDraft(client, option.version_id);
      await client.query("DELETE FROM quotation_options WHERE option_id = $1", [id]);
      await audit(client, req, "DELETE", `option:${option.group_key}:${option.option_key}`, `Option ${option.option_key} deleted`, {
        kind: "option", version_id: option.version_id, group_key: option.group_key,
        option_key: option.option_key,
        before: {
          label: option.label, attributes: option.attributes,
          is_active: Number(option.is_active) !== 0, sort_order: Number(option.sort_order),
        },
        after: null,
      });
    });
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

router.post("/versions/clone", async (req, res) => {
  try {
    let fromId;
    if (req.body.from_version_id === undefined) {
      const active = await pgPool.query(
        "SELECT version_id FROM quotation_rate_versions WHERE status = 'active' ORDER BY published_at DESC NULLS LAST, version_id DESC LIMIT 1",
      );
      if (!active.rows.length) throw Object.assign(new Error("No active quotation rate version found."), { status: 503 });
      fromId = positiveId(active.rows[0].version_id, "Source version ID");
    } else fromId = positiveId(req.body.from_version_id, "Source version ID");
    const label = text(req.body.label === undefined ? "New rate card draft" : req.body.label).slice(0, 100);
    if (!label) throw Object.assign(new Error("A version label is required."), { status: 400 });
    const createdBy = req.adminUser.user_email;
    const id = await inTransaction(async (client) => {
      const versionId = await copyRateVersion(client, fromId, label, `Cloned from version ${fromId}`, createdBy);
      await audit(client, req, "CREATE", `version:${versionId}`, `Rate version ${versionId} cloned from ${fromId}`, {
        from: fromId, to: versionId,
      });
      return versionId;
    });
    res.status(201).json({ version_id: id });
  } catch (error) { fail(res, error); }
});

router.post("/versions/:id/publish", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Version ID");
    await inTransaction(async (client) => {
      const selected = await client.query(
        "SELECT status FROM quotation_rate_versions WHERE version_id = $1 FOR UPDATE",
        [id],
      );
      if (!selected.rows.length) throw Object.assign(new Error("Rate version not found."), { status: 404 });
      if (selected.rows[0].status !== "draft") throw Object.assign(new Error("Only a draft can be published."), { status: 409 });
      await client.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
      await client.query(
        "UPDATE quotation_rate_versions SET status = 'active', published_at = CURRENT_TIMESTAMP WHERE version_id = $1",
        [id],
      );
      await audit(client, req, "PUBLISH", `version:${id}`, `Rate version ${id} published`, { version_id: id });
    });
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

router.post("/versions/:id/restore", async (req, res) => {
  try {
    const id = positiveId(req.params.id, "Version ID");
    await inTransaction(async (client) => {
      const targetResult = await client.query(
        "SELECT version_id, version_label, status FROM quotation_rate_versions WHERE version_id = $1 FOR UPDATE",
        [id],
      );
      const target = targetResult.rows[0];
      if (!target) throw Object.assign(new Error("Rate version not found."), { status: 404 });
      if (target.status === "draft") throw Object.assign(new Error("Publish the draft before restoring it."), { status: 409 });
      const currentResult = await client.query(
        "SELECT version_id FROM quotation_rate_versions WHERE status = 'active' FOR UPDATE",
      );
      const currentId = currentResult.rows[0]?.version_id;
      if (Number(currentId) === id) return;
      await client.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
      await client.query("UPDATE quotation_rate_versions SET status = 'active' WHERE version_id = $1", [id]);
      await audit(client, req, "RESTORE", `version:${id}`, `Active rate version changed from ${currentId || "none"} to ${id}`, {
        from: currentId || null, to: id, label: target.version_label,
      });
    });
    res.json({ ok: true, active_version_id: id });
  } catch (error) { fail(res, error); }
});

router.post("/history/:auditId/revert", async (req, res) => {
  try {
    const auditId = positiveId(req.params.auditId, "Audit ID");
    const historyResult = await pgPool.query(
      `SELECT audit_id, identifier, data_payload FROM quotation_rate_audit_log WHERE audit_id = $1`,
      [auditId],
    );
    const history = historyResult.rows[0];
    if (!history) throw Object.assign(new Error("Rate history entry not found."), { status: 404 });
    const payload = history.data_payload || {};
    if (!["parameter", "tier", "tier_row", "option"].includes(payload.kind)) {
      throw Object.assign(new Error("This history record cannot be reverted individually."), { status: 409 });
    }
    const versionId = await inTransaction(async (client) => {
      const active = await client.query(
        "SELECT version_id FROM quotation_rate_versions WHERE status = 'active' ORDER BY published_at DESC NULLS LAST, version_id DESC LIMIT 1 FOR UPDATE",
      );
      if (!active.rows.length) throw Object.assign(new Error("No active rate version found."), { status: 409 });
      const next = await copyRateVersion(
        client, active.rows[0].version_id, `Rate version revert ${auditId}`,
        `Reverted ${history.identifier} using audit entry ${auditId}`, req.adminUser.user_email,
      );
      let change;
      if (payload.kind === "parameter") {
        const selected = await client.query(
          "SELECT * FROM quotation_parameters WHERE version_id = $1 AND param_key = $2 FOR UPDATE",
          [next, payload.parameter_key],
        );
        const parameter = selected.rows[0];
        if (!parameter) throw Object.assign(new Error("Parameter is not present in the active version."), { status: 409 });
        if (Number(parameter.is_locked)) throw Object.assign(new Error("This parameter is locked."), { status: 400 });
        const beforeValue = parameter.value_type === "number"
          ? parameter.value_number
          : parameter.value_type === "boolean"
            ? Number(parameter.value_number) !== 0
            : parameter.value_text;
        const value = payload.beforeValue;
        if (parameter.value_type === "number") {
          const number = Number(value);
          if (!Number.isFinite(number) ||
            parameter.min_allowed != null && number < Number(parameter.min_allowed) ||
            parameter.max_allowed != null && number > Number(parameter.max_allowed)) {
            throw Object.assign(new Error("Historical value is outside the parameter's allowed range."), { status: 400 });
          }
          await client.query(
            "UPDATE quotation_parameters SET value_number = $1, value_text = NULL, updated_by = $2 WHERE param_id = $3",
            [number, req.adminUser.user_email, parameter.param_id],
          );
        } else if (parameter.value_type === "boolean") {
          await client.query(
            "UPDATE quotation_parameters SET value_number = $1, value_text = NULL, updated_by = $2 WHERE param_id = $3",
            [value ? 1 : 0, req.adminUser.user_email, parameter.param_id],
          );
        } else {
          await client.query(
            "UPDATE quotation_parameters SET value_text = $1, value_number = NULL, updated_by = $2 WHERE param_id = $3",
            [String(value ?? ""), req.adminUser.user_email, parameter.param_id],
          );
        }
        change = { kind: "parameter", version_id: next, parameter_key: payload.parameter_key, beforeValue, afterValue: value };
      } else if (payload.kind === "tier") {
        if (!["range_max", "value1", "value2", "value3"].includes(payload.field)) {
          throw Object.assign(new Error("Invalid tier field in history entry."), { status: 400 });
        }
        const setResult = await client.query(
          "SELECT tier_set_id FROM quotation_tier_sets WHERE version_id = $1 AND set_key = $2",
          [next, payload.set_key],
        );
        const set = setResult.rows[0];
        if (!set) throw Object.assign(new Error("Tier set is not present in the active version."), { status: 409 });
        const rowResult = await client.query(
          `SELECT ${payload.field} AS value FROM quotation_tier_rows WHERE tier_set_id = $1 AND range_min = $2 FOR UPDATE`,
          [set.tier_set_id, payload.range_min],
        );
        if (!rowResult.rows.length) throw Object.assign(new Error("Tier row is not present in the active version."), { status: 409 });
        await client.query(
          `UPDATE quotation_tier_rows SET ${payload.field} = $1 WHERE tier_set_id = $2 AND range_min = $3`,
          [payload.beforeValue, set.tier_set_id, payload.range_min],
        );
        change = {
          kind: "tier", version_id: next, set_key: payload.set_key, range_min: payload.range_min,
          field: payload.field, beforeValue: rowResult.rows[0].value, afterValue: payload.beforeValue,
        };
      } else if (payload.kind === "tier_row") {
        const setResult = await client.query(
          "SELECT tier_set_id FROM quotation_tier_sets WHERE version_id = $1 AND set_key = $2",
          [next, payload.set_key],
        );
        const set = setResult.rows[0];
        if (!set) throw Object.assign(new Error("Tier set is not present in the active version."), { status: 409 });
        const existing = await client.query(
          "SELECT * FROM quotation_tier_rows WHERE tier_set_id = $1 AND range_min = $2 FOR UPDATE",
          [set.tier_set_id, payload.range_min],
        );
        const before = existing.rows[0] ? normalizeTierRow(existing.rows[0]) : null;
        await client.query("DELETE FROM quotation_tier_rows WHERE tier_set_id = $1 AND range_min = $2", [set.tier_set_id, payload.range_min]);
        if (payload.before) {
          const row = payload.before;
          await client.query(
            `INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [set.tier_set_id, row.range_min, row.range_max, row.value1, row.value2, row.value3],
          );
        }
        change = { kind: "tier_row", version_id: next, set_key: payload.set_key, range_min: payload.range_min, before, after: payload.before };
      } else {
        const groupResult = await client.query(
          "SELECT group_id FROM quotation_option_groups WHERE version_id = $1 AND group_key = $2",
          [next, payload.group_key],
        );
        const group = groupResult.rows[0];
        if (!group) throw Object.assign(new Error("Option group is not present in the active version."), { status: 409 });
        const existing = await client.query(
          "SELECT label, attributes, is_active, sort_order FROM quotation_options WHERE group_id = $1 AND option_key = $2 FOR UPDATE",
          [group.group_id, payload.option_key],
        );
        const current = existing.rows[0] ? {
          ...existing.rows[0], is_active: Number(existing.rows[0].is_active) !== 0,
        } : null;
        if (payload.before === null) {
          await client.query("DELETE FROM quotation_options WHERE group_id = $1 AND option_key = $2", [group.group_id, payload.option_key]);
        } else {
          const prior = payload.before;
          await client.query(
            `INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order,is_active)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6)
             ON CONFLICT (group_id,option_key) DO UPDATE SET label = EXCLUDED.label,
               attributes = EXCLUDED.attributes, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active`,
            [group.group_id, payload.option_key, prior.label, JSON.stringify(prior.attributes || {}), prior.sort_order || 0, prior.is_active ? 1 : 0],
          );
        }
        change = {
          kind: "option", version_id: next, group_key: payload.group_key, option_key: payload.option_key,
          before: current, after: payload.before,
        };
      }
      await client.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
      await client.query(
        "UPDATE quotation_rate_versions SET status = 'active', published_at = CURRENT_TIMESTAMP WHERE version_id = $1",
        [next],
      );
      await audit(client, req, "RESTORE", history.identifier, `Value restored from audit entry ${auditId} in version ${next}`, {
        ...change, reverted_audit_id: auditId,
      });
      await audit(client, req, "CREATE", `version:${next}`, `Rate version ${next} created by reverting audit entry ${auditId}`, {
        version_id: next, reverted_audit_id: auditId, identifier: history.identifier,
      });
      return next;
    });
    res.json({ ok: true, version_id: versionId });
  } catch (error) { fail(res, error); }
});

module.exports = router;
