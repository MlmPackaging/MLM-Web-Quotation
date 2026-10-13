const express = require("express");
const pgPool = require("../db");
const { verifyAdminToken } = require("../authToken");

const router = express.Router();
const text = (v) => String(v ?? "").trim();
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Same staff check as adminquotationAPI.js
async function requireAdmin(req, res, next) {
  const token = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = verifyAdminToken(token);
  if (!claims) return fail(res, 401, "Please log in again.");
  try {
    const r = await pgPool.query(
      `SELECT user_id FROM "user" WHERE user_id = $1 AND LOWER(user_email) = $2 AND user_active = 1 LIMIT 1`,
      [claims.user_id, claims.email],
    );
    if (!r.rows.length) return fail(res, 401, "Please log in as an admin.");
    req.adminId = r.rows[0].user_id;
    next();
  } catch (e) {
    console.error("[admin/profile/auth]", e.message);
    fail(res, 500, "Unable to verify admin access.");
  }
}
router.use(requireAdmin);

// The phone column on "user" may be called different things. Run sql/admin_phone_column.sql to add user_phone.
const PHONE_COLUMNS = ["user_phone", "phone", "user_phone_no"];
async function phoneColumn() {
  const r = await pgPool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'user' AND column_name = ANY($1)`,
    [PHONE_COLUMNS],
  );
  return PHONE_COLUMNS.find((c) => r.rows.some((x) => x.column_name === c)) || null;
}

async function load(id) {
  const r = await pgPool.query(`SELECT to_jsonb(u) AS j FROM "user" u WHERE user_id = $1`, [id]);
  const j = r.rows[0].j;
  const col = await phoneColumn();
  return {
    user_id: j.user_id,
    name: j.user_name || "",
    email: j.user_email || "",
    role: j.user_role || "",
    phone: col ? j[col] || "" : "",
    phone_supported: !!col,
  };
}

router.get("/", async (req, res) => {
  try {
    res.json({ success: true, user: await load(req.adminId) });
  } catch (e) {
    console.error("[admin/profile/get]", e.message);
    fail(res, 500, "Unable to load your profile.");
  }
});

router.put("/", async (req, res) => {
  const name = text(req.body && req.body.name);
  const phone = text(req.body && req.body.phone);
  if (name.length < 2 || name.length > 100) return fail(res, 400, "Please enter your name.");
  if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) return fail(res, 400, "Phone can only contain numbers, spaces, + ( ) and -.");
  try {
    const col = await phoneColumn();
    const params = [name];
    let sql = `UPDATE "user" SET user_name = $1`;
    if (col) { params.push(phone || null); sql += `, ${col} = $2`; }   // col comes from a fixed list
    params.push(req.adminId);
    await pgPool.query(`${sql} WHERE user_id = $${params.length}`, params);
    res.json({ success: true, user: await load(req.adminId) });
  } catch (e) {
    console.error("[admin/profile/update]", e.message);
    fail(res, 500, "Unable to save your profile.");
  }
});

module.exports = router;