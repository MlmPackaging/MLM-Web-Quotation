const express = require("express");
const pgPool = require("../db");
const { verifyAdminToken } = require("../authToken");
const {
  loadActiveQuotationRateConfig,
  calculateQuotationEstimates,
  listRateCardOptions,
} = require("./postgresQuotationRates");

const router = express.Router();

// Same rules as the customer router (quotationAPI.js)
const PURPOSES = ["One-off order", "Repeat supply"];
const LIMITS = { height_mm: [100, 600], width_mm: [80, 500], gusset_mm: [40, 300] };
const MIN_QTY = 500;
// Statuses the admin can set. Add/remove to match your workflow
// (if the quotation table has a CHECK constraint on status, keep them in sync).
const STATUSES = ["SUBMITTED", "IN_REVIEW", "QUOTED", "ACCEPTED", "REJECTED", "CANCELLED"];

const isInt = Number.isInteger;
const text = (v) => String(v ?? "").trim();
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// 8000 -> "8k", 1500 -> "1.5k"
const kfmt = (n) => (Number(n) >= 1000 ? `${+(Number(n) / 1000).toFixed(1)}k` : String(n));

// One-line summary of a quotation, e.g.
// "250 x 310 x 200mm/180gsm White Kraft/<printing>/<handle>/8k/10k/15k"
function buildDescription({ h, w, g, paperName, gsm, printingName, handleName, quantities }) {
  const size = h && w && g ? `${h} x ${w} x ${g}mm` : "";
  const paper = paperName ? (gsm && !/gsm/i.test(paperName) ? `${gsm}gsm ${paperName}` : paperName) : "";
  const tiers = (quantities || []).map(kfmt).join("/");
  return [size, paper, printingName, handleName, tiers].filter(Boolean).join("/");
}

// Explains a rejected status value (database CHECK constraint / enum) instead of a vague error.
function statusDbError(res, e, status) {
  if (e && (e.code === "23514" || e.code === "22P02")) {
    return fail(res, 400, `The database does not accept the status "${status}" yet. Run quotation_status_update.sql once, then try again.`);
  }
  return null;
}

// Validate the signed login token and recheck the active staff account.
async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = verifyAdminToken(token);
  if (!claims) return fail(res, 401, "Please log in again.");

  try {
    const result = await pgPool.query(
      `SELECT user_id, user_email, user_name, user_role
       FROM "user"
       WHERE user_id = $1 AND LOWER(user_email) = $2 AND user_active = 1
       LIMIT 1`,
      [claims.user_id, claims.email],
    );
    const user = result.rows[0];
    if (!user) return fail(res, 401, "Please log in as an admin.");

    req.adminUser = user;
    next();
  } catch (error) {
    console.error("[admin/quotation/auth] Database error:", error.message);
    fail(res, 500, "Unable to verify admin access.");
  }
}
router.use(requireAdmin);

function requireNumericId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) return fail(res, 400, "Quotation ID must be numeric.");
  next();
}

// Optional columns (created_at / updated_at / gallery_bag_no): used only if they exist.
const colCache = {};
async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (colCache[key] === undefined) {
    const r = await pgPool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column],
    );
    colCache[key] = r.rows.length > 0;
  }
  return colCache[key];
}

router.get("/me", (req, res) => {
  const u = req.adminUser;
  res.json({
    success: true,
    name: u.user_name || u.name || u.username || "Staff",
    email: u.user_email || u.email || "",
    role: u.user_role || "Staff",
  });
});

router.get("/summary", async (_req, res) => {
  try {
    const r = await pgPool.query(
      `SELECT quotation_status AS status, COUNT(*)::int AS n FROM quotation GROUP BY quotation_status`,
    );
    res.json({ success: true, statuses: STATUSES, counts: r.rows });
  } catch (e) {
    console.error("[admin/quotation/summary]", e.message);
    fail(res, 500, "Unable to load summary.");
  }
});

// ---------------------------------------------------------------------------
// GET /list?status=&q=&page=&limit=
// ---------------------------------------------------------------------------
router.get("/list", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 15));
    const where = [];
    const params = [];
    if (req.query.status) {
      params.push(text(req.query.status));
      where.push(`q.quotation_status = $${params.length}`);
    }
    if (text(req.query.q)) {
      params.push(`%${text(req.query.q)}%`);
      const p = `$${params.length}`;
      where.push(`(q.quotation_no ILIKE ${p} OR c.company_name ILIKE ${p} OR c.email ILIKE ${p} OR c.contact_person ILIKE ${p})`);
    }
    params.push(limit, (page - 1) * limit);

    const r = await pgPool.query(
      `SELECT q.quotation_id, q.quotation_no, q.quotation_status, q.delivery_country,
              q.delivery_state, q.quotation_purpose,
              to_jsonb(q)->>'created_at' AS created_at,
              c.company_name, c.contact_person, c.email,
              i.height_mm, i.width_mm, i.gusset_mm,
              COALESCE(pm.paper_name, i.rate_paper_option_label) AS paper_name,
              pm.gsm,
              COALESCE(pr.printing_name, i.rate_printing_option_label) AS printing_name,
              COALESCE(hm.handle_name, i.rate_handle_option_label) AS handle_name,
              (SELECT array_agg(qq.quantity ORDER BY qq.quantity)
                 FROM quotation_quantity qq WHERE qq.quotation_item_id = i.quotation_item_id) AS quantities,
              COUNT(*) OVER()::int AS total
       FROM quotation q
       JOIN customer c ON c.customer_id = q.customer_id
       LEFT JOIN quotation_item i ON i.quotation_id = q.quotation_id
       LEFT JOIN paper_master pm ON pm.paper_id = i.paper_id
       LEFT JOIN printing_master pr ON pr.printing_id = i.printing_id
       LEFT JOIN handle_master hm ON hm.handle_id = i.handle_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY q.quotation_id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const rows = r.rows.map((x) => ({
      ...x,
      description: buildDescription({
        h: x.height_mm, w: x.width_mm, g: x.gusset_mm,
        paperName: x.paper_name, gsm: x.gsm, printingName: x.printing_name,
        handleName: x.handle_name, quantities: x.quantities,
      }),
    }));
    res.json({ success: true, page, limit, total: r.rows[0]?.total || 0, rows });
  } catch (e) {
    console.error("[admin/quotation/list]", e.message);
    fail(res, 500, "Unable to load quotations.");
  }
});

// ---------------------------------------------------------------------------
// Data checks: tells the admin whether what is stored looks correct.
// ---------------------------------------------------------------------------
function runChecks(q, customer, item, quantities, opts) {
  const out = [];
  const add = (level, msg) => out.push({ level, text: msg });

  if (!q.quotation_no) add("error", "Quotation number is missing.");
  else if (!new RegExp(`^QT-\\d{4}-0*${q.quotation_id}$`).test(q.quotation_no)) {
    add("warn", `Quotation number ${q.quotation_no} does not match the ID ${q.quotation_id}.`);
  }
  if (customer && String(customer.account_status).toUpperCase() !== "ACTIVE") {
    add("warn", `Customer account is ${customer.account_status}.`);
  }
  if (!item) {
    add("error", "No bag item was saved for this quotation.");
  } else {
    for (const [k, [min, max]] of Object.entries(LIMITS)) {
      const n = Number(item[k]);
      if (!isInt(n) || n < min || n > max) add("error", `${k.replace("_mm", "")} ${item[k]} mm is outside ${min}-${max} mm.`);
    }
    const inactive = (list, id, label) => {
      const row = list.find((x) => x.id === id);
      if (!row) add("error", `${label} is missing or no longer exists.`);
      else if (!row.active) add("warn", `${label} "${row.name}" is inactive.`);
    };
    if (item.rate_paper_option_key || item.rate_printing_option_key || item.rate_handle_option_key) {
      for (const [list, key, label] of [
        [opts.rate_papers, item.rate_paper_option_key, "Material"],
        [opts.rate_printing, item.rate_printing_option_key, "Printing"],
        [opts.rate_handles, item.rate_handle_option_key, "Handle"],
      ]) {
        if (!key || !list.some((option) => option.option_key === key)) add("warn", `${label} rate option is no longer active.`);
      }
    } else {
      inactive(opts.papers, item.paper_id, "Material");
      inactive(opts.printing, item.printing_id, "Printing");
      inactive(opts.handles, item.handle_id, "Handle");
    }

    if (quantities.length !== 4) add("error", `Expected 4 quantity tiers, found ${quantities.length}.`);
    if (new Set(quantities).size !== quantities.length) add("error", "Quantity tiers contain duplicates.");
    if (quantities.some((n) => n < MIN_QTY)) add("error", `A quantity is below the ${MIN_QTY} pcs minimum.`);
  }
  if (q.delivery_country === "MY" && (!q.delivery_area || !q.delivery_state)) add("warn", "Delivery area/state not provided yet.");
  if (q.delivery_country === "SG" && !/^\d{6}$/.test(q.postcode || "")) add("warn", "Singapore postcode not provided yet.");
  if (!out.length) add("ok", "All saved data passes the checks.");
  return out;
}

async function loadOptions() {
  const [p, pr, h, config] = await Promise.all([
    pgPool.query(`SELECT paper_id AS id, paper_code AS code, paper_name AS name, gsm, active FROM paper_master ORDER BY paper_code`),
    pgPool.query(`SELECT printing_id AS id, printing_code AS code, printing_name AS name, active FROM printing_master ORDER BY printing_code`),
    pgPool.query(`SELECT handle_id AS id, handle_code AS code, handle_name AS name, active FROM handle_master ORDER BY handle_code`),
    loadActiveQuotationRateConfig(),
  ]);
  return {
    papers: p.rows, printing: pr.rows, handles: h.rows,
    rate_papers: listRateCardOptions(config, "paper"),
    rate_printing: listRateCardOptions(config, "printing"),
    rate_handles: listRateCardOptions(config, "handle"),
  };
}

// ---------------------------------------------------------------------------
// GET /:id  full detail for the editor
// ---------------------------------------------------------------------------
router.get("/:id", requireNumericId, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const qr = await pgPool.query(`SELECT * FROM quotation WHERE quotation_id = $1`, [id]);
    if (!qr.rows.length) return fail(res, 404, "Quotation not found.");
    const q = qr.rows[0];

    const [cr, ir, opts] = await Promise.all([
      pgPool.query(
        `SELECT customer_id, customer_code, company_name, contact_person, email, phone, account_status
         FROM customer WHERE customer_id = $1`,
        [q.customer_id],
      ),
      pgPool.query(`SELECT * FROM quotation_item WHERE quotation_id = $1 ORDER BY quotation_item_id LIMIT 1`, [id]),
      loadOptions(),
    ]);
    const item = ir.rows[0] || null;
    let quantities = [];
    let estimates = [];
    if (item) {
      const qq = await pgPool.query(
        `SELECT quantity, estimated_unit_price, estimated_total_price
         FROM quotation_quantity WHERE quotation_item_id = $1 ORDER BY quantity`,
        [item.quotation_item_id],
      );
      quantities = qq.rows.map((r) => r.quantity);
      estimates = qq.rows
        .filter((r) => r.estimated_unit_price !== null && r.estimated_unit_price !== undefined)
        .map((r) => ({
          quantity: r.quantity,
          unit_price: r.estimated_unit_price,
          total_price: r.estimated_total_price,
        }));
    }
    const customer = cr.rows[0] || null;

    res.json({
      success: true,
      quotation: q,
      customer,
      item,
      quantities,
      estimates: estimates || [],
      options: opts,
      statuses: STATUSES.includes(q.quotation_status) ? STATUSES : [q.quotation_status, ...STATUSES],
      checks: runChecks(q, customer, item, quantities, opts),
      description: (() => {
        const paper = opts.papers.find((x) => x.id === (item && item.paper_id));
        const printing = opts.printing.find((x) => x.id === (item && item.printing_id));
        const handle = opts.handles.find((x) => x.id === (item && item.handle_id));
        return buildDescription({
          h: item && item.height_mm, w: item && item.width_mm, g: item && item.gusset_mm,
          paperName: (paper && paper.name) || (item && item.rate_paper_option_label), gsm: paper && paper.gsm,
          printingName: (printing && printing.name) || (item && item.rate_printing_option_label),
          handleName: (handle && handle.name) || (item && item.rate_handle_option_label), quantities,
        });
      })(),
    });
  } catch (e) {
    console.error("[admin/quotation/get]", e.message);
    fail(res, 500, "Unable to load this quotation.");
  }
});

// ---------------------------------------------------------------------------
// Validation for admin edits (same rules as the customer form)
// ---------------------------------------------------------------------------
function validateEdit(body = {}) {
  const v = {
    status: text(body.status),
    purpose: text(body.quotation_purpose),
    country: text(body.delivery_country).toUpperCase(),
    paper_option_key: text(body.paper_option_key),
    printing_option_key: text(body.printing_option_key),
    handle_option_key: text(body.handle_option_key),
    paper_id: Number(body.paper_id),
    printing_id: Number(body.printing_id),
    handle_id: Number(body.handle_id),
    gallery_bag_no: body.gallery_bag_no === "" || body.gallery_bag_no == null ? null : Number(body.gallery_bag_no),
  };
  v.rateOptionMode = [v.paper_option_key, v.printing_option_key, v.handle_option_key].every(Boolean);
  if (!STATUSES.includes(v.status)) return { error: "Please choose a valid status." };
  if (!PURPOSES.includes(v.purpose)) return { error: "Please choose a quotation purpose." };
  if (!["MY", "SG"].includes(v.country)) return { error: "Delivery country must be Malaysia or Singapore." };

  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(body[key]);
    if (!isInt(n) || n < min || n > max) return { error: `${key.replace("_mm", "")} must be a whole number between ${min} and ${max} mm.` };
    v[key] = n;
  }
  if (!v.rateOptionMode && ![v.paper_id, v.printing_id, v.handle_id].every(isInt)) return { error: "Please choose a material, printing detail and handle." };
  if (v.gallery_bag_no !== null && !(isInt(v.gallery_bag_no) && v.gallery_bag_no >= 1 && v.gallery_bag_no <= 99)) v.gallery_bag_no = null;

  const qty = Array.isArray(body.quantities) ? body.quantities.map(Number) : [];
  if (qty.length !== 4 || !qty.every((n) => isInt(n) && n >= MIN_QTY) || new Set(qty).size !== 4) {
    return { error: `Please provide four different quantities of at least ${MIN_QTY} pcs.` };
  }
  v.quantities = [...qty].sort((a, b) => a - b);

  const postcode = text(body.postcode);
  v.area = text(body.delivery_area).slice(0, 100) || null;
  v.state = text(body.delivery_state).slice(0, 100) || null;
  if (v.country === "MY" && postcode && !/^\d{5}$/.test(postcode)) return { error: "Malaysia postcode must be 5 digits." };
  if (v.country === "SG" && postcode && !/^\d{6}$/.test(postcode)) return { error: "Singapore postcode must be 6 digits." };
  v.postcode = postcode || null;
  return { value: v };
}

async function resolveLegacyRateOptions(database, v, config) {
  const [paperResult, printingResult, handleResult] = await Promise.all([
    database.query("SELECT paper_name, gsm FROM paper_master WHERE paper_id = $1", [v.paper_id]),
    database.query("SELECT printing_name FROM printing_master WHERE printing_id = $1", [v.printing_id]),
    database.query("SELECT handle_name FROM handle_master WHERE handle_id = $1", [v.handle_id]),
  ]);
  const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  const find = (group, candidates) => {
    const accepted = new Set(candidates.map(normalize).filter(Boolean));
    return listRateCardOptions(config, group).find((option) =>
      accepted.has(normalize(option.label)) || accepted.has(normalize(option.key)),
    );
  };
  const paperRow = paperResult.rows[0];
  const paper = find("paper", paperRow ? [paperRow.paper_name, `${paperRow.paper_name} ${paperRow.gsm}`] : []);
  const printing = find("printing", [printingResult.rows[0]?.printing_name]);
  const handle = find("handle", [handleResult.rows[0]?.handle_name]);
  if (!paper || !printing || !handle) {
    throw new Error("The selected legacy master values do not match active quotation rate-card options. Choose the matching rate-card types and try again.");
  }
  return { paper, printing, handle };
}

// ---------------------------------------------------------------------------
// PUT /:id  save header + item + quantity tiers in one transaction
// ---------------------------------------------------------------------------
router.put("/:id", requireNumericId, async (req, res) => {
  const { error, value: v } = validateEdit(req.body);
  if (error) return fail(res, 400, error);
  const id = Number(req.params.id);

  let client;
  let config;
  try {
    config = await loadActiveQuotationRateConfig();
  } catch (error) {
    console.error("[admin/quotation/update] Rate-card database error:", error);
    return fail(res, 503, "Active quotation rates are unavailable. Please try again later.");
  }
  let selected;
  let estimates;
  try {
    selected = v.rateOptionMode
      ? {
        paper: listRateCardOptions(config, "paper").find((option) => option.option_key === v.paper_option_key),
        printing: listRateCardOptions(config, "printing").find((option) => option.option_key === v.printing_option_key),
        handle: listRateCardOptions(config, "handle").find((option) => option.option_key === v.handle_option_key),
      }
      : await resolveLegacyRateOptions(pgPool, v, config);
    if (!selected.paper || !selected.printing || !selected.handle) {
      return fail(res, 422, "A selected quotation rate option is no longer active. Refresh the quotation and try again.");
    }
    estimates = calculateQuotationEstimates({
      ...v,
      paper_option_key: selected.paper.option_key,
      printing_option_key: selected.printing.option_key,
      handle_option_key: selected.handle.option_key,
    }, config);
  } catch (error) {
    console.error("[admin/quotation/update] Rate-card calculation error:", error);
    return fail(res, 422, error.message || "Unable to calculate this quotation.");
  }
  try {
    const [qUpdated, iUpdated, bagNo] = await Promise.all([
      hasColumn("quotation", "updated_at"),
      hasColumn("quotation_item", "updated_at"),
      hasColumn("quotation_item", "gallery_bag_no"),
    ]);
    client = await pgPool.connect();
    await client.query("BEGIN");

    const h = await client.query(
      `UPDATE quotation SET quotation_status = $1, quotation_purpose = $2, delivery_country = $3,
              delivery_state = $4, delivery_area = $5, postcode = $6, rate_version_id = $7${qUpdated ? ", updated_at = NOW()" : ""}
       WHERE quotation_id = $8 RETURNING quotation_id`,
      [v.status, v.purpose, v.country, v.state, v.area, v.postcode, config.versionId, id],
    );
    if (!h.rows.length) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Quotation not found.");
    }

    const itemParams = [
      v.height_mm, v.width_mm, v.gusset_mm,
      v.rateOptionMode ? null : v.paper_id,
      v.rateOptionMode ? null : v.printing_id,
      v.rateOptionMode ? null : v.handle_id,
      selected.paper.option_key, selected.paper.label,
      selected.printing.option_key, selected.printing.label,
      selected.handle.option_key, selected.handle.label,
    ];
    let sets = `height_mm=$1, width_mm=$2, gusset_mm=$3, paper_id=$4, printing_id=$5, handle_id=$6,
      rate_paper_option_key=$7, rate_paper_option_label=$8,
      rate_printing_option_key=$9, rate_printing_option_label=$10,
      rate_handle_option_key=$11, rate_handle_option_label=$12`;
    if (bagNo) {
      itemParams.push(v.gallery_bag_no);
      sets += `, gallery_bag_no=$${itemParams.length}`;
    }
    if (iUpdated) sets += ", updated_at = NOW()";
    itemParams.push(id);
    const item = await client.query(
      `UPDATE quotation_item SET ${sets} WHERE quotation_id = $${itemParams.length} RETURNING quotation_item_id`,
      itemParams,
    );
    if (!item.rows.length) {
      await client.query("ROLLBACK");
      return fail(res, 400, "This quotation has no item to edit.");
    }
    const itemId = item.rows[0].quotation_item_id;

    await client.query(`DELETE FROM quotation_quantity WHERE quotation_item_id = $1`, [itemId]);
    const quantityValues = [];
    const quantityTuples = estimates.map((estimate, index) => {
      const start = index * 5;
      quantityValues.push(itemId, estimate.quantity, estimate.unit_price, estimate.total_price, JSON.stringify(estimate.calculation_details));
      return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}::jsonb)`;
    });
    await client.query(
      `INSERT INTO quotation_quantity
         (quotation_item_id, quantity, estimated_unit_price, estimated_total_price, calculation_details)
       VALUES ${quantityTuples.join(", ")}`,
      quantityValues,
    );

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("[admin/quotation/update]", e.message);
    if (statusDbError(res, e, v.status)) return;
    fail(res, 500, "Unable to save changes. Nothing was changed.");
  } finally {
    if (client) client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /:id/decision  { status }  Accept / reject / cancel (or reopen) a quotation.
// Changes only the status, so a decision is never blocked by other fields.
// ---------------------------------------------------------------------------
router.post("/:id/decision", requireNumericId, async (req, res) => {
  const status = text(req.body && req.body.status).toUpperCase();
  if (!STATUSES.includes(status)) return fail(res, 400, "Please choose a valid status.");
  try {
    const withUpdated = await hasColumn("quotation", "updated_at");
    const r = await pgPool.query(
      `UPDATE quotation SET quotation_status = $1${withUpdated ? ", updated_at = NOW()" : ""}
       WHERE quotation_id = $2 RETURNING quotation_status`,
      [status, Number(req.params.id)],
    );
    if (!r.rows.length) return fail(res, 404, "Quotation not found.");
    res.json({ success: true, status: r.rows[0].quotation_status });
  } catch (e) {
    console.error("[admin/quotation/decision]", e.message);
    if (statusDbError(res, e, status)) return;
    fail(res, 500, "Unable to save the decision.");
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id  removes quantities, items, then the quotation
// ---------------------------------------------------------------------------
router.delete("/:id", requireNumericId, async (req, res) => {
  const id = Number(req.params.id);
  let client;
  try {
    client = await pgPool.connect();
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM quotation_quantity WHERE quotation_item_id IN (SELECT quotation_item_id FROM quotation_item WHERE quotation_id = $1)`,
      [id],
    );
    await client.query(`DELETE FROM quotation_item WHERE quotation_id = $1`, [id]);
    const d = await client.query(`DELETE FROM quotation WHERE quotation_id = $1`, [id]);
    await client.query("COMMIT");
    if (!d.rowCount) return fail(res, 404, "Quotation not found.");
    res.json({ success: true });
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("[admin/quotation/delete]", e.message);
    fail(res, 500, "Unable to delete this quotation.");
  } finally {
    if (client) client.release();
  }
});

module.exports = router;