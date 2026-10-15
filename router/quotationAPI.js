const express = require("express");
const pgPool = require("../db");
const {
  loadActiveQuotationRateConfig,
  calculateQuotationEstimates,
  listRateCardOptions,
} = require("./postgresQuotationRates");

const router = express.Router();

const PURPOSES = ["One-off order", "Repeat supply"];
const LIMITS = {
  height_mm: [100, 600],
  width_mm: [80, 500],
  gusset_mm: [40, 300],
};
const MIN_QTY = 500;

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

const isInt = (v) => Number.isInteger(v);
const text = (v) => String(v ?? "").trim();

function validateCalculationRequest(body = {}) {
  const v = {
    height_mm: Number(body.height_mm),
    width_mm: Number(body.width_mm),
    gusset_mm: Number(body.gusset_mm),
    paper_option_key: text(body.paper_option_key),
    printing_option_key: text(body.printing_option_key),
    handle_option_key: text(body.handle_option_key),
  };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!Number.isInteger(v[key]) || v[key] < min || v[key] > max) {
      return { error: `${key.replace("_mm", "")} must be a whole number between ${min} and ${max} mm.` };
    }
  }
  if (![v.paper_option_key, v.printing_option_key, v.handle_option_key].every(Boolean)) {
    return { error: "Please choose a material, printing detail and handle." };
  }
  const quantities = Array.isArray(body.quantities) ? body.quantities.map(Number) : [];
  if (quantities.length !== 4 || !quantities.every((q) => isInt(q) && q >= MIN_QTY) || new Set(quantities).size !== 4) {
    return { error: `Please provide four different quantities of at least ${MIN_QTY} pcs.` };
  }
  v.quantities = [...quantities].sort((a, b) => a - b);
  return { value: v };
}

// ---------------------------------------------------------------------------
// Optional column: quotation_item.gallery_bag_no
// If you add it (ALTER TABLE quotation_item ADD COLUMN gallery_bag_no INT;)
// the chosen gallery bag (Bag 1-16) is saved too. Without it, everything
// else still works.
// ---------------------------------------------------------------------------
let hasGalleryBagNo;
async function supportsGalleryBagNo() {
  if (hasGalleryBagNo === undefined) {
    const r = await pgPool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'quotation_item' AND column_name = 'gallery_bag_no' LIMIT 1`,
    );
    hasGalleryBagNo = r.rows.length > 0;
  }
  return hasGalleryBagNo;
}

// ---------------------------------------------------------------------------
// GET /api/quotation/options
// Everything the quotation form needs to fill its dropdowns.
// ---------------------------------------------------------------------------
router.get("/options", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const config = await loadActiveQuotationRateConfig();

    res.json({
      success: true,
      rate_version_id: config.versionId,
      max_quantity: config.params.input_quantity_max,
      papers: listRateCardOptions(config, "paper"),
      printing: listRateCardOptions(config, "printing"),
      handles: listRateCardOptions(config, "handle"),
    });
  } catch (error) {
    console.error("[quotation/options] PostgreSQL rate-card error:", error);
    fail(res, 503, "Unable to load the active quotation types from PostgreSQL.");
  }
});

router.post("/estimate", async (req, res) => {
  const { error, value } = validateCalculationRequest(req.body);
  if (error) return fail(res, 400, error);
  try {
    const config = await loadActiveQuotationRateConfig();
    const estimates = calculateQuotationEstimates(value, config);
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      rate_version_id: config.versionId,
      estimates: estimates.map(({ quantity, unit_price, total_price }) => ({ quantity, unit_price, total_price })),
    });
  } catch (error) {
    console.error("[quotation/estimate] Rate-card calculation error:", error);
    fail(res, 422, error.message || "Unable to calculate this quotation.");
  }
});

// ---------------------------------------------------------------------------
// Validation: returns { error } or { value } with cleaned data.
// ---------------------------------------------------------------------------
function validateQuotation(body = {}) {
  const v = {
    customer_id: Number(body.customer_id),
    email: text(body.email).toLowerCase(),
    gallery_bag_no: body.gallery_bag_no == null ? null : Number(body.gallery_bag_no),
    paper_option_key: text(body.paper_option_key),
    printing_option_key: text(body.printing_option_key),
    handle_option_key: text(body.handle_option_key),
    country: text(body.delivery_country).toUpperCase(),
    later: body.delivery_later === true,
    purpose: text(body.quotation_purpose),
  };

  if (!isInt(v.customer_id) || !v.email) return { error: "Customer ID and email are required." };

  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(body[key]);
    if (!isInt(n) || n < min || n > max) {
      return { error: `${key.replace("_mm", "")} must be a whole number between ${min} and ${max} mm.` };
    }
    v[key] = n;
  }

  if (![v.paper_option_key, v.printing_option_key, v.handle_option_key].every(Boolean)) {
    return { error: "Please choose a material, printing detail and handle." };
  }
  if (v.gallery_bag_no !== null && !(isInt(v.gallery_bag_no) && v.gallery_bag_no >= 1 && v.gallery_bag_no <= 99)) {
    v.gallery_bag_no = null;
  }

  const quantities = Array.isArray(body.quantities) ? body.quantities.map(Number) : [];
  if (
    quantities.length !== 4 ||
    !quantities.every((q) => isInt(q) && q >= MIN_QTY) ||
    new Set(quantities).size !== 4
  ) {
    return { error: `Please provide four different quantities of at least ${MIN_QTY} pcs.` };
  }
  v.quantities = [...quantities].sort((a, b) => a - b);

  if (!PURPOSES.includes(v.purpose)) return { error: "Please choose a quotation purpose." };

  if (!["MY", "SG"].includes(v.country)) return { error: "Delivery country must be Malaysia or Singapore." };

  v.area = null;
  v.state = null;
  v.postcode = null;
  if (!v.later) {
    const postcode = text(body.postcode);
    if (v.country === "MY") {
      v.area = text(body.delivery_area).slice(0, 100);
      v.state = text(body.delivery_state).slice(0, 100);
      if (!v.area || !v.state) return { error: "Please enter your delivery area and state." };
      if (postcode && !/^\d{5}$/.test(postcode)) return { error: "Malaysia postcode must be 5 digits." };
    } else if (!/^\d{6}$/.test(postcode)) {
      return { error: "Singapore postcode must be 6 digits." };
    }
    v.postcode = postcode || null;
  }

  return { value: v };
}

// ---------------------------------------------------------------------------
// POST /api/quotation
// Saves one quotation: header + item + four quantity tiers, in one transaction.
// Identifies the customer the same way /api/customer/check does
// (customer_id + email of an Active account).
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const { error, value: v } = validateQuotation(req.body);
  if (error) return fail(res, 400, error);

  let client;
  try {
    const customer = await pgPool.query(
      `SELECT customer_id FROM customer
       WHERE customer_id = $1 AND LOWER(email) = $2 AND UPPER(account_status) = 'ACTIVE'
       LIMIT 1`,
      [v.customer_id, v.email],
    );
    if (!customer.rows.length) return fail(res, 401, "Please log in again to submit your quotation.");

    let config;
    try {
      config = await loadActiveQuotationRateConfig();
    } catch (error) {
      console.error("[quotation/create] Rate-card database error:", error);
      return fail(res, 503, "Active quotation rates are unavailable. Please try again later.");
    }
    let estimates;
    try {
      estimates = calculateQuotationEstimates(v, config);
    } catch (error) {
      console.error("[quotation/create] Calculation error:", error);
      return fail(res, 422, error.message || "Unable to calculate this quotation.");
    }

    const withBagNo = await supportsGalleryBagNo();

    client = await pgPool.connect();
    await client.query("BEGIN");

    const header = await client.query(
      `INSERT INTO quotation
         (customer_id, quotation_status, delivery_country, delivery_state,
          delivery_area, postcode, quotation_purpose, rate_version_id)
       VALUES ($1, 'SUBMITTED', $2, $3, $4, $5, $6, $7)
       RETURNING quotation_id`,
      [v.customer_id, v.country, v.state, v.area, v.postcode, v.purpose, config.versionId],
    );
    const quotationId = header.rows[0].quotation_id;

    // quotation_no is derived from the new id, e.g. QT-2026-000123
    const quotationNo = `QT-${new Date().getFullYear()}-${String(quotationId).padStart(6, "0")}`;
    await client.query(`UPDATE quotation SET quotation_no = $1 WHERE quotation_id = $2`, [quotationNo, quotationId]);

    const paperOption = config.options.paper.byKey[v.paper_option_key];
    const printingOption = config.options.printing.byKey[v.printing_option_key];
    const handleOption = config.options.handle.byKey[v.handle_option_key];
    const itemColumns = [
      "quotation_id", "height_mm", "width_mm", "gusset_mm", "paper_id", "printing_id", "handle_id",
      "rate_paper_option_key", "rate_paper_option_label",
      "rate_printing_option_key", "rate_printing_option_label",
      "rate_handle_option_key", "rate_handle_option_label",
    ];
    const itemValues = [
      quotationId, v.height_mm, v.width_mm, v.gusset_mm, null, null, null,
      paperOption.key, paperOption.label,
      printingOption.key, printingOption.label,
      handleOption.key, handleOption.label,
    ];
    if (withBagNo) {
      itemColumns.push("gallery_bag_no");
      itemValues.push(v.gallery_bag_no);
    }
    const item = await client.query(
      `INSERT INTO quotation_item (${itemColumns.join(", ")})
       VALUES (${itemValues.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING quotation_item_id`,
      itemValues,
    );
    const itemId = item.rows[0].quotation_item_id;

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
    return res.status(201).json({
      success: true,
      quotation_id: quotationId,
      quotation_no: quotationNo,
      quantities: v.quantities,
      rate_version_id: config.versionId,
      estimates: estimates.map(({ quantity, unit_price, total_price }) => ({ quantity, unit_price, total_price })),
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("[quotation/create] Database error:", err.message);
    return fail(res, 500, "Unable to submit your quotation. Please try again.");
  } finally {
    if (client) client.release();
  }
});

// ---------------------------------------------------------------------------
// "My quotations": a customer sees ONLY their own quotations.
// Identified the same way as POST / (customer_id + email of an Active account).
// ---------------------------------------------------------------------------
const kfmt = (n) => (Number(n) >= 1000 ? `${+(Number(n) / 1000).toFixed(1)}k` : String(n));

function describe(x) {
  const size = x.height_mm ? `${x.height_mm} x ${x.width_mm} x ${x.gusset_mm}mm` : "";
  const paperName = x.paper_name || x.rate_paper_option_label;
  const paper = paperName ? (x.gsm && !/gsm/i.test(paperName) ? `${x.gsm}gsm ${paperName}` : paperName) : "";
  const tiers = (x.quantities || []).map(kfmt).join("/");
  return [size, paper, x.printing_name || x.rate_printing_option_label, x.handle_name || x.rate_handle_option_label, tiers].filter(Boolean).join(" / ");
}

async function activeCustomerId(body = {}) {
  const id = Number(body.customer_id);
  const email = text(body.email).toLowerCase();
  if (!isInt(id) || !email) return null;
  const r = await pgPool.query(
    `SELECT customer_id FROM customer
     WHERE customer_id = $1 AND LOWER(email) = $2 AND UPPER(account_status) = 'ACTIVE' LIMIT 1`,
    [id, email],
  );
  return r.rows.length ? id : null;
}

const MINE_SELECT = `
  SELECT q.quotation_id, q.quotation_no, q.quotation_status, q.quotation_purpose, q.rate_version_id,
         q.delivery_country, q.delivery_state, q.delivery_area, q.postcode,
         to_jsonb(q)->>'created_at' AS created_at,
         to_jsonb(q)->>'updated_at' AS updated_at,
         i.height_mm, i.width_mm, i.gusset_mm, to_jsonb(i)->>'gallery_bag_no' AS gallery_bag_no,
         COALESCE(pm.paper_name, i.rate_paper_option_label) AS paper_name,
         pm.gsm,
         COALESCE(pr.printing_name, i.rate_printing_option_label) AS printing_name,
         COALESCE(hm.handle_name, i.rate_handle_option_label) AS handle_name,
         i.rate_paper_option_label, i.rate_printing_option_label, i.rate_handle_option_label,
         (SELECT array_agg(qq.quantity ORDER BY qq.quantity)
            FROM quotation_quantity qq WHERE qq.quotation_item_id = i.quotation_item_id) AS quantities,
         (SELECT jsonb_agg(jsonb_build_object(
                   'quantity', qq.quantity,
                   'unit_price', qq.estimated_unit_price,
                   'total_price', qq.estimated_total_price
                 ) ORDER BY qq.quantity)
            FROM quotation_quantity qq WHERE qq.quotation_item_id = i.quotation_item_id) AS estimates
  FROM quotation q
  LEFT JOIN quotation_item i ON i.quotation_id = q.quotation_id
  LEFT JOIN paper_master pm ON pm.paper_id = i.paper_id
  LEFT JOIN printing_master pr ON pr.printing_id = i.printing_id
  LEFT JOIN handle_master hm ON hm.handle_id = i.handle_id`;

// POST /api/quotation/mine  { customer_id, email } -> that customer's quotations (newest first)
router.post("/mine", async (req, res) => {
  try {
    const customerId = await activeCustomerId(req.body);
    if (!customerId) return fail(res, 401, "Please log in to see your quotations.");
    const r = await pgPool.query(
      `${MINE_SELECT} WHERE q.customer_id = $1 ORDER BY q.quotation_id DESC LIMIT 200`,
      [customerId],
    );
    res.json({ success: true, rows: r.rows.map((x) => ({ ...x, description: describe(x) })) });
  } catch (error) {
    console.error("[quotation/mine] Database error:", error.message);
    fail(res, 500, "Unable to load your quotations.");
  }
});

// POST /api/quotation/mine/:id  { customer_id, email } -> one quotation, only if it is theirs
router.post("/mine/:id", async (req, res) => {
  try {
    const customerId = await activeCustomerId(req.body);
    if (!customerId) return fail(res, 401, "Please log in to see your quotations.");
    const quotationId = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(quotationId) || quotationId < 1) {
      return fail(res, 400, "Invalid quotation ID.");
    }
    const r = await pgPool.query(
      `${MINE_SELECT} WHERE q.quotation_id = $1 AND q.customer_id = $2`,
      [quotationId, customerId],
    );
    if (!r.rows.length) return fail(res, 404, "Quotation not found.");
    res.json({ success: true, quotation: { ...r.rows[0], description: describe(r.rows[0]) } });
  } catch (error) {
    console.error("[quotation/mine/id] Database error:", error.message);
    fail(res, 500, "Unable to load this quotation.");
  }
});

module.exports = router;