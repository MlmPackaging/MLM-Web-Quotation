// quotation-config-service.js  (server side, CommonJS)
// 1) loadRateConfig  : reads the rate-card tables into the plain `config` object the engine uses
// 2) cache           : calculation stays synchronous + fast; cache is cleared whenever an admin saves
// 3) routes          : client config, calculate, and admin edit endpoints
//
// Wire-up (inside createQuotationBackend, after `const router = express.Router();`):
//   const rates = createQuotationRateService({ database, logger, authorizeAdmin, addAuditLogEntryWithRetry, resolveAuditAccount });
//   router.use(rates.router);
//   ...and in your initialize step:  await rates.ensureLoaded();

"use strict";

const express = require("express");
const { calculateQuotation, getClientConfig } = require("./quotation-engine");

const num = (v) => (v === null || v === undefined ? null : Number(v));
const parseJson = (v) => (typeof v === "string" ? JSON.parse(v) : v || {});
const bool = (v) => v === true || v === 1 || v === "1";

// ------------------------------------------------------------ assemble (pure, testable without a DB)
function assembleConfig({ version, parameters, tierSets, tierRows, groups, options, components }) {
  const params = {};
  for (const p of parameters) params[p.param_key] = p.value_type === "number" ? num(p.value_number) : p.value_type === "boolean" ? bool(p.value_number) : p.value_text;

  const tiers = {};
  const setById = {};
  for (const s of tierSets) {
    tiers[s.set_key] = { basis: s.lookup_basis, below: s.below_min_behavior, rows: [] };
    setById[s.tier_set_id] = tiers[s.set_key];
  }
  for (const r of tierRows) {
    setById[r.tier_set_id].rows.push({ min: num(r.range_min), max: num(r.range_max), v1: num(r.value1), v2: num(r.value2), v3: num(r.value3) });
  }
  for (const s of Object.values(tiers)) s.rows.sort((a, b) => a.min - b.min);

  const opts = {};
  const groupById = {};
  for (const g of groups) {
    opts[g.group_key] = { list: [], byKey: {} };
    groupById[g.group_id] = opts[g.group_key];
  }
  for (const o of [...options].sort((a, b) => a.sort_order - b.sort_order)) {
    const entry = { key: o.option_key, label: o.label, is_active: bool(o.is_active), sort_order: o.sort_order, ...parseJson(o.attributes) };
    const g = groupById[o.group_id];
    g.list.push(entry);
    g.byKey[entry.key] = entry;
  }

  return {
    versionId: version.version_id,
    versionLabel: version.version_label,
    params,
    tiers,
    options: opts,
    components: [...components].sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ ...c, is_active: bool(c.is_active) })),
  };
}

// ------------------------------------------------------------ service
function createQuotationRateService({ database, logger, authorizeAdmin, addAuditLogEntryWithRetry, resolveAuditAccount }) {
  const router = express.Router();
  const cache = new Map();
  let activeVersionId = null;

  async function loadRateConfig(versionId) {
    let version;
    if (versionId) {
      [[version]] = await database.query("SELECT * FROM quotation_rate_versions WHERE version_id = ?", [versionId]);
    } else {
      [[version]] = await database.query("SELECT * FROM quotation_rate_versions WHERE status = 'active' ORDER BY published_at DESC, version_id DESC LIMIT 1");
    }
    if (!version) throw new Error("No active quotation rate version found. Run quotation_seed.sql.");
    const v = version.version_id;

    const [parameters] = await database.query("SELECT * FROM quotation_parameters WHERE version_id = ?", [v]);
    const [tierSets] = await database.query("SELECT * FROM quotation_tier_sets WHERE version_id = ?", [v]);
    const [tierRows] = await database.query(
      "SELECT r.* FROM quotation_tier_rows r JOIN quotation_tier_sets s ON s.tier_set_id = r.tier_set_id WHERE s.version_id = ?", [v]);
    const [groups] = await database.query("SELECT * FROM quotation_option_groups WHERE version_id = ?", [v]);
    const [options] = await database.query(
      "SELECT o.* FROM quotation_options o JOIN quotation_option_groups g ON g.group_id = o.group_id WHERE g.version_id = ?", [v]);
    const [components] = await database.query("SELECT * FROM quotation_cost_components WHERE version_id = ?", [v]);

    return assembleConfig({ version, parameters, tierSets, tierRows, groups, options, components });
  }

  async function getRateConfig(versionId, refresh = false) {
    const id = versionId || activeVersionId;
    if (!refresh && id && cache.has(id)) return cache.get(id);
    const cfg = await loadRateConfig(versionId);
    cache.set(cfg.versionId, cfg);
    if (!versionId) activeVersionId = cfg.versionId;
    return cfg;
  }

  function clearCache() {
    cache.clear();
    activeVersionId = null;
  }

  async function ensureLoaded() {
    return getRateConfig();
  }

  const adminOnly = async (req, res, next) => {
    try {
      // authorizeAdmin MUST verify a real session/token on the server - never trust a role sent by the browser.
      if (typeof authorizeAdmin !== "function" || !(await authorizeAdmin(req))) return res.status(403).json({ error: "Admin access required" });
      next();
    } catch (error) {
      logger?.apiFail?.(req, 500, error);
      console.error("[API] Quotation rate admin authorization failed:", error);
      res.status(500).json({ error: "Authorization check failed" });
    }
  };

  // every admin write goes through audit(), so this is also where the cached config is dropped
  const audit = (req, action, identifier, summary, payload) => {
    clearCache();
    return addAuditLogEntryWithRetry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(req.adminUser || req.body?.requester || req.query || {}),
      action,
      module: "Quotation Rates",
      identifier,
      changeSummary: summary,
      dataPayload: payload,
    });
  };

  // ---------- public: what the form needs
  router.get("/api/quotation/config", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(getClientConfig(await getRateConfig(undefined, true)));
    } catch (e) {
      console.error("[API] GET /api/quotation/config", e);
      res.status(500).json({ error: "Failed to load quotation configuration" });
    }
  });

  // ---------- public: calculate on the server (the browser can no longer see or change the rates)
  router.post("/api/quotation/calculate", async (req, res) => {
    res.set("Cache-Control", "no-store");
    let config;
    try {
      config = await getRateConfig(undefined, true);
    } catch (e) {
      console.error("[API] POST /api/quotation/calculate: rate configuration unavailable", e);
      return res.status(503).json({ error: "Quotation rates are temporarily unavailable" });
    }

    try {
      res.json({ result: calculateQuotation(req.body?.form || {}, config) });
    } catch (e) {
      res.status(400).json({ error: e.message || "Calculation failed" });
    }
  });

  // ---------- admin: read everything with ids, for the editor screens
  router.get("/api/quotation/admin/rates", adminOnly, async (req, res) => {
    try {
      const requestedVersionId = req.query.version_id ? Number(req.query.version_id) : null;
      if (requestedVersionId !== null && (!Number.isSafeInteger(requestedVersionId) || requestedVersionId < 1)) {
        return res.status(400).json({ error: "Version ID must be a positive integer" });
      }
      const activeVersionId = (await getRateConfig()).versionId;
      const v = requestedVersionId || activeVersionId;
      const [versions] = await database.query("SELECT * FROM quotation_rate_versions ORDER BY version_id DESC");
      if (!versions.some((version) => Number(version.version_id) === v)) {
        return res.status(404).json({ error: "Rate version not found" });
      }
      const [parameters] = await database.query("SELECT * FROM quotation_parameters WHERE version_id = ? ORDER BY group_code, sort_order", [v]);
      const [tierSets] = await database.query("SELECT * FROM quotation_tier_sets WHERE version_id = ? ORDER BY set_key", [v]);
      const [groups] = await database.query("SELECT * FROM quotation_option_groups WHERE version_id = ? ORDER BY group_key", [v]);
      const [components] = await database.query("SELECT * FROM quotation_cost_components WHERE version_id = ? ORDER BY sort_order", [v]);
      res.json({ versions, parameters, tierSets, groups, components, activeVersionId, selectedVersionId: v });
    } catch (e) {
      logger?.apiFail?.(req, 500, e);
      res.status(500).json({ error: "Failed to load rates" });
    }
  });

  router.get("/api/quotation/admin/tier-sets/:id/rows", adminOnly, async (req, res) => {
    try {
      const [rows] = await database.query("SELECT * FROM quotation_tier_rows WHERE tier_set_id = ? ORDER BY range_min", [req.params.id]);
      res.json({ rows });
    } catch (e) {
      logger?.apiFail?.(req, 500, e);
      res.status(500).json({ error: "Failed to load tier rows" });
    }
  });

  router.get("/api/quotation/admin/option-groups/:id/options", adminOnly, async (req, res) => {
    try {
      const [rows] = await database.query("SELECT * FROM quotation_options WHERE group_id = ? ORDER BY sort_order", [req.params.id]);
      res.json({ options: rows.map((o) => ({ ...o, attributes: parseJson(o.attributes) })) });
    } catch (e) {
      logger?.apiFail?.(req, 500, e);
      res.status(500).json({ error: "Failed to load rate options" });
    }
  });

  router.get("/api/quotation/admin/history/:identifier", adminOnly, async (req, res) => {
    try {
      const [rows] = await database.query(
        `SELECT audit_id, event_timestamp, account, action, identifier, change_summary, data_payload
         FROM quotation_audit_log
         WHERE module = 'Quotation Rates' AND identifier = ?
         ORDER BY event_timestamp DESC, audit_id DESC
         LIMIT 100`,
        [req.params.identifier],
      );
      res.json({
        history: rows.map((row) => ({ ...row, data_payload: parseJson(row.data_payload) })),
      });
    } catch (e) {
      logger?.apiFail?.(req, 500, e);
      res.status(500).json({ error: "Failed to load rate history" });
    }
  });

  async function transaction(callback) {
    const connection = database.getConnection ? await database.getConnection() : database;
    try {
      if (connection.beginTransaction) await connection.beginTransaction();
      const result = await callback(connection);
      if (connection.commit) await connection.commit();
      return result;
    } catch (error) {
      if (connection.rollback) await connection.rollback();
      throw error;
    } finally {
      if (connection !== database && connection.release) connection.release();
    }
  }

  async function copyRateVersion(connection, fromId, label, notes, createdBy) {
    const [[source]] = await connection.query(
      "SELECT version_id FROM quotation_rate_versions WHERE version_id = ?",
      [fromId],
    );
    if (!source) throw Object.assign(new Error("Source version not found"), { status: 404 });
    const [inserted] = await connection.query(
      "INSERT INTO quotation_rate_versions (version_label, status, notes, created_by) VALUES (?, 'draft', ?, ?)",
      [label, notes, createdBy],
    );
    const to = inserted.insertId;
    await connection.query(`INSERT INTO quotation_parameters (version_id,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order)
      SELECT ?,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order FROM quotation_parameters WHERE version_id = ?`, [to, fromId]);
    await connection.query(`INSERT INTO quotation_cost_components (version_id,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order)
      SELECT ?,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order FROM quotation_cost_components WHERE version_id = ?`, [to, fromId]);
    await connection.query(`INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description)
      SELECT ?,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description FROM quotation_tier_sets WHERE version_id = ?`, [to, fromId]);
    await connection.query(`INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3)
      SELECT n.tier_set_id,r.range_min,r.range_max,r.value1,r.value2,r.value3 FROM quotation_tier_rows r
      JOIN quotation_tier_sets o ON o.tier_set_id = r.tier_set_id AND o.version_id = ?
      JOIN quotation_tier_sets n ON n.set_key = o.set_key AND n.version_id = ?`, [fromId, to]);
    await connection.query(`INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema)
      SELECT ?,group_key,label,attribute_schema FROM quotation_option_groups WHERE version_id = ?`, [to, fromId]);
    await connection.query(`INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order,is_active)
      SELECT n.group_id,o.option_key,o.label,o.attributes,o.sort_order,o.is_active FROM quotation_options o
      JOIN quotation_option_groups og ON og.group_id = o.group_id AND og.version_id = ?
      JOIN quotation_option_groups n ON n.group_key = og.group_key AND n.version_id = ?`, [fromId, to]);
    return to;
  }

  // Only DRAFT versions can be edited; the active one is changed by cloning -> editing -> publishing.
  async function assertDraft(versionId) {
    const [[v]] = await database.query("SELECT status FROM quotation_rate_versions WHERE version_id = ?", [versionId]);
    if (!v) throw Object.assign(new Error("Version not found"), { status: 404 });
    if (v.status !== "draft") throw Object.assign(new Error("Only draft versions can be edited. Clone the active version first."), { status: 409 });
  }
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || "Request failed" });

  // value change: { value } for number/text/boolean parameters
  router.put("/api/quotation/admin/parameters/:id", adminOnly, async (req, res) => {
    try {
      const [[p]] = await database.query("SELECT * FROM quotation_parameters WHERE param_id = ?", [req.params.id]);
      if (!p) return res.status(404).json({ error: "Parameter not found" });
      await assertDraft(p.version_id);
      if (p.is_locked) return res.status(400).json({ error: "This parameter is locked" });
      const value = req.body.value;
      if (p.value_type === "number") {
        if (value === "" || value === null || value === undefined) return res.status(400).json({ error: "Value must be a number" });
        const n = Number(value);
        if (!Number.isFinite(n)) return res.status(400).json({ error: "Value must be a number" });
        if ((p.min_allowed !== null && n < Number(p.min_allowed)) || (p.max_allowed !== null && n > Number(p.max_allowed))) return res.status(400).json({ error: "Value outside allowed range" });
        await database.query("UPDATE quotation_parameters SET value_number = ? WHERE param_id = ?", [n, p.param_id]);
      } else if (p.value_type === "boolean") {
        if (value !== true && value !== false && value !== 1 && value !== 0 && value !== "1" && value !== "0") {
          return res.status(400).json({ error: "Value must be true or false" });
        }
        await database.query("UPDATE quotation_parameters SET value_number = ?, value_text = NULL WHERE param_id = ?", [value === true || value === 1 || value === "1" ? 1 : 0, p.param_id]);
      } else {
        await database.query("UPDATE quotation_parameters SET value_text = ?, value_number = NULL WHERE param_id = ?", [String(value), p.param_id]);
      }
      const beforeValue = p.value_type === "number" ? p.value_number : p.value_type === "boolean" ? Boolean(Number(p.value_number)) : p.value_text;
      const afterValue = p.value_type === "boolean" ? value === true || value === 1 || value === "1" : value;
      await audit(req, "UPDATE", p.param_key, `Rate parameter ${p.param_key}: ${beforeValue} -> ${afterValue}`, {
        kind: "parameter", version_id: p.version_id, parameter_key: p.param_key, beforeValue, afterValue,
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // replace all rows of one tier set: { rows:[{range_min,range_max,value1,value2,value3}] }
  router.put("/api/quotation/admin/tier-sets/:id/rows", adminOnly, async (req, res) => {
    try {
      const [[set]] = await database.query("SELECT * FROM quotation_tier_sets WHERE tier_set_id = ?", [req.params.id]);
      if (!set) return res.status(404).json({ error: "Tier set not found" });
      await assertDraft(set.version_id);
      const [oldRows] = await database.query("SELECT * FROM quotation_tier_rows WHERE tier_set_id = ? ORDER BY range_min", [set.tier_set_id]);
      if (!Array.isArray(req.body.rows) || req.body.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        return res.status(400).json({ error: "rows must be an array of tier row objects" });
      }
      const rows = req.body.rows.map((r) => ({
        min: r.range_min === "" || r.range_min == null ? NaN : Number(r.range_min),
        max: r.range_max === null || r.range_max === "" ? null : Number(r.range_max),
        v1: r.value1 === "" || r.value1 == null ? NaN : Number(r.value1),
        v2: r.value2 == null || r.value2 === "" ? null : Number(r.value2),
        v3: r.value3 == null || r.value3 === "" ? null : Number(r.value3),
      }));
      if (!rows.length || rows.some((r) => !Number.isFinite(r.min) || !Number.isFinite(r.v1) ||
        (r.max !== null && (!Number.isFinite(r.max) || r.max < r.min)) ||
        [r.v2, r.v3].some((value) => value !== null && !Number.isFinite(value)))) {
        return res.status(400).json({ error: "Every tier row needs valid numeric range and value fields" });
      }
      if (new Set(rows.map((r) => r.min)).size !== rows.length) return res.status(400).json({ error: "Duplicate range_min values" });
      const conn = database.getConnection ? await database.getConnection() : database;
      try {
        if (conn.beginTransaction) await conn.beginTransaction();
        await conn.query("DELETE FROM quotation_tier_rows WHERE tier_set_id = ?", [set.tier_set_id]);
        for (const r of rows) await conn.query("INSERT INTO quotation_tier_rows (tier_set_id, range_min, range_max, value1, value2, value3) VALUES (?,?,?,?,?,?)", [set.tier_set_id, r.min, r.max, r.v1, r.v2, r.v3]);
        if (conn.commit) await conn.commit();
      } catch (err) {
        if (conn.rollback) await conn.rollback();
        throw err;
      } finally {
        if (conn !== database && conn.release) conn.release();
      }
      const oldByMin = new Map(oldRows.map((row) => [String(Number(row.range_min)), row]));
      const fields = [["range_max", "max"], ["value1", "v1"], ["value2", "v2"], ["value3", "v3"]];
      let changedCells = 0;
      const newByMin = new Map(rows.map((row) => [String(row.min), row]));
      const rowValues = (row) => ({
        range_min: Number(row.range_min ?? row.min),
        range_max: row.range_max === null || row.max === null ? null : Number(row.range_max ?? row.max),
        value1: Number(row.value1 ?? row.v1),
        value2: row.value2 == null && row.v2 == null ? null : Number(row.value2 ?? row.v2),
        value3: row.value3 == null && row.v3 == null ? null : Number(row.value3 ?? row.v3),
      });
      for (const row of rows) {
        if (oldByMin.has(String(row.min))) continue;
        changedCells += 1;
        const identifier = `tier:${set.set_key}:${row.min}:row`;
        await audit(req, "CREATE", identifier, `Tier row ${set.set_key} ${row.min} added`, {
          kind: "tier_row", version_id: set.version_id, set_key: set.set_key, range_min: row.min,
          before: null, after: rowValues(row),
        });
      }
      for (const row of rows) {
        const before = oldByMin.get(String(row.min));
        if (!before) continue;
        for (const [field, key] of fields) {
          const beforeValue = before[field] === null ? null : Number(before[field]);
          const afterValue = row[key];
          if (beforeValue !== afterValue) {
            changedCells += 1;
            const identifier = `tier:${set.set_key}:${row.min}:${field}`;
            await audit(req, "UPDATE", identifier, `${set.set_key} ${row.min} ${field}: ${beforeValue} -> ${afterValue}`, {
              kind: "tier", version_id: set.version_id, set_key: set.set_key, range_min: row.min,
              field, beforeValue, afterValue,
            });
          }
        }
      }
      for (const oldRow of oldRows) {
        const rangeMin = Number(oldRow.range_min);
        if (newByMin.has(String(rangeMin))) continue;
        changedCells += 1;
        const identifier = `tier:${set.set_key}:${rangeMin}:row`;
        await audit(req, "DELETE", identifier, `Tier row ${set.set_key} ${rangeMin} removed`, {
          kind: "tier_row", version_id: set.version_id, set_key: set.set_key, range_min: rangeMin,
          before: rowValues(oldRow), after: null,
        });
      }
      if (changedCells) {
        await audit(req, "UPDATE", set.set_key, `Tier table ${set.set_key} updated (${changedCells} values)`, {
          kind: "tier_table", version_id: set.version_id, set_key: set.set_key, changed_cells: changedCells,
        });
      }
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // edit one option: { label?, attributes?, is_active?, sort_order? } or create with POST
  router.put("/api/quotation/admin/options/:id", adminOnly, async (req, res) => {
    try {
      const [[o]] = await database.query("SELECT o.*, g.version_id, g.group_key FROM quotation_options o JOIN quotation_option_groups g ON g.group_id = o.group_id WHERE o.option_id = ?", [req.params.id]);
      if (!o) return res.status(404).json({ error: "Option not found" });
      await assertDraft(o.version_id);
      if (req.body.label !== undefined && !String(req.body.label).trim()) return res.status(400).json({ error: "Option label cannot be empty" });
      if (req.body.attributes !== undefined && (!req.body.attributes || typeof req.body.attributes !== "object" || Array.isArray(req.body.attributes))) {
        return res.status(400).json({ error: "Option attributes must be a JSON object" });
      }
      if (req.body.sort_order !== undefined && !Number.isInteger(Number(req.body.sort_order))) {
        return res.status(400).json({ error: "Option sort order must be a whole number" });
      }
      if (req.body.is_active !== undefined && ![true, false, 1, 0, "1", "0"].includes(req.body.is_active)) {
        return res.status(400).json({ error: "Option active state must be true or false" });
      }
      const attrs = req.body.attributes !== undefined ? JSON.stringify({ ...parseJson(o.attributes), ...req.body.attributes }) : JSON.stringify(parseJson(o.attributes));
      await database.query("UPDATE quotation_options SET label = ?, attributes = ?, is_active = ?, sort_order = ? WHERE option_id = ?",
        [req.body.label === undefined ? o.label : String(req.body.label).trim(), attrs, req.body.is_active === undefined ? o.is_active : req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === "1" ? 1 : 0, req.body.sort_order ?? o.sort_order, o.option_id]);
      await audit(req, "UPDATE", `option:${o.option_key}`, `Option ${o.option_key} updated`, {
        kind: "option", version_id: o.version_id, group_key: o.group_key, option_key: o.option_key,
        before: { label: o.label, attributes: parseJson(o.attributes), is_active: Boolean(Number(o.is_active)), sort_order: Number(o.sort_order) },
        after: {
          label: req.body.label ?? o.label,
          attributes: req.body.attributes !== undefined ? { ...parseJson(o.attributes), ...req.body.attributes } : parseJson(o.attributes),
          is_active: req.body.is_active === undefined ? Boolean(Number(o.is_active)) : req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === "1",
          sort_order: req.body.sort_order ?? o.sort_order,
        },
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/option-groups/:id/options", adminOnly, async (req, res) => {
    try {
      const [[g]] = await database.query("SELECT * FROM quotation_option_groups WHERE group_id = ?", [req.params.id]);
      if (!g) return res.status(404).json({ error: "Group not found" });
      await assertDraft(g.version_id);
      const { option_key, label, attributes = {}, sort_order = 0 } = req.body;
      if (typeof option_key !== "string" || !option_key.trim() || typeof label !== "string" || !label.trim()) return res.status(400).json({ error: "option_key and label are required" });
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return res.status(400).json({ error: "Option attributes must be a JSON object" });
      if (!Number.isInteger(Number(sort_order))) return res.status(400).json({ error: "Option sort order must be a whole number" });
      await database.query("INSERT INTO quotation_options (group_id, option_key, label, attributes, sort_order) VALUES (?,?,?,?,?)", [g.group_id, option_key.trim(), label.trim(), JSON.stringify(attributes), Number(sort_order)]);
      await audit(req, "CREATE", `option:${option_key.trim()}`, `Option ${option_key.trim()} added to ${g.group_key}`, {
        kind: "option", version_id: g.version_id, group_key: g.group_key, option_key: option_key.trim(),
        before: null,
        after: { label: label.trim(), attributes, is_active: true, sort_order: Number(sort_order) },
      });
      res.status(201).json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.delete("/api/quotation/admin/options/:id", adminOnly, async (req, res) => {
    try {
      const [[option]] = await database.query(
        `SELECT o.*, g.version_id, g.group_key FROM quotation_options o
         JOIN quotation_option_groups g ON g.group_id = o.group_id WHERE o.option_id = ?`,
        [req.params.id],
      );
      if (!option) return res.status(404).json({ error: "Option not found" });
      await assertDraft(option.version_id);
      await database.query("DELETE FROM quotation_options WHERE option_id = ?", [option.option_id]);
      await audit(req, "DELETE", `option:${option.option_key}`, `Option ${option.option_key} deleted`, {
        kind: "option", version_id: option.version_id, group_key: option.group_key,
        option_key: option.option_key, before: {
          label: option.label, attributes: parseJson(option.attributes),
          is_active: Boolean(Number(option.is_active)), sort_order: Number(option.sort_order),
        }, after: null,
      });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // Versions are immutable snapshots once published. Drafts are cloned from any published version.
  router.post("/api/quotation/admin/versions/clone", adminOnly, async (req, res) => {
    try {
      const fromId = req.body.from_version_id === undefined
        ? (await getRateConfig()).versionId
        : Number(req.body.from_version_id);
      if (!Number.isSafeInteger(fromId) || fromId < 1) return res.status(400).json({ error: "Source version ID is invalid" });
      const label = String(req.body.label === undefined ? "New rate card draft" : req.body.label).trim().slice(0, 100);
      if (!label) return res.status(400).json({ error: "A version label is required" });
      const to = await transaction((connection) => copyRateVersion(
        connection, fromId, label, `Cloned from version ${fromId}`, resolveAuditAccount(req.adminUser || {}, "Unknown"),
      ));
      await audit(req, "CREATE", `version:${to}`, `Rate version ${to} cloned from ${fromId}`, { from: fromId, to });
      res.status(201).json({ version_id: to });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/versions/:id/publish", adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Version ID must be a positive integer" });
      await transaction(async (connection) => {
        const [[version]] = await connection.query("SELECT status FROM quotation_rate_versions WHERE version_id = ? FOR UPDATE", [id]);
        if (!version) throw Object.assign(new Error("Version not found"), { status: 404 });
        if (version.status !== "draft") throw Object.assign(new Error("Only draft versions can be published"), { status: 409 });
        await connection.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
        await connection.query("UPDATE quotation_rate_versions SET status = 'active', published_at = NOW() WHERE version_id = ?", [id]);
      });
      await audit(req, "UPDATE", `version:${id}`, `Rate version ${id} published`, { version_id: id });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/versions/:id/restore", adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Version ID must be a positive integer" });
      const prior = await transaction(async (connection) => {
        const [[target]] = await connection.query("SELECT version_id, version_label, status FROM quotation_rate_versions WHERE version_id = ? FOR UPDATE", [id]);
        if (!target) throw Object.assign(new Error("Version not found"), { status: 404 });
        if (target.status === "draft") throw Object.assign(new Error("Publish the draft before restoring it"), { status: 409 });
        const [[current]] = await connection.query("SELECT version_id FROM quotation_rate_versions WHERE status = 'active' FOR UPDATE");
        if (Number(current?.version_id) === id) return { from: id, to: id, unchanged: true };
        await connection.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
        await connection.query("UPDATE quotation_rate_versions SET status = 'active' WHERE version_id = ?", [id]);
        return { from: Number(current?.version_id || 0), to: id, label: target.version_label };
      });
      if (!prior.unchanged) {
        await audit(req, "RESTORE", `version:${id}`, `Active rate version changed from ${prior.from} to ${id}`, prior);
      }
      res.json({ ok: true, active_version_id: id });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/history/:auditId/revert", adminOnly, async (req, res) => {
    try {
      const auditId = Number(req.params.auditId);
      if (!Number.isSafeInteger(auditId) || auditId < 1) return res.status(400).json({ error: "Audit ID must be a positive integer" });
      const [[entry]] = await database.query(
        `SELECT audit_id, identifier, change_summary, data_payload FROM quotation_audit_log
         WHERE audit_id = ? AND module = 'Quotation Rates' LIMIT 1`,
        [auditId],
      );
      if (!entry) return res.status(404).json({ error: "Rate history entry not found" });
      const payload = parseJson(entry.data_payload);
      if (!payload.kind || !Object.prototype.hasOwnProperty.call(payload, "beforeValue") &&
        payload.kind !== "option" && payload.kind !== "tier_row") {
        return res.status(409).json({ error: "This history record cannot be reverted individually" });
      }
      const activeVersionId = (await getRateConfig()).versionId;
      const reverted = await transaction(async (connection) => {
        const [[active]] = await connection.query(
          "SELECT version_id FROM quotation_rate_versions WHERE version_id = ? AND status = 'active' FOR UPDATE",
          [activeVersionId],
        );
        if (!active) throw Object.assign(new Error("No active rate version found"), { status: 409 });
        const next = await copyRateVersion(
          connection, activeVersionId, `Rate version revert ${auditId}`,
          `Reverted ${entry.identifier} using audit entry ${auditId}`,
          resolveAuditAccount(req.adminUser || {}, "Unknown"),
        );
        let change;
        if (payload.kind === "parameter") {
          const [[parameter]] = await connection.query(
            "SELECT param_id, value_type, is_locked, min_allowed, max_allowed FROM quotation_parameters WHERE version_id = ? AND param_key = ?",
            [next, payload.parameter_key],
          );
          if (!parameter) throw Object.assign(new Error("Parameter is not present in the active version"), { status: 409 });
          if (parameter.is_locked) throw Object.assign(new Error("This parameter is locked and cannot be reverted"), { status: 400 });
          const value = payload.beforeValue;
          const beforeValue = parameter.value_type === "number"
            ? parameter.value_number
            : parameter.value_type === "boolean"
              ? Boolean(Number(parameter.value_number))
              : parameter.value_text;
          if (parameter.value_type === "number") {
            const number = Number(value);
            if (!Number.isFinite(number) ||
              (parameter.min_allowed !== null && number < Number(parameter.min_allowed)) ||
              (parameter.max_allowed !== null && number > Number(parameter.max_allowed))) {
              throw Object.assign(new Error("Historical value is outside the parameter's allowed range"), { status: 400 });
            }
            await connection.query("UPDATE quotation_parameters SET value_number = ?, value_text = NULL WHERE param_id = ?", [number, parameter.param_id]);
          } else if (parameter.value_type === "boolean") {
            await connection.query("UPDATE quotation_parameters SET value_number = ?, value_text = NULL WHERE param_id = ?", [value ? 1 : 0, parameter.param_id]);
          } else {
            await connection.query("UPDATE quotation_parameters SET value_text = ?, value_number = NULL WHERE param_id = ?", [String(value ?? ""), parameter.param_id]);
          }
          change = {
            kind: "parameter", version_id: next, parameter_key: payload.parameter_key,
            beforeValue, afterValue: value,
          };
        } else if (payload.kind === "tier") {
          const allowedFields = new Set(["range_max", "value1", "value2", "value3"]);
          if (!allowedFields.has(payload.field)) throw Object.assign(new Error("Invalid tier field in history record"), { status: 400 });
          const [[set]] = await connection.query("SELECT tier_set_id FROM quotation_tier_sets WHERE version_id = ? AND set_key = ?", [next, payload.set_key]);
          if (!set) throw Object.assign(new Error("Tier set is not present in the active version"), { status: 409 });
          const [[tierRow]] = await connection.query(
            `SELECT ${payload.field} AS value FROM quotation_tier_rows WHERE tier_set_id = ? AND range_min = ?`,
            [set.tier_set_id, payload.range_min],
          );
          if (!tierRow) throw Object.assign(new Error("Tier row is not present in the active version"), { status: 409 });
          const [update] = await connection.query(
            `UPDATE quotation_tier_rows SET ${payload.field} = ? WHERE tier_set_id = ? AND range_min = ?`,
            [payload.beforeValue, set.tier_set_id, payload.range_min],
          );
          const unchanged = tierRow.value == null || payload.beforeValue == null
            ? tierRow.value == null && payload.beforeValue == null
            : Number(tierRow.value) === Number(payload.beforeValue);
          if (!update.affectedRows && !unchanged) {
            throw Object.assign(new Error("Tier row could not be updated"), { status: 409 });
          }
          change = {
            kind: "tier", version_id: next, set_key: payload.set_key, range_min: payload.range_min,
            field: payload.field, beforeValue: tierRow.value, afterValue: payload.beforeValue,
          };
        } else if (payload.kind === "tier_row") {
          const [[set]] = await connection.query("SELECT tier_set_id FROM quotation_tier_sets WHERE version_id = ? AND set_key = ?", [next, payload.set_key]);
          if (!set) throw Object.assign(new Error("Tier set is not present in the active version"), { status: 409 });
          const [[existing]] = await connection.query(
            "SELECT range_min, range_max, value1, value2, value3 FROM quotation_tier_rows WHERE tier_set_id = ? AND range_min = ?",
            [set.tier_set_id, payload.range_min],
          );
          const currentRow = existing ? {
            range_min: Number(existing.range_min),
            range_max: existing.range_max === null ? null : Number(existing.range_max),
            value1: Number(existing.value1),
            value2: existing.value2 === null ? null : Number(existing.value2),
            value3: existing.value3 === null ? null : Number(existing.value3),
          } : null;
          await connection.query("DELETE FROM quotation_tier_rows WHERE tier_set_id = ? AND range_min = ?", [set.tier_set_id, payload.range_min]);
          if (payload.before) {
            const row = payload.before;
            await connection.query(
              "INSERT INTO quotation_tier_rows (tier_set_id, range_min, range_max, value1, value2, value3) VALUES (?, ?, ?, ?, ?, ?)",
              [set.tier_set_id, row.range_min, row.range_max, row.value1, row.value2, row.value3],
            );
          }
          change = {
            kind: "tier_row", version_id: next, set_key: payload.set_key, range_min: payload.range_min,
            before: currentRow, after: payload.before,
          };
        } else if (payload.kind === "option") {
          const [[group]] = await connection.query("SELECT group_id FROM quotation_option_groups WHERE version_id = ? AND group_key = ?", [next, payload.group_key]);
          if (!group) throw Object.assign(new Error("Option group is not present in the active version"), { status: 409 });
          if (payload.before === null) {
            const [[current]] = await connection.query(
              "SELECT label, attributes, is_active, sort_order FROM quotation_options WHERE group_id = ? AND option_key = ?",
              [group.group_id, payload.option_key],
            );
            await connection.query("DELETE FROM quotation_options WHERE group_id = ? AND option_key = ?", [group.group_id, payload.option_key]);
            change = {
              kind: "option", version_id: next, group_key: payload.group_key, option_key: payload.option_key,
              before: current ? { ...current, attributes: parseJson(current.attributes), is_active: Boolean(Number(current.is_active)) } : null,
              after: null,
            };
          } else {
            const prior = payload.before;
            const [[current]] = await connection.query(
              "SELECT label, attributes, is_active, sort_order FROM quotation_options WHERE group_id = ? AND option_key = ?",
              [group.group_id, payload.option_key],
            );
            await connection.query(
              `INSERT INTO quotation_options (group_id, option_key, label, attributes, sort_order, is_active)
               VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE label = VALUES(label), attributes = VALUES(attributes),
                 sort_order = VALUES(sort_order), is_active = VALUES(is_active)`,
              [group.group_id, payload.option_key, prior.label, JSON.stringify(prior.attributes || {}), prior.sort_order || 0, prior.is_active ? 1 : 0],
            );
            change = {
              kind: "option", version_id: next, group_key: payload.group_key, option_key: payload.option_key,
              before: current ? { ...current, attributes: parseJson(current.attributes), is_active: Boolean(Number(current.is_active)) } : null,
              after: prior,
            };
          }
        } else {
          throw Object.assign(new Error("This history record cannot be reverted individually"), { status: 409 });
        }
        await connection.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
        await connection.query("UPDATE quotation_rate_versions SET status = 'active', published_at = NOW() WHERE version_id = ?", [next]);
        return { versionId: next, change };
      });
      await audit(req, "RESTORE", entry.identifier, `Value restored from audit entry ${auditId} in version ${reverted.versionId}`, {
        ...reverted.change, reverted_audit_id: auditId,
      });
      await audit(req, "CREATE", `version:${reverted.versionId}`, `Rate version ${reverted.versionId} created by reverting history entry ${auditId}`, {
        version_id: reverted.versionId, reverted_audit_id: auditId, identifier: entry.identifier,
      });
      res.json({ ok: true, version_id: reverted.versionId });
    } catch (e) { fail(res, e); }
  });

  return { router, getRateConfig, ensureLoaded, clearCache };
}

module.exports = { createQuotationRateService, assembleConfig };
