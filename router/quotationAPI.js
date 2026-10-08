const express = require("express");
const pgPool = require("../db");

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
  try {
    const [papers, printing, handles] = await Promise.all([
      pgPool.query(
        `SELECT paper_id, paper_code, paper_name, paper_type, gsm, color
         FROM paper_master WHERE active = TRUE
         ORDER BY paper_code`,
      ),
      pgPool.query(
        `SELECT printing_id, printing_code, printing_name
         FROM printing_master WHERE active = TRUE
         ORDER BY printing_code`,
      ),
      pgPool.query(
        `SELECT handle_id, handle_code, handle_name
         FROM handle_master WHERE active = TRUE
         ORDER BY handle_code`,
      ),
    ]);

    res.json({
      success: true,
      papers: papers.rows,
      printing: printing.rows,
      handles: handles.rows,
    });
  } catch (error) {
    console.error("[quotation/options] Database error:", error.message);
    fail(res, 500, "Unable to load quotation options.");
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
    paper_id: Number(body.paper_id),
    printing_id: Number(body.printing_id),
    handle_id: Number(body.handle_id),
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

  if (![v.paper_id, v.printing_id, v.handle_id].every(isInt)) {
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

    const [paper, printing, handle] = await Promise.all([
      pgPool.query(`SELECT 1 FROM paper_master WHERE paper_id = $1 AND active = TRUE`, [v.paper_id]),
      pgPool.query(`SELECT 1 FROM printing_master WHERE printing_id = $1 AND active = TRUE`, [v.printing_id]),
      pgPool.query(`SELECT 1 FROM handle_master WHERE handle_id = $1 AND active = TRUE`, [v.handle_id]),
    ]);
    if (!paper.rows.length || !printing.rows.length || !handle.rows.length) {
      return fail(res, 400, "One of the selected options is no longer available. Please refresh and try again.");
    }

    const withBagNo = await supportsGalleryBagNo();

    client = await pgPool.connect();
    await client.query("BEGIN");

    const header = await client.query(
      `INSERT INTO quotation
         (customer_id, quotation_status, delivery_country, delivery_state,
          delivery_area, postcode, quotation_purpose)
       VALUES ($1, 'SUBMITTED', $2, $3, $4, $5, $6)
       RETURNING quotation_id`,
      [v.customer_id, v.country, v.state, v.area, v.postcode, v.purpose],
    );
    const quotationId = header.rows[0].quotation_id;

    // quotation_no is derived from the new id, e.g. QT-2026-000123
    const quotationNo = `QT-${new Date().getFullYear()}-${String(quotationId).padStart(6, "0")}`;
    await client.query(`UPDATE quotation SET quotation_no = $1 WHERE quotation_id = $2`, [quotationNo, quotationId]);

    const itemColumns = ["quotation_id", "height_mm", "width_mm", "gusset_mm", "paper_id", "printing_id", "handle_id"];
    const itemValues = [quotationId, v.height_mm, v.width_mm, v.gusset_mm, v.paper_id, v.printing_id, v.handle_id];
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

    await client.query(
      `INSERT INTO quotation_quantity (quotation_item_id, quantity)
       VALUES ($1, $2), ($1, $3), ($1, $4), ($1, $5)`,
      [itemId, ...v.quantities],
    );

    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      quotation_id: quotationId,
      quotation_no: quotationNo,
      quantities: v.quantities,
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
  const paper = x.paper_name ? (x.gsm && !/gsm/i.test(x.paper_name) ? `${x.gsm}gsm ${x.paper_name}` : x.paper_name) : "";
  const tiers = (x.quantities || []).map(kfmt).join("/");
  return [size, paper, x.printing_name, x.handle_name, tiers].filter(Boolean).join(" / ");
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
  SELECT q.quotation_id, q.quotation_no, q.quotation_status, q.quotation_purpose,
         q.delivery_country, q.delivery_state, q.delivery_area, q.postcode,
         to_jsonb(q)->>'created_at' AS created_at,
         to_jsonb(q)->>'updated_at' AS updated_at,
         i.height_mm, i.width_mm, i.gusset_mm, to_jsonb(i)->>'gallery_bag_no' AS gallery_bag_no,
         pm.paper_name, pm.gsm, pr.printing_name, hm.handle_name,
         (SELECT array_agg(qq.quantity ORDER BY qq.quantity)
            FROM quotation_quantity qq WHERE qq.quotation_item_id = i.quotation_item_id) AS quantities
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