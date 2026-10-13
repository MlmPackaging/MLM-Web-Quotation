const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const VALID_QUOTATION_STATUSES = ["draft", "submitted", "reviewed", "approved", "rejected"];

function createQuotationBackend({
  database,
  logger,
  addAuditLogEntryWithRetry,
  resolveAuditAccount,
  createAuditFieldEntry,
  summarizeAuditChanges,
}) {
  if (
    !database ||
    typeof database.query !== "function" ||
    !logger ||
    typeof logger.apiRequest !== "function" ||
    typeof logger.apiSuccess !== "function" ||
    typeof logger.apiFail !== "function" ||
    typeof addAuditLogEntryWithRetry !== "function" ||
    typeof resolveAuditAccount !== "function" ||
    typeof createAuditFieldEntry !== "function" ||
    typeof summarizeAuditChanges !== "function"
  ) {
    throw new TypeError("Quotation backend requires the host application's audit helpers.");
  }

  const router = express.Router();

  function normalizeQuotationRequester(input = {}) {
    const email = String(input.user_email || input.email || "").trim();
    const userName = String(
      input.user_name || input.contact_person || input.contactPerson || input.name || email || "User",
    ).trim();

    return {
      user_id: String(input.user_id || input.userId || input.id || "").trim(),
      user_email: email,
      user_phone: String(input.user_phone || input.phone || "").trim(),
      user_name: userName || "User",
      role: String(input.role || "User").trim() || "User",
      company_name: String(
        input.company_name || input.companyName || input.company || userName || email || "MLM Customer",
      ).trim(),
      address: String(input.address || "").trim(),
    };
  }

  function getQuotationRequester(req) {
    return normalizeQuotationRequester({
      ...(req.query || {}),
      ...(req.body?.requester || {}),
    });
  }

  function formatQuotationAmount(value) {
    return `RM ${Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatRelativeTime(isoValue) {
    const timestamp = new Date(isoValue).getTime();
    if (!Number.isFinite(timestamp)) return "Just now";

    const diffMs = Date.now() - timestamp;
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  function nowMYSQL() {
    // Returns "YYYY-MM-DD HH:MM:SS" in Malaysia time (UTC+8), for MySQL DATETIME/TIMESTAMP columns
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  function createQuotationNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `QT-${y}${m}${d}-${suffix}`;
  }

  function getUserQuotationMatches(quotation, requester) {
    const requesterId = String(requester.user_id || "");
    const quotationId = String(quotation.user_id || "");
    const requesterEmail = String(requester.user_email || "").toLowerCase();
    const quotationEmail = String(quotation.user_email || "").toLowerCase();

    return Boolean(
      (requesterId && quotationId && requesterId === quotationId) ||
      (requesterEmail && quotationEmail && requesterEmail === quotationEmail),
    );
  }

  function buildQuotationUserPayload(requester) {
    return {
      id: requester.user_id || "",
      email: requester.user_email || "",
      phone: requester.user_phone || "",
      role: requester.role || "User",
      contact_person: requester.user_name || "User",
      company_name: requester.company_name || "MLM Customer",
      address: requester.address || "",
    };
  }

  function buildQuotationActivity(type, quotation, timestamp = new Date().toISOString()) {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      type,
      user: quotation.user_company || quotation.user_contact_person || "Quotation User",
      time: timestamp,
      amount: formatQuotationAmount(quotation.total_amount),
    };
  }

  function normalizeQuotationRow(row) {
    let quotationData = row.quotation_data || {};

    if (typeof quotationData === "string") {
      try {
        quotationData = JSON.parse(quotationData);
      } catch (error) {
        quotationData = {};
      }
    }

    return {
      ...row,
      user_id: row.user_id ? String(row.user_id) : "",
      total_amount: row.total_amount == null ? 0 : Number(row.total_amount),
      quotation_data: quotationData,
    };
  }

  async function initializeQuotationTables() {
    await database.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        quotation_number VARCHAR(100) UNIQUE NOT NULL,
        status ENUM('draft', 'submitted', 'reviewed', 'approved', 'rejected') DEFAULT 'draft',
        total_amount DECIMAL(15,2),
        user_id VARCHAR(100),
        user_email VARCHAR(255),
        user_phone VARCHAR(50),
        user_name VARCHAR(255),
        user_company VARCHAR(255),
        user_contact_person VARCHAR(255),
        user_address TEXT,
        quotation_data JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_quotations_user_id (user_id),
        INDEX idx_quotations_user_email (user_email),
        INDEX idx_quotations_status (status),
        INDEX idx_quotations_updated_at (updated_at)
      )
    `);

    await database.query(`
      CREATE TABLE IF NOT EXISTS quotation_audit_log (
        audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_timestamp DATETIME NOT NULL,
        account VARCHAR(255) NOT NULL DEFAULT 'Unknown',
        action VARCHAR(50) NOT NULL,
        module VARCHAR(100) NOT NULL DEFAULT 'Quotation',
        identifier VARCHAR(255) NOT NULL DEFAULT '',
        change_summary TEXT,
        data_payload JSON,
        INDEX idx_quotation_audit_timestamp (event_timestamp),
        INDEX idx_quotation_audit_identifier (identifier)
      )
    `);
  }

  async function fetchUserQuotations(requester) {
    const filters = [];
    const params = [];

    if (requester.user_id) {
      filters.push("user_id = ?");
      params.push(requester.user_id);
    }

    if (requester.user_email) {
      filters.push("LOWER(user_email) = LOWER(?)");
      params.push(requester.user_email);
    }

    if (!filters.length) {
      return [];
    }

    const [rows] = await database.query(
      `SELECT *
       FROM quotations
       WHERE ${filters.join(" OR ")}
       ORDER BY COALESCE(updated_at, created_at) DESC`,
      params,
    );

    return rows.map(normalizeQuotationRow);
  }

  async function fetchAllQuotations() {
    const [rows] = await database.query(
      `SELECT *
       FROM quotations
       ORDER BY COALESCE(updated_at, created_at) DESC`,
    );

    return rows.map(normalizeQuotationRow);
  }

  async function fetchQuotationById(id) {
    const [rows] = await database.query("SELECT * FROM quotations WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? normalizeQuotationRow(rows[0]) : null;
  }

  async function insertQuotation(quotation) {
    const ts = nowMYSQL();
    const [result] = await database.query(
      `INSERT INTO quotations
        (quotation_number, status, total_amount, user_id, user_email, user_phone,
         user_name, user_company, user_contact_person, user_address, quotation_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation.quotation_number,
        quotation.status,
        quotation.total_amount,
        quotation.user_id || null,
        quotation.user_email || null,
        quotation.user_phone || null,
        quotation.user_name || null,
        quotation.user_company || null,
        quotation.user_contact_person || null,
        quotation.user_address || null,
        JSON.stringify(quotation.quotation_data || {}),
        ts,
        ts,
      ],
    );

    return fetchQuotationById(result.insertId);
  }

  async function updateQuotationStatus(id, status) {
    await database.query("UPDATE quotations SET status = ?, updated_at = ? WHERE id = ?", [
      status,
      nowMYSQL(),
      id,
    ]);

    return fetchQuotationById(id);
  }

  async function deleteQuotationById(id) {
    await database.query("DELETE FROM quotations WHERE id = ?", [id]);
  }

  async function buildQuotationAdminActivity() {
    const [rows] = await database.query(
      `SELECT id, status, user_company, user_contact_person, total_amount, updated_at, created_at
       FROM quotations
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 8`,
    );

    return rows.map((row) =>
      buildQuotationActivity(
        `quotation_${row.status || "created"}`,
        normalizeQuotationRow(row),
        row.updated_at || row.created_at,
      ),
    ).map((item) => ({
      ...item,
      time: formatRelativeTime(item.time),
    }));
  }

  function sanitizeText(text) {
    if (typeof text !== "string") return text || "";
    return text
      .replace(/\u0000/g, "")
      .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F]/g, "")
      .trim();
  }

  function generateProfessionalPDF(quotation) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: 40,
          lang: "en",
          info: {
            Title: `Quotation ${quotation.quotation_number}`,
            Author: "MLM Packaging Sdn Bhd",
            Creator: "Quotation System",
            Keywords: "quotation, packaging, bag, pricing",
          },
        });

        const chunks = [];
        doc.on("data", chunks.push.bind(chunks));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const leftMargin = 40;
        const rightMargin = 40;
        const contentWidth = pageWidth - leftMargin - rightMargin;
        const colors = {
          primary: "#2c3e50",
          accent: "#e74c3c",
          success: "#27ae60",
          light: "#ecf0f1",
          dark: "#2c3e50",
          border: "#bdc3c7",
        };

        let quotationData = {};
        try {
          quotationData =
            typeof quotation.quotation_data === "string"
              ? JSON.parse(quotation.quotation_data)
              : quotation.quotation_data || {};
        } catch (error) {
          quotationData = {};
        }

        const getFromQuotationData = (path, defaultValue = "") => {
          try {
            const keys = path.split(".");
            let value = quotationData;
            for (const key of keys) {
              value = value?.[key];
              if (value === undefined || value === null) return defaultValue;
            }
            return sanitizeText(String(value || defaultValue));
          } catch (error) {
            return sanitizeText(defaultValue);
          }
        };

        const clientCompany = sanitizeText(quotation.user_company || quotation.company_name || "N/A") || "N/A";
        const clientContactPerson = sanitizeText(quotation.user_contact_person || quotation.contact_person || "N/A") || "N/A";
        const clientPhone = sanitizeText(quotation.user_phone || quotation.phone || "N/A") || "N/A";
        const clientEmail = sanitizeText(quotation.user_email || quotation.email || "N/A") || "N/A";
        const clientAddress = sanitizeText(quotation.user_address || quotation.address || "N/A") || "N/A";

        const width = getFromQuotationData("input.dimensions.width", getFromQuotationData("width", ""));
        const height = getFromQuotationData("input.dimensions.height", getFromQuotationData("height", ""));
        const gusset = getFromQuotationData("input.dimensions.gusset", getFromQuotationData("gusset", ""));
        const paperType = getFromQuotationData("input.paper", getFromQuotationData("paperName", ""));
        const printing = getFromQuotationData("input.printing", getFromQuotationData("printingOption", ""));
        const quantity = getFromQuotationData("input.quantity", getFromQuotationData("quantity", ""));
        const handleType = getFromQuotationData("input.handleType", "");
        const bottomType = getFromQuotationData("input.bottomType", "");
        const coating =
          getFromQuotationData("input.finishing.varnish", "") ||
          getFromQuotationData("input.varnish", "");
        const color = getFromQuotationData("input.color", "");
        const thickness = getFromQuotationData("input.thickness", "");
        const totalCost = parseFloat(getFromQuotationData("summary.totalCost", "0")) || 0;
        const unitCost = parseFloat(getFromQuotationData("summary.unitCost", "0")) || 0;
        const unitSelling = parseFloat(getFromQuotationData("summary.unitSellingPrice", "0")) || 0;
        const totalAmount = parseFloat(quotation.total_amount || "0") || 0;

        const logoCandidates = [
          path.join(__dirname, "images", "MLM Logo.png"),
          path.join(__dirname, "images", "MLM Packaging Logo.png"),
        ];
        const logoPath = logoCandidates.find((candidate) => fs.existsSync(candidate));
        if (logoPath) {
          doc.image(logoPath, leftMargin, 20, {
            width: 80,
            height: 60,
            fit: [80, 60],
          });
        }

        const companyX = leftMargin + 100;
        doc.fillColor(colors.primary)
          .fontSize(16)
          .font("Helvetica-Bold")
          .text("MLM PACKAGING SDN BHD", companyX, 25, { width: 280 });

        doc.fillColor("#7f8c8d")
          .fontSize(9)
          .font("Helvetica")
          .text("No. 123, Jalan Industri 3, Taman Perindustrian Puchong", companyX, 45, { width: 280 })
          .text("47100 Puchong, Selangor Darul Ehsan", companyX, 58, { width: 280 });

        doc.fillColor(colors.dark)
          .fontSize(8)
          .font("Helvetica")
          .text("Tel: +603-8066 1234", companyX, 72)
          .text("Email: sales@mlmpackaging.com", companyX, 84);

        const quoteBoxWidth = 160;
        const quoteBoxX = pageWidth - quoteBoxWidth - 30;
        doc.roundedRect(quoteBoxX, 25, quoteBoxWidth, 60, 5).fill("#ffffff").stroke(colors.border);

        doc.fillColor(colors.accent)
          .fontSize(12)
          .font("Helvetica-Bold")
          .text("QUOTATION", quoteBoxX + 10, 40);

        doc.fillColor(colors.primary)
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(sanitizeText(quotation.quotation_number || "N/A"), quoteBoxX + 10, 55, {
            width: quoteBoxWidth - 20,
          });

        doc.fillColor("#7f8c8d")
          .fontSize(8)
          .font("Helvetica")
          .text(new Date(quotation.created_at).toLocaleDateString("en-MY"), quoteBoxX + 10, 70, {
            width: quoteBoxWidth - 20,
          });

        doc.y = 110;
        doc.moveTo(leftMargin, doc.y)
          .lineTo(pageWidth - rightMargin, doc.y)
          .strokeColor(colors.border)
          .lineWidth(1)
          .stroke();
        doc.y += 15;

        doc.fillColor(colors.primary)
          .fontSize(12)
          .font("Helvetica-Bold")
          .text("BILL TO:", leftMargin, doc.y);
        doc.y += 20;

        const clientBoxY = doc.y;
        const clientBoxHeight = 100;
        doc.roundedRect(leftMargin, clientBoxY, contentWidth, clientBoxHeight, 5)
          .fill("#ffffff")
          .stroke(colors.border);

        let clientTextY = clientBoxY + 15;
        doc.fillColor(colors.dark)
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(clientCompany, leftMargin + 15, clientTextY, { width: contentWidth - 150 });
        clientTextY += 18;

        doc.fillColor("#34495e")
          .fontSize(9)
          .font("Helvetica")
          .text(`Contact Person: ${clientContactPerson}`, leftMargin + 15, clientTextY, { width: 170 });
        clientTextY += 15;
        doc.text(`Phone: ${clientPhone}`, leftMargin + 15, clientTextY, { width: 170 });
        clientTextY += 15;
        doc.text(`Email: ${clientEmail}`, leftMargin + 15, clientTextY, { width: contentWidth - 30 });
        clientTextY += 15;
        doc.text(`Address: ${clientAddress}`, leftMargin + 15, clientTextY, { width: contentWidth - 30 });

        const safeStatus = sanitizeText(quotation.status || "draft");
        const statusColors = {
          draft: "#f39c12",
          submitted: "#3498db",
          reviewed: "#9b59b6",
          approved: colors.success,
          rejected: colors.accent,
        };
        const statusX = pageWidth - rightMargin - 95;
        const statusY = clientBoxY + 15;
        doc.roundedRect(statusX, statusY, 80, 22, 11).fill(statusColors[safeStatus] || colors.dark);
        doc.fillColor("#ffffff")
          .fontSize(9)
          .font("Helvetica-Bold")
          .text(safeStatus.toUpperCase(), statusX + 10, statusY + 6);

        doc.y = clientBoxY + clientBoxHeight + 15;

        const ensureSpace = (neededHeight) => {
          if (doc.y + neededHeight < pageHeight - 50) return;
          doc.addPage();
          doc.y = 40;
        };

        ensureSpace(190);
        doc.fillColor(colors.primary)
          .fontSize(14)
          .font("Helvetica-Bold")
          .text("PRODUCT SPECIFICATIONS", leftMargin, doc.y);
        doc.y += 20;

        const tableTop = doc.y;
        const colWidths = [120, 120, 120, 95];
        doc.rect(leftMargin, tableTop, contentWidth, 25).fill(colors.primary);

        let xPos = leftMargin + 10;
        ["Description", "Specifications", "Material", "Printing"].forEach((header, i) => {
          doc.fillColor("#ffffff").fontSize(10).font("Helvetica-Bold").text(header, xPos, tableTop + 9);
          xPos += colWidths[i];
        });

        doc.rect(leftMargin, tableTop + 25, contentWidth, 25).fill("#ffffff").stroke(colors.border);
        xPos = leftMargin + 10;
        doc.fillColor(colors.primary).fontSize(9).font("Helvetica-Bold").text("Custom Paper Bag", xPos, tableTop + 34, { width: colWidths[0] - 10 });
        xPos += colWidths[0];
        doc.fillColor(colors.dark).fontSize(9).font("Helvetica").text(`W: ${width || "N/A"}mm x H: ${height || "N/A"}mm x G: ${gusset || "N/A"}mm`, xPos, tableTop + 34, { width: colWidths[1] - 10 });
        xPos += colWidths[1];
        doc.text(paperType || "N/A", xPos, tableTop + 34, { width: colWidths[2] - 10 });
        xPos += colWidths[2];
        doc.text(printing || "N/A", xPos, tableTop + 34, { width: colWidths[3] - 10 });

        doc.y = tableTop + 60;
        const specifications = [
          { label: "Quantity", value: `${quantity || "N/A"} pieces` },
          { label: "Handle Type", value: handleType || "N/A" },
          { label: "Bottom Type", value: bottomType || "N/A" },
          { label: "Coating", value: coating || "N/A" },
          { label: "Color", value: color || "N/A" },
          { label: "Thickness", value: thickness || "N/A" },
        ];

        const specStartY = doc.y;
        const specColWidth = contentWidth / 2 - 10;
        specifications.forEach((spec, index) => {
          const col = index % 2;
          const row = Math.floor(index / 2);
          const x = leftMargin + col * (specColWidth + 20);
          const y = specStartY + row * 20;
          doc.fillColor("#7f8c8d").fontSize(9).font("Helvetica").text(`${spec.label}:`, x, y);
          doc.fillColor(colors.dark).fontSize(9).font("Helvetica-Bold").text(spec.value, x + 70, y);
        });
        doc.y = specStartY + Math.ceil(specifications.length / 2) * 20 + 25;

        ensureSpace(250);
        doc.fillColor(colors.primary)
          .fontSize(14)
          .font("Helvetica-Bold")
          .text("PRICING BREAKDOWN", leftMargin, doc.y);
        doc.y += 20;

        const priceTableTop = doc.y;
        const priceColWidths = [contentWidth - 130, 130];
        const pricingItems = [
          { description: "Material Cost", amount: totalCost * 0.4 },
          { description: "Printing Cost", amount: totalCost * 0.3 },
          { description: "Production Cost", amount: totalCost * 0.2 },
          { description: "Handling & Packaging", amount: totalCost * 0.1 },
          { description: "Subtotal", amount: totalCost },
        ];

        doc.rect(leftMargin, priceTableTop, contentWidth, 25).fill(colors.light).stroke(colors.border);
        doc.fillColor(colors.primary).fontSize(10).font("Helvetica-Bold").text("DESCRIPTION", leftMargin + 10, priceTableTop + 9);
        doc.text("AMOUNT (RM)", leftMargin + priceColWidths[0] + 10, priceTableTop + 9, {
          width: priceColWidths[1] - 20,
          align: "right",
        });

        let currentY = priceTableTop + 25;
        pricingItems.forEach((item, index) => {
          doc.rect(leftMargin, currentY, contentWidth, 25)
            .fill(index % 2 === 0 ? "#ffffff" : colors.light)
            .stroke(colors.border);
          doc.fillColor(colors.dark).fontSize(9).font("Helvetica").text(item.description, leftMargin + 10, currentY + 9);
          doc.fillColor(colors.primary).fontSize(9).font("Helvetica-Bold").text(item.amount.toFixed(2), leftMargin + priceColWidths[0] + 10, currentY + 9, {
            width: priceColWidths[1] - 20,
            align: "right",
          });
          currentY += 25;
        });

        currentY += 10;
        [
          { label: "Unit Production Cost", value: `RM ${unitCost.toFixed(4)}` },
          { label: "Unit Selling Price", value: `RM ${unitSelling.toFixed(4)}` },
          { label: "Quantity", value: String(parseFloat(quantity) || 0) },
        ].forEach((item) => {
          doc.fillColor(colors.dark).fontSize(9).font("Helvetica").text(item.label, leftMargin + 10, currentY);
          doc.fillColor(colors.primary).fontSize(9).font("Helvetica-Bold").text(item.value, leftMargin + priceColWidths[0] + 10, currentY, {
            width: priceColWidths[1] - 20,
            align: "right",
          });
          currentY += 15;
        });

        currentY += 10;
        doc.rect(leftMargin, currentY, contentWidth, 40).fill(colors.primary);
        doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold").text("TOTAL SELLING PRICE", leftMargin + 10, currentY + 12);
        doc.text(`RM ${totalAmount.toFixed(2)}`, leftMargin + priceColWidths[0] + 10, currentY + 10, {
          width: priceColWidths[1] - 20,
          align: "right",
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  //------------------------------------------------------------Production Web App-----------------------------------------------------------
  const toExcelDate = (date) => {
    if (!(date instanceof Date)) return null;

    // Excel's date system starts on January 1, 1900, which is day 1. JavaScript's Date starts on January 1, 1970 (Unix epoch).
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`; // ? Excel safe
  };

  //Convert various date formats (Excel serial, dd/mm/yyyy, ISO) to consistent dd/mm/yyyy for frontend display
  const displayDate = (value) => {
    if (value === undefined || value === null || value === "" || value === "-")
      return "";

    let raw = value;
    if (typeof raw === "string") raw = raw.trim();

    // ? 1. Handle Excel serial numbers (numeric values)
    if (typeof raw === "number" || (!isNaN(raw) && raw !== "")) {
      const num = Number(raw);
      if (num > 0) {
        const date = new Date(Math.round((num - 25569) * 86400 * 1000));
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
      }
    }

    // 2. Handle DD/MM/YYYY or YYYY-MM-DD formats
    if (typeof raw === "string" && (raw.includes("/") || raw.includes("-"))) {
      const parts = raw.replace(/\s+/g, "").split(/[-\/]/);
      if (parts.length === 3) {
        let [p1, p2, p3] = parts;
        let day;
        let month;
        let year;
        if (p1.length === 4) {
          year = p1;
          month = p2;
          day = p3;
        } else {
          day = p1;
          month = p2;
          year = p3;
        }
        if (year.length === 2) year = "20" + year;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day));
        if (!isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
      }
    }

    // 3. Fallback: try to parse with Date constructor (handles ISO and other formats)
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }

    return "-";
  };

  // Convert various date formats to consistent yyyy-MM-dd for Excel input (handles Excel serial, dd/mm/yyyy, ISO)
  const formatDateForExcel = (value) => {
    if (!value || value === "-") return "";

    let raw = typeof value === "string" ? value.trim() : value;
    let date;

    // 1. Excel serial number (FIXED timezone)
    if (!isNaN(raw) && raw !== "") {
      const num = Number(raw);
      if (num > 0) {
        const utcDate = new Date(Math.round((num - 25569) * 86400 * 1000));
        date = new Date(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth(),
          utcDate.getUTCDate(),
        );
      }
    }

    // 2. Handle DD/MM/YYYY or YYYY-MM-DD
    if (
      !date &&
      typeof raw === "string" &&
      (raw.includes("/") || raw.includes("-"))
    ) {
      const parts = raw.replace(/\s+/g, "").split(/[-\/]/);

      if (parts.length === 3) {
        let [p1, p2, p3] = parts;
        let day, month, year;

        if (Number(p1) > 31) {
          // YYYY-MM-DD
          year = p1;
          month = p2;
          day = p3;
        } else {
          // DD/MM/YYYY
          day = p1;
          month = p2;
          year = p3;
        }

        if (year.length === 2) year = "20" + year;

        date = new Date(Number(year), Number(month) - 1, Number(day));
      }
    }

    // 3. Fallback
    if (!date) {
      date = new Date(raw);
    }

    if (isNaN(date)) return "";

    // FINAL: LOCAL FORMAT (NO TIMEZONE SHIFT)
    const pad = (n) => (n < 10 ? "0" + n : n);

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  // Convert date into Excel-safe TEXT format(Use for POST/api/submitData -> (Delivery Format) 'yyyy-MM-dd')
  const toExcelDateText = (value) => {
    if (value === undefined || value === null || value === "" || value === "-")
      return "";

    let raw = typeof value === "string" ? value.trim() : value;
    let date = null;

    // Case 1: Excel serial
    if (!isNaN(raw)) {
      const num = Number(raw);
      if (num > 0) {
        const utcDate = new Date(Math.round((num - 25569) * 86400 * 1000));
        date = new Date(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth(),
          utcDate.getUTCDate(),
        );
      }
    }

    // Case 2: ISO yyyy-mm-dd
    else if (
      typeof raw === "string" &&
      raw.includes("-") &&
      raw.split("-")[0].length === 4
    ) {
      const temp = new Date(raw);
      date = new Date(temp.getFullYear(), temp.getMonth(), temp.getDate());
    }

    // Case 3: dd/mm/yyyy
    else if (
      typeof raw === "string" &&
      (raw.includes("/") || raw.includes("-"))
    ) {
      const parts = raw.split(/[-\/]/);
      if (parts.length === 3) {
        let [d, m, y] = parts;
        if (y.length === 2) y = "20" + y;
        date = new Date(y, m - 1, d);
      }
    }

    // Case 4: fallback
    else {
      const temp = new Date(raw);
      date = new Date(temp.getFullYear(), temp.getMonth(), temp.getDate());
    }

    if (!date || isNaN(date.getTime())) return "";

    // Format yyyy-MM-dd (TEXT for Excel)
    const pad = (n) => (n < 10 ? "0" + n : n);
    return `'${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  // Helper function to parse date from 'dd/mm/yy' format

  function describeQuotationAuditField(pathKey) {
    const map = {
      id: "Quotation ID",
      quotation_number: "Quotation Number",
      status: "Status",
      total_amount: "Total Amount",
      user_id: "User ID",
      user_email: "User Email",
      user_phone: "User Phone",
      user_name: "User Name",
      user_company: "Company",
      user_contact_person: "Contact Person",
      user_address: "Address",
      quotation_data: "Quotation Data",
      created_at: "Created At",
      updated_at: "Updated At",
    };

    if (map[pathKey]) return map[pathKey];

    if (String(pathKey).startsWith("quotation_data.")) {
      return String(pathKey)
        .replace(/^quotation_data\./, "")
        .split(".")
        .map((part) =>
          part
            .replace(/_/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase()),
        )
        .join(" > ");
    }

    return String(pathKey)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalizeQuotationAuditValue(value) {
    if (value instanceof Date) return value.toISOString();
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    return value;
  }

  function collectQuotationAuditPaths(value, prefix = "", paths = new Set()) {
    if (value === null || value === undefined || typeof value !== "object") {
      if (prefix) paths.add(prefix);
      return paths;
    }

    if (Array.isArray(value)) {
      if (prefix) paths.add(prefix);
      return paths;
    }

    const entries = Object.entries(value);
    if (!entries.length && prefix) {
      paths.add(prefix);
      return paths;
    }

    entries.forEach(([key, childValue]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (
        childValue &&
        typeof childValue === "object" &&
        !Array.isArray(childValue) &&
        !(childValue instanceof Date)
      ) {
        collectQuotationAuditPaths(childValue, nextPrefix, paths);
        return;
      }
      paths.add(nextPrefix);
    });

    return paths;
  }

  function getQuotationAuditValue(source = {}, pathKey = "") {
    return String(pathKey)
      .split(".")
      .reduce((value, key) => {
        if (value === null || value === undefined) return undefined;
        return value[key];
      }, source);
  }

  function buildQuotationAuditDiff(beforeQuotation = {}, afterQuotation = {}) {
    const changedFields = [];
    const fieldPaths = new Set([
      ...collectQuotationAuditPaths(beforeQuotation),
      ...collectQuotationAuditPaths(afterQuotation),
    ]);

    [...fieldPaths].sort().forEach((pathKey) => {
      const beforeValue = normalizeQuotationAuditValue(
        getQuotationAuditValue(beforeQuotation, pathKey),
      );
      const afterValue = normalizeQuotationAuditValue(
        getQuotationAuditValue(afterQuotation, pathKey),
      );

      if (String(beforeValue ?? "") === String(afterValue ?? "")) return;

      changedFields.push(
        createAuditFieldEntry(
          describeQuotationAuditField(pathKey),
          beforeValue,
          afterValue,
          { path: pathKey },
        ),
      );
    });

    return {
      changedFields,
      summary: summarizeAuditChanges(changedFields, "Quotation updated"),
    };
  }

  // Map User table column names to friendly labels for audit display

  // ============ QUOTATION ROUTES ============
  // Static/demo routes (for deployment compatibility)
  router.get("/quotation", (req, res) => {
    res.sendFile(
      path.join(__dirname, "dashboard", "quotation-dashboard.html"),
    );
  });

  router.get("/quotation/create", (req, res) => {
    res.sendFile(
      path.join(__dirname, "quotation-form", "quotation-create.html"),
    );
  });

  router.get("/quotation/admin", (req, res) => {
    res.sendFile(
      path.join(__dirname, "admin-dashboard", "quotation-admin.html"),
    );
  });

  // Full server routes (for local development with backend)
  router.get("/full/quotation", (req, res) => {
    res.sendFile(
      path.join(__dirname, "dashboard", "quotation-dashboard.html"),
    );
  });

  router.get("/full/quotation/create", (req, res) => {
    res.sendFile(
      path.join(__dirname, "quotation-form", "quotation-create.html"),
    );
  });

  router.get("/full/quotation/admin", (req, res) => {
    res.sendFile(
      path.join(__dirname, "admin-dashboard", "quotation-admin.html"),
    );
  });

  // ============ QUOTATION API ROUTES ============
  // GET /api/quotations - Get user quotations
  router.get("/api/quotations", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] GET /api/quotations");
      const requester = getQuotationRequester(req);
      const userQuotations = await fetchUserQuotations(requester);

      logger.apiSuccess(req, 200);
      res.json({ quotations: userQuotations });
    } catch (error) {
      console.error("[API] GET /api/quotations - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to load quotations" });
    }
  });

  // GET /api/db/status - Read-only database connection diagnostics
  router.get("/api/db/status", async (req, res) => {
    logger.apiRequest(req);
    try {
      const [[databaseRow]] = await database.query("SELECT DATABASE() AS database_name");
      const [[quotationRow]] = await database.query("SELECT COUNT(*) AS quotation_count FROM quotations");

      logger.apiSuccess(req, 200);
      res.json({
        ok: true,
        database: databaseRow?.database_name || null,
        quotations: Number(quotationRow?.quotation_count || 0),
        host: process.env.DB_HOST || (process.env.DATABASE_URL ? "DATABASE_URL" : null),
        ssl: String(process.env.DB_SSL || "").toLowerCase() === "true",
      });
    } catch (error) {
      console.error("[API] GET /api/db/status - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({
        ok: false,
        error: error.message || "Database status check failed",
      });
    }
  });

  // GET /api/quotations/dashboard - Get user dashboard data
  router.get("/api/quotations/dashboard", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] GET /api/quotations/dashboard");
      const requester = getQuotationRequester(req);
      const quotations = await fetchUserQuotations(requester);

      logger.apiSuccess(req, 200);
      res.json({
        user: buildQuotationUserPayload(requester),
        quotations,
      });
    } catch (error) {
      console.error("[API] GET /api/quotations/dashboard - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to load quotation dashboard" });
    }
  });

  // POST /api/quotations - Create new quotation
  router.post("/api/quotations", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] POST /api/quotations");
      const { status, quotation_data, requester } = req.body;

      if (!status || !quotation_data) {
        return res.status(400).json({ error: "Missing required fields: status, quotation_data" });
      }

      if (!VALID_QUOTATION_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const normalizedRequester = normalizeQuotationRequester(requester);

      const quotation = {
        quotation_number: createQuotationNumber(),
        status,
        total_amount: quotation_data.summary?.totalSellingPrice || 0,
        user_id: normalizedRequester.user_id,
        user_email: normalizedRequester.user_email,
        user_phone: normalizedRequester.user_phone,
        user_name: normalizedRequester.user_name,
        user_company: normalizedRequester.company_name,
        user_contact_person: normalizedRequester.user_name,
        user_address: normalizedRequester.address,
        quotation_data
      };

      const savedQuotation = await insertQuotation(quotation);
      const auditDiff = buildQuotationAuditDiff({}, savedQuotation);

      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(normalizedRequester),
        action: "CREATE",
        module: "Quotation",
        identifier: String(savedQuotation.quotation_number || ""),
        changeSummary: `Quotation created: ${savedQuotation.quotation_number || savedQuotation.id}`,
        dataPayload: {
          source: "createQuotation",
          quotation: savedQuotation,
          changedFields: auditDiff.changedFields,
        },
      });

      logger.apiSuccess(req, 201);
      res.status(201).json({ quotation: savedQuotation });
    } catch (error) {
      console.error("[API] POST /api/quotations - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to create quotation" });
    }
  });

  // PUT /api/quotations/:id/status - Update quotation status
  router.put("/api/quotations/:id/status", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] PUT /api/quotations/:id/status");
      const { id } = req.params;
      const { status, requester } = req.body;

      if (!VALID_QUOTATION_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const quotation = await fetchQuotationById(id);

      if (!quotation) {
        return res.status(404).json({ error: "Quotation not found" });
      }

      const normalizedRequester = normalizeQuotationRequester(requester);

      // Check if user owns this quotation
      if (!getUserQuotationMatches(quotation, normalizedRequester)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const updatedQuotation = await updateQuotationStatus(id, status);
      const auditDiff = buildQuotationAuditDiff(quotation, updatedQuotation);

      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(normalizedRequester),
        action: "UPDATE",
        module: "Quotation",
        identifier: String(updatedQuotation.quotation_number || ""),
        changeSummary: `Quotation status updated: ${quotation.status || "(empty)"} -> ${updatedQuotation.status || status}`,
        dataPayload: {
          source: "updateQuotationStatus",
          quotation: updatedQuotation,
          previousQuotation: quotation,
          changedFields: auditDiff.changedFields,
        },
      });

      const userQuotations = await fetchUserQuotations(normalizedRequester);

      logger.apiSuccess(req, 200);
      res.json({
        quotations: userQuotations
      });
    } catch (error) {
      console.error("[API] PUT /api/quotations/:id/status - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to update quotation status" });
    }
  });

  // DELETE /api/quotations/:id - Delete quotation
  router.delete("/api/quotations/:id", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] DELETE /api/quotations/:id");
      const { id } = req.params;
      const { requester } = req.body;

      const quotation = await fetchQuotationById(id);

      if (!quotation) {
        return res.status(404).json({ error: "Quotation not found" });
      }

      const normalizedRequester = normalizeQuotationRequester(requester);

      // Check if user owns this quotation
      if (!getUserQuotationMatches(quotation, normalizedRequester)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only allow deleting draft quotations
      if (quotation.status !== "draft") {
        return res.status(400).json({ error: "Can only delete draft quotations" });
      }

      const auditDiff = buildQuotationAuditDiff(quotation, {});

      await deleteQuotationById(id);
      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(normalizedRequester),
        action: "DELETE",
        module: "Quotation",
        identifier: String(quotation.quotation_number || ""),
        changeSummary: `Draft quotation deleted: ${quotation.quotation_number || quotation.id}`,
        dataPayload: {
          source: "deleteDraftQuotation",
          quotation,
          changedFields: auditDiff.changedFields,
        },
      });

      const userQuotations = await fetchUserQuotations(normalizedRequester);

      logger.apiSuccess(req, 200);
      res.json({
        quotations: userQuotations
      });
    } catch (error) {
      console.error("[API] DELETE /api/quotations/:id - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to delete quotation" });
    }
  });

  // GET /api/quotations/admin/dashboard - Get admin dashboard data
  router.get("/api/quotations/admin/dashboard", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] GET /api/quotations/admin/dashboard");
      const requester = getQuotationRequester(req);

      // For development: Allow any authenticated user to access admin dashboard
      // In production, implement proper role-based access control
      // TODO: Implement proper RBAC with admin role assignment
      
      const quotations = await fetchAllQuotations();
      const recentActivity = await buildQuotationAdminActivity();

      logger.apiSuccess(req, 200);
      res.json({
        quotations,
        recentActivity
      });
    } catch (error) {
      console.error("[API] GET /api/quotations/admin/dashboard - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to load admin dashboard" });
    }
  });

  // PUT /api/quotations/admin/:id/status - Admin update quotation status
  router.put("/api/quotations/admin/:id/status", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] PUT /api/quotations/admin/:id/status");
      const { id } = req.params;
      const { status, requester } = req.body;

      if (!VALID_QUOTATION_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const quotation = await fetchQuotationById(id);

      if (!quotation) {
        return res.status(404).json({ error: "Quotation not found" });
      }

      const normalizedRequester = normalizeQuotationRequester(requester);

      // For development: Allow any authenticated user to update admin dashboard
      // In production, implement proper role-based access control
      // TODO: Implement proper RBAC with admin role assignment

      const updatedQuotation = await updateQuotationStatus(id, status);
      const auditDiff = buildQuotationAuditDiff(quotation, updatedQuotation);

      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(normalizedRequester),
        action: "UPDATE",
        module: "Quotation",
        identifier: String(updatedQuotation.quotation_number || ""),
        changeSummary: `Admin changed quotation status: ${quotation.status || "(empty)"} -> ${updatedQuotation.status || status}`,
        dataPayload: {
          source: "adminUpdateQuotationStatus",
          quotation: updatedQuotation,
          previousQuotation: quotation,
          changedFields: auditDiff.changedFields,
        },
      });

      const quotations = await fetchAllQuotations();
      const recentActivity = await buildQuotationAdminActivity();

      logger.apiSuccess(req, 200);
      res.json({
        quotations,
        recentActivity
      });
    } catch (error) {
      console.error("[API] PUT /api/quotations/admin/:id/status - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to update quotation status" });
    }
  });

  // GET /api/quotations/:id/export - Export quotation PDF
  router.get("/api/quotations/:id/export", async (req, res) => {
    logger.apiRequest(req);
    try {
      console.log("[API] GET /api/quotations/:id/export");
      const { id } = req.params;
      const requester = getQuotationRequester(req);
      const quotation = await fetchQuotationById(id);

      if (!quotation) {
        return res.status(404).json({ error: "Quotation not found" });
      }

      const isAdmin = requester.role === "admin" || requester.role === "Admin";
      if (!isAdmin && !getUserQuotationMatches(quotation, requester)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const pdfBuffer = await generateProfessionalPDF(quotation);
      const fileName = `quotation-${quotation.quotation_number || quotation.id}.pdf`;

      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(requester),
        action: "GENERATE_PDF",
        module: "Quotation",
        identifier: String(quotation.quotation_number || ""),
        changeSummary: `Quotation PDF generated: ${fileName}`,
        dataPayload: {
          source: "exportQuotationPdf",
          fileName,
          quotation,
          changedFields: [],
        },
      });

      logger.apiSuccess(req, 200);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[API] GET /api/quotations/:id/export - error:", error);
      logger.apiFail(req, 500, error);
      res.status(500).json({ error: "Failed to export quotation" });
    }
  });

  return { router, initializeQuotationTables };
}

module.exports = { createQuotationBackend };
