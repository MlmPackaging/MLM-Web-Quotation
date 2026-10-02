const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const pgPool = require("./db");
const { createAdminToken } = require("./authToken");
const quotationRoutes = require("./router/quotationAPI");
const adminQuotationRoutes = require("./router/adminquotationAPI");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, "public");
const scriptsDirectory = path.join(__dirname, "scripts");

app.use(express.json());
app.use(express.static(publicDirectory));
app.use("/scripts", express.static(scriptsDirectory));
app.use("/api/quotation", quotationRoutes);
app.use("/api/admin/quotation", adminQuotationRoutes);

function publicUser(user) {
  return {
    user_id: user.user_id,
    user_email: user.user_email,
    user_phone: user.user_phone || "",
    user_name: user.user_name || "",
    job_title: user.user_jobtitle || "",
    role: user.user_role || "User",
    active: "Active",
  };
}

function getLoginCredential(body = {}) {
  return String(body.email || body.username || "").trim().toLowerCase();
}

// ================================
// CUSTOMER ACCOUNTS
// ================================
// Customers are a separate account type from staff/admin "user" rows above.
// They register and log in for themselves, from customer-login.html /
// register-customer.html, and land on quotation.html.

function publicCustomer(customer) {
  return {
    customer_id: customer.customer_id,
    customer_code: customer.customer_code,
    company_name: customer.company_name,
    company_registration_no: customer.company_registration_no || "",
    contact_person: customer.contact_person || "",
    customer_email: customer.email,
    customer_phone: customer.phone || "",
    address: customer.address || "",
    account_status: customer.account_status || "Active",
  };
}

// Creates the customer table on startup if it doesn't already exist, so no
// separate manual migration step is required.
async function ensureCustomerTable() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS customer (
      customer_id SERIAL PRIMARY KEY,
      customer_code VARCHAR(50) UNIQUE,
      company_name VARCHAR(255) NOT NULL,
      company_registration_no VARCHAR(100),
      contact_person VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone VARCHAR(50),
      address TEXT,
      account_status VARCHAR(20) NOT NULL DEFAULT 'Active',
      last_login TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

app.post("/api/customer/register", async (req, res) => {
  const companyName = String(req.body?.company_name || "").trim();
  const companyRegNo = String(req.body?.company_registration_no || "").trim();
  const contactPerson = String(req.body?.contact_person || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const phone = String(req.body?.phone || "").trim();
  const address = String(req.body?.address || "").trim();

  if (!companyName || !contactPerson || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Company name, contact person, email and password are required.",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters long.",
    });
  }

  try {
    const existing = await pgPool.query(
      `SELECT customer_id FROM customer WHERE LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const inserted = await pgPool.query(
      `INSERT INTO customer
         (company_name, company_registration_no, contact_person, email,
          password_hash, phone, address, account_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active')
       RETURNING customer_id`,
      [companyName, companyRegNo || null, contactPerson, email, passwordHash, phone || null, address || null],
    );
    const customerId = inserted.rows[0].customer_id;

    // customer_code is derived from the new id, e.g. CUST-000123
    const customerCode = `CUST-${String(customerId).padStart(6, "0")}`;
    const updated = await pgPool.query(
      `UPDATE customer
       SET customer_code = $1, updated_at = CURRENT_TIMESTAMP, last_login = CURRENT_TIMESTAMP
       WHERE customer_id = $2
       RETURNING customer_id, customer_code, company_name, company_registration_no,
                 contact_person, email, phone, address, account_status`,
      [customerCode, customerId],
    );

    return res.status(201).json({
      success: true,
      customer: publicCustomer(updated.rows[0]),
      redirect: "/html/quotation.html",
    });
  } catch (error) {
    console.error("[customer/register] Database error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

app.post("/api/customer/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  try {
    const result = await pgPool.query(
      `SELECT customer_id, customer_code, company_name, company_registration_no,
              contact_person, email, password_hash, phone, address, account_status
       FROM customer
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email],
    );

    const customer = result.rows[0];
    const passwordMatches = customer
      ? await bcrypt.compare(password, String(customer.password_hash || ""))
      : false;

    if (!customer || customer.account_status !== "Active" || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    await pgPool.query(
      `UPDATE customer SET last_login = CURRENT_TIMESTAMP WHERE customer_id = $1`,
      [customer.customer_id],
    );

    return res.json({
      success: true,
      customer: publicCustomer(customer),
      redirect: "/html/quotation.html",
    });
  } catch (error) {
    console.error("[customer/login] Database error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

// Mirrors /api/check-user, but against the customer table: quotation.html
// uses this on load to confirm a stored customer session is still valid.
app.post("/api/customer/check", async (req, res) => {
  try {
    const customerId = String(req.body?.customer_id || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!customerId || !email) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Customer ID and email are required.",
      });
    }

    const result = await pgPool.query(
      `SELECT customer_id, customer_code, company_name, company_registration_no,
              contact_person, email, phone, address, account_status
       FROM customer
       WHERE customer_id = $1
         AND LOWER(email) = $2
         AND account_status = 'Active'
       LIMIT 1`,
      [customerId, email],
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Invalid or inactive account.",
      });
    }

    return res.json({
      success: true,
      valid: true,
      customer: publicCustomer(result.rows[0]),
    });
  } catch (error) {
    console.error("[customer/check] Database error:", error.message);
    return res.status(500).json({
      success: false,
      valid: false,
      message: "Unable to verify account.",
    });
  }
});

app.post("/api/customer/logout", (_req, res) => {
  res.json({ success: true });
});

// The quotation module currently uses the browser's stored user as its session.
// This endpoint only verifies that the stored account is still active.
app.post("/api/check-user", async (req, res) => {
  try {
    const userId = String(req.body?.user_id || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!userId || !email) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "User ID and email are required.",
      });
    }

    const result = await pgPool.query(
      `SELECT user_id, user_email, user_phone, user_name, user_jobtitle,
              user_role, user_active
       FROM "user"
       WHERE user_id = $1
         AND LOWER(user_email) = $2
         AND user_active = 1
       LIMIT 1`,
      [userId, email],
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Invalid or inactive user.",
      });
    }

    return res.json({
      success: true,
      valid: true,
      user: publicUser(result.rows[0]),
    });
  } catch (error) {
    console.error("[check-user] Database error:", error.message);
    return res.status(500).json({
      success: false,
      valid: false,
      message: "Unable to verify user.",
    });
  }
});

app.post("/api/login", async (req, res) => {
  const credential = getLoginCredential(req.body);
  const password = String(req.body?.password || "");

  if (!credential || !password) {
    return res.status(400).json({
      success: false,
      message: "Email/username and password are required.",
    });
  }

  try {
    const result = await pgPool.query(
      `SELECT user_id, user_email, user_phone, user_name, user_jobtitle,
              user_role, user_password, user_active
       FROM "user"
       WHERE LOWER(user_email) = $1 OR LOWER(user_name) = $1
       LIMIT 1`,
      [credential],
    );

    const user = result.rows[0];
    const passwordMatches = user
      ? await bcrypt.compare(password, String(user.user_password || ""))
      : false;

    if (!user || user.user_active !== 1 || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email/username or password.",
      });
    }

    await pgPool.query(
      `UPDATE "user" SET user_last_login = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [user.user_id],
    );

    return res.json({
      success: true,
      user: publicUser(user),
      auth_token: createAdminToken(user),
      redirect: "/html/admin-quotation.html",
    });
  } catch (error) {
    console.error("[login] Database error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

app.post("/api/logout", (_req, res) => {
  res.json({ success: true });
});

app.get("/", (_req, res) => {
  res.redirect("/login.html");
});

app.get("/api/db-health", async (_req, res) => {
  try {
    await pgPool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

let server;

async function start() {
  try {
    await ensureCustomerTable();
  } catch (error) {
    console.error("[startup] Failed to ensure customer table exists:", error.message);
  }

  server = app.listen(PORT, () => {
    console.log(`Quotation login server running on http://localhost:${PORT}`);
  });
}

start();

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  if (!server) {
    await pgPool.end();
    process.exit(0);
    return;
  }
  server.close(async () => {
    await pgPool.end();
    process.exit(0);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));