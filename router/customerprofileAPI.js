const express = require("express");
const pgPool = require("../db");

const router = express.Router();
const text = (v) => String(v ?? "").trim();
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Editable fields. Only the ones that exist as columns on the customer table are saved.
const EDITABLE = ["company_name", "company_registration_no", "contact_person", "phone", "address"];
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

// Same identification as the quotation router: customer_id + email of an Active account.
async function findCustomer(body = {}) {
  const id = Number(body.customer_id);
  const email = text(body.email).toLowerCase();
  if (!Number.isInteger(id) || !email) return null;
  const r = await pgPool.query(
    `SELECT to_jsonb(c) AS j FROM customer c
     WHERE customer_id = $1 AND LOWER(email) = $2 AND UPPER(account_status) = 'ACTIVE' LIMIT 1`,
    [id, email],
  );
  return r.rows[0] ? r.rows[0].j : null;
}

// Only safe fields are returned (never the password).
const publicCustomer = (j) => ({
  customer_id: j.customer_id,
  customer_code: j.customer_code || "",
  company_name: j.company_name || "",
  company_registration_no: j.company_registration_no || "",
  contact_person: j.contact_person || "",
  email: j.email || "",
  phone: j.phone || "",
  address: j.address || "",
  account_status: j.account_status || "",
});

router.post("/me", async (req, res) => {
  try {
    const j = await findCustomer(req.body);
    if (!j) return fail(res, 401, "Please log in to see your profile.");
    res.json({ success: true, customer: publicCustomer(j) });
  } catch (e) {
    console.error("[customer-profile/me]", e.message);
    fail(res, 500, "Unable to load your profile.");
  }
});

router.post("/update", async (req, res) => {
  const b = req.body || {};
  const v = {
    company_name: text(b.company_name),
    company_registration_no: text(b.company_registration_no),
    contact_person: text(b.contact_person),
    phone: text(b.phone),
    address: text(b.address),
  };
  if (v.company_name.length < 2 || v.company_name.length > 150) return fail(res, 400, "Please enter your company name.");
  if (v.contact_person.length < 2 || v.contact_person.length > 100) return fail(res, 400, "Please enter a contact person.");
  if (v.company_registration_no.length > 50) return fail(res, 400, "Registration number is too long.");
  if (v.phone && !/^[0-9+()\-\s]{6,20}$/.test(v.phone)) return fail(res, 400, "Phone can only contain numbers, spaces, + ( ) and -.");
  if (v.address.length > 300) return fail(res, 400, "Address is too long (300 characters maximum).");

  try {
    const j = await findCustomer(b);
    if (!j) return fail(res, 401, "Please log in to edit your profile.");

    const sets = [];
    const params = [];
    for (const col of EDITABLE) {
      if (await hasColumn("customer", col)) {
        params.push(v[col] || null);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (await hasColumn("customer", "updated_at")) sets.push("updated_at = NOW()");
    params.push(j.customer_id);
    await pgPool.query(`UPDATE customer SET ${sets.join(", ")} WHERE customer_id = $${params.length}`, params);

    const fresh = await findCustomer(b);
    res.json({ success: true, customer: publicCustomer(fresh) });
  } catch (e) {
    console.error("[customer-profile/update]", e.message);
    fail(res, 500, "Unable to save your profile. Please try again.");
  }
});

module.exports = router;