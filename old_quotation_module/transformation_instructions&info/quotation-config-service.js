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
      account: resolveAuditAccount(req.body?.requester || req.query || {}),
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
      const v = req.query.version_id ? Number(req.query.version_id) : (await getRateConfig()).versionId;
      const [versions] = await database.query("SELECT * FROM quotation_rate_versions ORDER BY version_id DESC");
      const [parameters] = await database.query("SELECT * FROM quotation_parameters WHERE version_id = ? ORDER BY group_code, sort_order", [v]);
      const [tierSets] = await database.query("SELECT * FROM quotation_tier_sets WHERE version_id = ? ORDER BY set_key", [v]);
      const [groups] = await database.query("SELECT * FROM quotation_option_groups WHERE version_id = ? ORDER BY group_key", [v]);
      const [components] = await database.query("SELECT * FROM quotation_cost_components WHERE version_id = ? ORDER BY sort_order", [v]);
      res.json({ versions, parameters, tierSets, groups, components });
    } catch (e) {
      res.status(500).json({ error: "Failed to load rates" });
    }
  });

  router.get("/api/quotation/admin/tier-sets/:id/rows", adminOnly, async (req, res) => {
    const [rows] = await database.query("SELECT * FROM quotation_tier_rows WHERE tier_set_id = ? ORDER BY range_min", [req.params.id]);
    res.json({ rows });
  });

  router.get("/api/quotation/admin/option-groups/:id/options", adminOnly, async (req, res) => {
    const [rows] = await database.query("SELECT * FROM quotation_options WHERE group_id = ? ORDER BY sort_order", [req.params.id]);
    res.json({ options: rows.map((o) => ({ ...o, attributes: parseJson(o.attributes) })) });
  });

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
        const n = Number(value);
        if (!Number.isFinite(n)) return res.status(400).json({ error: "Value must be a number" });
        if ((p.min_allowed !== null && n < Number(p.min_allowed)) || (p.max_allowed !== null && n > Number(p.max_allowed))) return res.status(400).json({ error: "Value outside allowed range" });
        await database.query("UPDATE quotation_parameters SET value_number = ? WHERE param_id = ?", [n, p.param_id]);
      } else {
        await database.query("UPDATE quotation_parameters SET value_text = ? WHERE param_id = ?", [String(value), p.param_id]);
      }
      await audit(req, "UPDATE", p.param_key, `Rate parameter ${p.param_key}: ${p.value_number ?? p.value_text} -> ${value}`, { before: p, after: value });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // replace all rows of one tier set: { rows:[{range_min,range_max,value1,value2,value3}] }
  router.put("/api/quotation/admin/tier-sets/:id/rows", adminOnly, async (req, res) => {
    try {
      const [[set]] = await database.query("SELECT * FROM quotation_tier_sets WHERE tier_set_id = ?", [req.params.id]);
      if (!set) return res.status(404).json({ error: "Tier set not found" });
      await assertDraft(set.version_id);
      const rows = (req.body.rows || []).map((r) => ({ min: Number(r.range_min), max: r.range_max === null || r.range_max === "" ? null : Number(r.range_max), v1: Number(r.value1), v2: r.value2 == null ? null : Number(r.value2), v3: r.value3 == null ? null : Number(r.value3) }));
      if (!rows.length || rows.some((r) => !Number.isFinite(r.min) || !Number.isFinite(r.v1))) return res.status(400).json({ error: "Every row needs range_min and value1" });
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
      await audit(req, "UPDATE", set.set_key, `Tier table ${set.set_key} replaced (${rows.length} rows)`, { rows });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // edit one option: { label?, attributes?, is_active?, sort_order? } or create with POST
  router.put("/api/quotation/admin/options/:id", adminOnly, async (req, res) => {
    try {
      const [[o]] = await database.query("SELECT o.*, g.version_id FROM quotation_options o JOIN quotation_option_groups g ON g.group_id = o.group_id WHERE o.option_id = ?", [req.params.id]);
      if (!o) return res.status(404).json({ error: "Option not found" });
      await assertDraft(o.version_id);
      const attrs = req.body.attributes !== undefined ? JSON.stringify({ ...parseJson(o.attributes), ...req.body.attributes }) : JSON.stringify(parseJson(o.attributes));
      await database.query("UPDATE quotation_options SET label = ?, attributes = ?, is_active = ?, sort_order = ? WHERE option_id = ?",
        [req.body.label ?? o.label, attrs, req.body.is_active === undefined ? o.is_active : req.body.is_active ? 1 : 0, req.body.sort_order ?? o.sort_order, o.option_id]);
      await audit(req, "UPDATE", o.option_key, `Option ${o.option_key} updated`, { before: o, after: req.body });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/option-groups/:id/options", adminOnly, async (req, res) => {
    try {
      const [[g]] = await database.query("SELECT * FROM quotation_option_groups WHERE group_id = ?", [req.params.id]);
      if (!g) return res.status(404).json({ error: "Group not found" });
      await assertDraft(g.version_id);
      const { option_key, label, attributes = {}, sort_order = 0 } = req.body;
      if (!option_key || !label) return res.status(400).json({ error: "option_key and label are required" });
      await database.query("INSERT INTO quotation_options (group_id, option_key, label, attributes, sort_order) VALUES (?,?,?,?,?)", [g.group_id, option_key, label, JSON.stringify(attributes), sort_order]);
      await audit(req, "CREATE", option_key, `Option ${option_key} added to ${g.group_key}`, req.body);
      res.status(201).json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // versions: clone the active one to a new draft, then publish when ready
  router.post("/api/quotation/admin/versions/clone", adminOnly, async (req, res) => {
    try {
      const fromId = Number(req.body.from_version_id) || (await getRateConfig()).versionId;
      const label = String(req.body.label || "New rate card draft");
      const [ins] = await database.query("INSERT INTO quotation_rate_versions (version_label, status, notes) VALUES (?, 'draft', ?)", [label, `Cloned from version ${fromId}`]);
      const to = ins.insertId;
      await database.query(`INSERT INTO quotation_parameters (version_id,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order)
        SELECT ?,param_key,group_code,label,value_type,value_number,value_text,unit,min_allowed,max_allowed,used_by,description,is_locked,sort_order FROM quotation_parameters WHERE version_id = ?`, [to, fromId]);
      await database.query(`INSERT INTO quotation_cost_components (version_id,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order)
        SELECT ?,code,label,report_group,toggle_field,handler,formula_expression,is_active,sort_order FROM quotation_cost_components WHERE version_id = ?`, [to, fromId]);
      await database.query(`INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description)
        SELECT ?,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description FROM quotation_tier_sets WHERE version_id = ?`, [to, fromId]);
      await database.query(`INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3)
        SELECT n.tier_set_id,r.range_min,r.range_max,r.value1,r.value2,r.value3 FROM quotation_tier_rows r
        JOIN quotation_tier_sets o ON o.tier_set_id = r.tier_set_id AND o.version_id = ?
        JOIN quotation_tier_sets n ON n.set_key = o.set_key AND n.version_id = ?`, [fromId, to]);
      await database.query(`INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema)
        SELECT ?,group_key,label,attribute_schema FROM quotation_option_groups WHERE version_id = ?`, [to, fromId]);
      await database.query(`INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order,is_active)
        SELECT n.group_id,o.option_key,o.label,o.attributes,o.sort_order,o.is_active FROM quotation_options o
        JOIN quotation_option_groups og ON og.group_id = o.group_id AND og.version_id = ?
        JOIN quotation_option_groups n ON n.group_key = og.group_key AND n.version_id = ?`, [fromId, to]);
      await audit(req, "CREATE", label, `Rate version ${to} cloned from ${fromId}`, { from: fromId, to });
      res.status(201).json({ version_id: to });
    } catch (e) { fail(res, e); }
  });

  router.post("/api/quotation/admin/versions/:id/publish", adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await assertDraft(id);
      await database.query("UPDATE quotation_rate_versions SET status = 'archived' WHERE status = 'active'");
      await database.query("UPDATE quotation_rate_versions SET status = 'active', published_at = NOW() WHERE version_id = ?", [id]);
      clearCache();
      await audit(req, "UPDATE", String(id), `Rate version ${id} published`, { version_id: id });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  return { router, getRateConfig, ensureLoaded, clearCache };
}

module.exports = { createQuotationRateService, assembleConfig };
