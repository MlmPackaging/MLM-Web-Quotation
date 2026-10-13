const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const bcrypt = require("bcrypt");
const db = require("./database");

require("dotenv").config();
const { ConfidentialClientApplication } = require("@azure/msal-node");
const serverLogger = require("./serverLogger"); //server logger
const { createQuotationBackend } = require("./quotation-backend");

//seq backlog saver
const winston = require("winston");
const seqUrl = "http://localhost:5341/api/events/raw";
const apiKey = "o1kchOjdg18LYo5n0ujB";

// Create a Winston logger that sends logs to Seq via HTTP transport
const logger = winston.createLogger({
  transports: [
    new winston.transports.Http({
      host: "localhost",
      port: 5341,
      path: `/api/events/raw?apiKey=${apiKey}`,
      ssl: false,
    }),
  ],
});

// Function to log events to Seq with a specified level and event data
async function logToSeq(level, event) {
  const payload = {
    Events: [
      {
        Timestamp: new Date().toISOString(),
        Level: level.toUpperCase(),
        MessageTemplate: event.action || "Log event",
        Properties: event,
      },
    ],
  };

  try {
    await axios.post(seqUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Seq-ApiKey": apiKey,
      },
    });
  } catch (err) {
    console.error("Seq logging failed:", err.message);
  }

  // Keep console log for Render/debug
  console.log(JSON.stringify({ level, ...event }));
}

// ============ DEVICE DETECTION ============
function getDeviceInfo(req) {
  const ua = String(req.headers?.["user-agent"] || "").toLowerCase();

  // Detect device type
  const isMobile =
    /mobile|android|iphone|ipad|ipod|blackberry|windows phone|opera mini|silk/i.test(ua);
  const isTablet = /ipad|tablet|playbook|silk/i.test(ua) && !isMobile;
  const deviceType = isMobile ? "Mobile" : isTablet ? "Tablet" : "Desktop/Laptop";

  // Detect browser
  let browser = "Unknown Browser";
  if (/edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = "Google Chrome";
  else if (/firefox\//i.test(ua)) browser = "Mozilla Firefox";
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/msie|trident/i.test(ua)) browser = "Internet Explorer";

  // Detect OS
  let os = "Unknown OS";
  if (/windows nt/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return {
    deviceType,
    browser,
    os,
    userAgent: req.headers?.["user-agent"] || "Unknown",
  };
}


const app = express();
app.use(express.json());

const quotationBackend = createQuotationBackend({
  database: db,
  logger: serverLogger,
  addAuditLogEntryWithRetry,
  resolveAuditAccount,
  createAuditFieldEntry,
  summarizeAuditChanges,
});
const PORT = process.env.PORT || 3000;

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/scripts", express.static(path.join(__dirname, "scripts")));

// ============ VALIDATION FUNCTIONS ============
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isValidPhone(value) {
  return /^\+?[0-9\s\-().]{7,20}$/.test(String(value || "").trim());
}

function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
    value,
  );
}

function parseDateFromDMY(str) {
  if (!str || typeof str !== "string") return null;
  const parts = str.replace("'", "").split("/");
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0]),
    m = parseInt(parts[1]),
    y = 2000 + parseInt(parts[2]);
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

// Helper function to add days to a date string in 'dd/mm/yy' format
function addDaysToDateString(dateStr, days) {
  const date = parseDateFromDMY(dateStr);
  if (!date) return dateStr;
  date.setDate(date.getDate() + days);
  const d = date.getDate(),
    m = date.getMonth() + 1,
    y = date.getFullYear() % 100;
  return `'${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String(y).padStart(2, "0")}`;
}

// ============ Microsoft Graph API Authentication Setup ============
// Configure MSAL for authentication with Microsoft Graph API using Client Credentials flow
// Endpoint to send config to frontend
app.get("/config", (req, res) => {
  res.json({
    clientId: process.env.CLIENT_ID,
    tenantId: process.env.TENANT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  });
});

const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
};

//add a small delay between the two updateCell calls
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cca = new ConfidentialClientApplication(msalConfig);

//Authenticate with Microsoft Graph API using Client Credentials
async function getAccessToken() {
  serverLogger.tokenAcquireStart();
  try {
    const result = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    serverLogger.tokenAcquireSuccess();
    return result.accessToken;
  } catch (err) {
    serverLogger.tokenAcquireFail(err);
    throw err;
  }
}

//Get SharePoint file context: siteId, driveId, fileId, and auth headers for API calls
async function getSharePointFileContext() {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  // Get site ID for the SharePoint site containing the file (adjust the path as needed)
  const siteUrl =
    "https://graph.microsoft.com/v1.0/sites/mlmpackagingmy.sharepoint.com:/sites/FileStorage";
  serverLogger.graphCall("GET", siteUrl);
  const siteRes = await axios.get(siteUrl, { headers });
  serverLogger.graphSuccess("GET", siteUrl, siteRes.status);
  const siteId = siteRes.data.id;

  // Get the first drive in the site (adjust if you know the specific drive name or ID)
  const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`;
  serverLogger.graphCall("GET", drivesUrl);
  const drivesRes = await axios.get(drivesUrl, { headers });
  serverLogger.graphSuccess("GET", drivesUrl, drivesRes.status);
  const driveId = drivesRes.data.value[0]?.id;
  if (!driveId) throw new Error("Could not find driveId in site drives");

  // Get the file ID for Database.xlsx in the drive (adjust the path if the file is in a subfolder)
  const fileUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/Testing Database.xlsx`;
  serverLogger.graphCall("GET", fileUrl);
  const fileRes = await axios.get(fileUrl, { headers });
  serverLogger.graphSuccess("GET", fileUrl, fileRes.status);
  const fileId = fileRes.data.id;
  if (!fileId)
    throw new Error("Could not find fileId for Testing Database.xlsx");

  return { token, headers, siteId, driveId, fileId };
}

// Fetch all rows from a specified table and convert to array of objects using header row for keys
async function getTableRowsAsObjects(tableName) {
  const ctx = await getSharePointFileContext();

  // Get header row to use as keys for objects (assumes header row is in first row of the table)
  const headerRes = await axios.get(
    `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables/${tableName}/headerRowRange`,
    { headers: ctx.headers },
  );
  const headers = headerRes.data.values?.[0] || [];

  const rows = await getAllTableRows(tableName, ctx);

  const result = rows.map((row, idx) => {
    // Handle different response formats from Graph API
    let values = [];

    if (row.values) {
      if (Array.isArray(row.values)) {
        // If values is array of arrays, get first element; if array of values, use directly
        values = Array.isArray(row.values[0]) ? row.values[0] : row.values;
      } else if (typeof row.values === "string") {
        // If values is a single string, split by comma (CSV format)
        values = row.values.split(",");
      }
    }

    const item = { _rowIdx: idx };
    headers.forEach((h, idx) => {
      item[h] = values[idx] !== undefined ? values[idx] : null;
    });
    return item;
  });
  return result;
}

// Helper function to fetch all rows from a table, handling pagination if there are more than 100 rows (Graph API default page size)
async function getAllTableRows(tableName, existingCtx = null) {
  const ctx = existingCtx || (await getSharePointFileContext());
  let requestUrl = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('${tableName}')/rows`;
  const allRows = [];
  let page = 0;

  while (requestUrl) {
    serverLogger.graphCall("GET", requestUrl, { tableName, page });
    let rowsRes;
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        rowsRes = await axios.get(requestUrl, { headers: ctx.headers });
        break;
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const retryAfterHeader = err?.response?.headers?.["retry-after"];
        if (status === 503 || status === 429) {
          const waitMs = retryAfterHeader
            ? Math.min(Number(retryAfterHeader) * 1000, 60000)
            : 1200 * attempt;
          console.warn(
            `[getAllTableRows] ${status} on table=${tableName} page=${page}, attempt ${attempt}/4, waiting ${waitMs}ms...`,
          );
          await sleep(waitMs);
        } else {
          throw err;
        }
      }
    }
    if (!rowsRes) throw lastErr;
    serverLogger.graphSuccess("GET", requestUrl, rowsRes.status, {
      tableName,
      page,
      rowsOnPage: (rowsRes.data.value || []).length,
    });
    const pageRows = rowsRes.data.value || [];
    allRows.push(...pageRows);
    requestUrl = rowsRes.data["@odata.nextLink"] || null;
    page++;
  }

  serverLogger.sharepointLoad(tableName, allRows.length);
  return allRows;
}

// Fetch header row values for a given table to use as keys for object mapping
function findColumnIndexInHeaders(possibleNames, headerList = []) {
  for (const name of possibleNames) {
    const idx = headerList.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

// Extract values from a table row, handling different possible formats of the 'values' property (array of arrays, array of values, or CSV string)
function extractRowValues(row) {
  if (!row || row.values === undefined || row.values === null) return [];
  if (Array.isArray(row.values)) {
    if (Array.isArray(row.values[0])) return row.values[0];
    return row.values;
  }
  if (typeof row.values === "string") {
    return row.values.split(",");
  }
  return [];
}

// Add a new row to a specified table with given values (array of cell values in order of columns)
function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

// Convert a value to a JSON string for storing in the audit log's data payload, with handling for null/undefined/empty and fallback for non-serializable values
function toAuditCellJson(value) {
  if (value === null || value === undefined || value === "") return "{}";
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ raw: String(value) });
  }
}

// Normalize various timestamp formats to ISO string for consistent storage in audit log, with fallback to original value if parsing fails
function normalizeAuditTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

// Normalize an audit log row object by mapping various possible field names to a consistent structure, parsing the timestamp, and safely handling the data payload as JSON
function normalizeAuditLogRow(row) {
  const timestamp =
    row.Timestamp ||
    row.timestamp ||
    row["Time Stamp"] ||
    row["Created At"] ||
    "";
  const account = row.Account || row.account || row.User || row.user || "";
  const action = row.Action || row.action || "";
  const moduleName = row.Module || row.module || "";
  const identifier = row.Identifier || row.identifier || row.BatchId || "";
  const changeSummary =
    row["Change Summary"] ||
    row.changeSummary ||
    row["Summary"] ||
    row.summary ||
    "";
  const payloadRaw =
    row["Data Payload"] || row.dataPayload || row.Payload || row.payload || "";
  const payload = safeJsonParse(
    payloadRaw,
    payloadRaw ? { raw: payloadRaw } : {},
  );

  return {
    timestamp: normalizeAuditTimestamp(timestamp),
    account: String(account || ""),
    action: String(action || ""),
    module: String(moduleName || ""),
    identifier: String(identifier || ""),
    changeSummary: String(changeSummary || ""),
    dataPayload: payload,
    payloadSearchText:
      typeof payload === "string"
        ? payload.toLowerCase()
        : JSON.stringify(payload || {}).toLowerCase(),
  };
}

// Add a new entry to the AuditLog table with normalized structure, ensuring required fields are present and mapping to the correct columns based on header names
async function addAuditLogEntry(entry = {}) {
  const headers = await getTableHeaders("AuditLog");
  if (!headers.length) {
    throw new Error("AuditLog table headers not found.");
  }
  console.log("Entry : " + JSON.stringify(entry));
  const normalizedEntry = {
    timestamp: entry.timestamp || new Date().toISOString(),
    account: entry.account || "Unknown",
    action: entry.action || "UPDATE",
    module: entry.module || "General",
    identifier: entry.identifier || "",
    changeSummary: entry.changeSummary || "",
    dataPayload: toAuditCellJson(entry.dataPayload || {}),
  };

  const lowerCaseMap = {
    timestamp: normalizedEntry.timestamp,
    account: normalizedEntry.account,
    action: normalizedEntry.action,
    module: normalizedEntry.module,
    identifier: normalizedEntry.identifier,
    "change summary": normalizedEntry.changeSummary,
    changesummary: normalizedEntry.changeSummary,
    summary: normalizedEntry.changeSummary,
    "data payload": normalizedEntry.dataPayload,
    datapayload: normalizedEntry.dataPayload,
    payload: normalizedEntry.dataPayload,
  };

  const rowValues = headers.map((header) => {
    const key = String(header || "")
      .trim()
      .toLowerCase();
    return lowerCaseMap[key] !== undefined ? lowerCaseMap[key] : "";
  });

  await addTableRow("AuditLog", rowValues);
  return normalizedEntry;
}

function isRetryableGraphWorkbookError(error) {
  const status = error.response?.status;
  return status === 429 || status === 503 || status === 504;
}

async function addAuditLogEntryWithRetry(entry = {}, options = {}) {
  const retries = Number(options.retries ?? 3);
  const baseDelayMs = Number(options.baseDelayMs ?? 1200);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await addAuditLogEntry(entry);
    } catch (error) {
      if (!isRetryableGraphWorkbookError(error) || attempt === retries) {
        throw error;
      }

      const retryAfterHeader = error.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : 0;
      const delayMs = retryAfterMs || baseDelayMs * attempt;
      console.warn(
        `[addAuditLogEntryWithRetry] AuditLog write got ${error.response?.status}, retrying (${attempt}/${retries}) after ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }
}

// Fetch all audit log entries, normalize their structure, and sort them by timestamp in descending order for display in the frontend
async function getAuditLogEntries() {
  const rows = await getTableRowsAsObjects("AuditLog");
  return rows
    .map(normalizeAuditLogRow)
    .sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() -
        new Date(a.timestamp || 0).getTime(),
    );
}

// Format a value for display in the audit log, handling null/undefined/empty, boolean values, Excel serial numbers (converted to date), and date strings (converted to consistent format)
function formatBatchAuditValue(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const str = String(value);
  const clean = str.startsWith("'") ? str.slice(1) : str;
  // Render Excel serial numbers as DD/MM/YYYY
  if (typeof value === "number" && value > 40000 && value < 60000) {
    const d = displayDate(value);
    if (d && d !== "-") return d;
  }
  // Render YYYY-MM-DD as DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split("-");
    return d + "/" + m + "/" + y;
  }
  // Already DD/MM/YY or DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(clean)) return clean;
  return str;
}

// Given a base column index for a batch process block, calculate the corresponding process slot number and return a label like "Process 1", "Process 2", etc.
function getBatchProcessBlockLabel(baseCol) {
  const processSlot = Math.floor((Number(baseCol) - 6) / 9) + 1;
  return `Process ${processSlot}`;
}

// Extract the list of batch processes from a row's values by looking at the defined process blocks (every 9 columns starting from column 6) and returning an array of objects with the process name and its base column index
function getBatchProcessList(rowValues = []) {
  const processes = [];
  const START_COL = 6;
  const BLOCK_SIZE = 9;

  for (let i = 0; i < 12; i++) {
    const baseCol = START_COL + i * BLOCK_SIZE;
    const name = String(rowValues[baseCol] || "").trim();
    if (!name || name === "--") continue;
    processes.push({ baseCol, name });
  }

  return processes;
}

// Parse a map string in the format "Process A: 10, Process B: 20" into an object { "Process A": 10, "Process B": 20 }
function mapBatchQtyByProcessName(rowValues = [], mapString = "") {
  const rawMap = parseMapString(String(mapString || ""), 0);
  const processMap = {};

  getBatchProcessList(rowValues).forEach((process) => {
    processMap[process.name] = Number(rawMap[String(process.baseCol)] || 0);
  });

  return processMap;
}

// Format a map of process names to quantities into a string like "Process A: 10, Process B: 20" for display in the audit log
function formatNamedQtyMap(value) {
  const entries = Object.entries(value || {});
  if (!entries.length) return "(empty)";
  return entries.map(([name, qty]) => `${name}: ${qty}`).join(", ");
}

// Create a structured entry for a changed field in the audit log, including the field name, old and new values, a display string summarizing the change, and any extra metadata needed for further processing or display
function createAuditFieldEntry(field, oldValue, newValue, extra = {}) {
  return {
    field,
    oldValue,
    newValue,
    display: `${field}: ${formatBatchAuditValue(oldValue)} -> ${formatBatchAuditValue(newValue)}`,
    ...extra,
  };
}

// Compare the process sequence between two rows and create an audit log entry if there is a change, showing the old and new sequence of processes by name
function buildProcessSequenceChangeEntry(beforeRow = [], afterRow = []) {
  const beforeList = getBatchProcessList(beforeRow).map((item) => item.name);
  const afterList = getBatchProcessList(afterRow).map((item) => item.name);
  const beforeValue = beforeList.join(", ");
  const afterValue = afterList.join(", ");

  if (beforeValue === afterValue) return null;

  return createAuditFieldEntry(
    "Process Sequence",
    beforeValue || "(none)",
    afterValue || "(none)",
    {
      oldProcesses: beforeList,
      newProcesses: afterList,
    },
  );
}

// Compare the named quantity maps (e.g. done qty or qty limit) between two rows and create audit log entries for any changes, including a summary entry if the overall map has changed and individual entries for each process that changed
function buildNamedQtyMapDiffEntries(
  beforeRow = [],
  afterRow = [],
  mapColumnIndex,
  label,
) {
  const beforeMap = mapBatchQtyByProcessName(
    beforeRow,
    beforeRow[mapColumnIndex],
  );
  const afterMap = mapBatchQtyByProcessName(afterRow, afterRow[mapColumnIndex]);
  const processNames = Array.from(
    new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]),
  );

  const changes = [];
  processNames.forEach((name) => {
    const oldValue = Number(beforeMap[name] || 0);
    const newValue = Number(afterMap[name] || 0);
    if (oldValue === newValue) return;
    changes.push(
      createAuditFieldEntry(`${label} - ${name}`, oldValue, newValue, {
        processName: name,
      }),
    );
  });

  if (formatNamedQtyMap(beforeMap) !== formatNamedQtyMap(afterMap)) {
    changes.unshift(
      createAuditFieldEntry(
        `${label} Summary`,
        formatNamedQtyMap(beforeMap),
        formatNamedQtyMap(afterMap),
      ),
    );
  }

  return changes;
}

// Generate a concise summary string for the audit log entry based on the list of changed fields
// Showing up to 3 changes and indicating if there are more
function summarizeAuditChanges(
  changedFields = [],
  fallback = "Batch row updated",
) {
  if (!changedFields.length) return fallback;
  const summary = changedFields
    .slice(0, 3)
    .map((item) => item.display)
    .join("; ");
  return changedFields.length > 3
    ? `${summary}; +${changedFields.length - 3} more changes`
    : summary;
}

// Attempt to resolve a user-friendly account identifier from various possible fields in the actor object, with a fallback if none found
function resolveAuditAccount(actor = null, fallback = "Unknown") {
  if (typeof actor === "string" && actor.trim()) {
    return actor.trim();
  }

  return (
    actor?.email ||
    actor?.user_email ||
    actor?.account ||
    actor?.name ||
    fallback
  );
}

// Normalize a value to a finite number for job listing quantities, treating non-numeric or invalid inputs as zero
function normalizeJobListingNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

// Map batch listing column indices to user-friendly field names, 
// With special handling for process-related columns based on the header row values
function describeBatchListingColumn(colIndex, rowValues = []) {
  if (colIndex === 0) return "PSN";
  if (colIndex === 1) return "Batch ID";
  if (colIndex === 2) return "Created Date";
  if (colIndex === 4) return "Batch Quantity";
  if (colIndex === 114) return "Completion Status";
  if (colIndex === 115) return "Completed Date";
  if (colIndex === 118) return "Batch Remark";
  if (colIndex === 119) return "Current Qty Map";
  if (colIndex === 120) return "Max Qty Map";

  if (colIndex >= 6 && colIndex < 114) {
    const offset = (colIndex - 6) % 9;
    const base = colIndex - offset;
    const processName = String(
      rowValues[base] || getBatchProcessBlockLabel(base),
    ).trim();
    const suffixMap = {
      0: "Process Name",
      1: "Expected Date",
      2: "Finish Date",
      3: "Duration",
      4: "Machine Detail",
      5: "Status",
      6: "Remark",
      7: "Revert Remark",
      8: "Completed Flag",
    };
    return `${processName || getBatchProcessBlockLabel(base)} ${suffixMap[offset] || "Field"}`;
  }

  return `Column ${colIndex + 1}`;
}

// Add and compare two differences so batch diff can show inside old vs new inside audit log page
function buildBatchAuditDiff(beforeRow = [], afterRow = []) {
  const changedFields = [];
  const skippedColumns = new Set([119, 120]);

  const maxLength = Math.max(beforeRow.length, afterRow.length);
  for (let i = 0; i < maxLength; i++) {
    if (skippedColumns.has(i)) continue;
    const beforeValue = beforeRow[i] === undefined ? "" : beforeRow[i];
    const afterValue = afterRow[i] === undefined ? "" : afterRow[i];
    if (String(beforeValue ?? "") === String(afterValue ?? "")) continue;

    changedFields.push(
      createAuditFieldEntry(
        describeBatchListingColumn(i, beforeRow),
        beforeValue,
        afterValue,
        { columnIndex: i },
      ),
    );
  }

  const processSequenceChange = buildProcessSequenceChangeEntry(
    beforeRow,
    afterRow,
  );
  if (processSequenceChange) changedFields.push(processSequenceChange);

  changedFields.push(
    ...buildNamedQtyMapDiffEntries(beforeRow, afterRow, 119, "Done Qty"),
  );
  changedFields.push(
    ...buildNamedQtyMapDiffEntries(beforeRow, afterRow, 120, "Qty Limit"),
  );

  return {
    changedFields,
    summary: summarizeAuditChanges(changedFields),
  };
}

//func used by buildJobListingAuditDiff to name the columns
function describeJobListingColumn(colIndex) {
  const columnMap = {
    0: "Product Serial Number",
    1: "PI Number",
    2: "Sales Code",
    3: "Job Name",
    4: "Job Type",
    5: "Quantity",
    6: "Order Date",
    7: "Delivery Date",
    8: "Item",
    9: "Priority",
    10: "Status",
    11: "Delivery Format",
    12: "Remaining",
    13: "BTD (Balance to Delivery)",
    14: "Partial Delivery",
    15: "Total Delivery",
    16: "Production Margin Waste",
    17: "Delivery Edited",
  };
  return columnMap[colIndex] || `Column ${colIndex + 1}`;
}

//to show new and old change in audit for job
function buildJobListingAuditDiff(beforeRow = [], afterRow = []) {
  const changedFields = [];

  const maxLength = Math.max(beforeRow.length, afterRow.length);
  for (let i = 0; i < maxLength; i++) {
    const beforeValue = beforeRow[i] === undefined ? "" : beforeRow[i];
    const afterValue = afterRow[i] === undefined ? "" : afterRow[i];
    if (String(beforeValue ?? "") === String(afterValue ?? "")) continue;

    changedFields.push(
      createAuditFieldEntry(
        describeJobListingColumn(i),
        beforeValue,
        afterValue,
        { columnIndex: i },
      ),
    );
  }

  return {
    changedFields,
    summary: summarizeAuditChanges(changedFields),
  };
}

function describeUserColumn(header) {
  const map = {
    user_id: "User ID",
    user_email: "Email",
    user_name: "Name",
    user_jobtitle: "Job Title",
    user_password: "Password",
    user_phone: "Phone",
    role: "Role",
    created_date: "Created Date",
    last_login: "Last Login",
    active: "Active",
  };
  return map[String(header).toLowerCase()] || header;
}

// Build old vs new diff for User table rows (object form, not array)
function buildUserAuditDiff(
  beforeUser = {},
  afterUser = {},
  passwordChanged = false,
) {
  const SAFE_HEADERS = [
    "user_id",
    "user_email",
    "user_name",
    "user_jobtitle",
    "user_phone",
    "role",
    "created_date",
    "last_login",
    "active",
  ];
  const changedFields = [];

  for (const header of SAFE_HEADERS) {
    const oldVal = beforeUser[header] !== undefined ? beforeUser[header] : "";
    const newVal = afterUser[header] !== undefined ? afterUser[header] : "";
    if (String(oldVal) === String(newVal)) continue;
    changedFields.push({
      field: describeUserColumn(header),
      oldValue: oldVal,
      newValue: newVal,
      display: `${describeUserColumn(header)}: ${oldVal || "(empty)"} -> ${newVal || "(empty)"}`,
    });
  }

  if (passwordChanged) {
    changedFields.push({
      field: "Password",
      oldValue: "(hidden)",
      newValue: "(hidden)",
      display: "Password: changed",
    });
  }

  const summary =
    changedFields.map((f) => f.display).join("; ") || "No changes";
  return { changedFields, summary };
}

// Get the column count of a table by first trying the /columns endpoint, then falling back to headerRowRange if needed (handles different Graph API response formats)
async function getTableColumnCount(tableName) {
  const ctx = await getSharePointFileContext();

  try {
    // First try direct table columns count (best fit for table metadata)
    const colsRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables/${tableName}/columns`,
      { headers: ctx.headers },
    );
    const columns = colsRes.data.value || [];
    if (columns.length > 0) {
      // console.log(`[getTableColumnCount] ${tableName} columns via /columns:`, columns.length);
      return columns.length;
    }

    // Fallback to headerRowRange if columns endpoint gives empty
    const headerRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables/${tableName}/headerRowRange`,
      { headers: ctx.headers },
    );
    const headers = headerRes.data.values?.[0] || [];

    return headers.length;
  } catch (error) {
    throw error;
  }
}

// Add a new row to a specified table with given values (values should be an array matching the table's column order)
async function addTableRow(tableName, values) {
  const ctx = await getSharePointFileContext();
  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables/${tableName}/rows/add`;
  console.log(
    `[addTableRow] Adding row to ${tableName}:`,
    values.length,
    "columns",
  );

  // Ensure values is an array of strings/numbers and convert any non-string values to strings (Graph API can be sensitive to data types)
  serverLogger.graphCall("POST", url, {
    tableName,
    columnCount: values.length,
  });
  try {
    const resp = await axios.post(
      url,
      { values: [values] },
      { headers: ctx.headers },
    );
    serverLogger.sharepointWrite(tableName, "ADD_ROW", "", {
      columnCount: values.length,
    });
    console.log(`[addTableRow] Successfully added to ${tableName}`);
    return resp.data;
  } catch (err) {
    serverLogger.graphFail("POST", url, err, { tableName });
    throw err;
  }
}

// Get the header row values of a specified table (used for mapping column indices to names when processing rows)
async function getTableHeaders(tableName) {
  const ctx = await getSharePointFileContext();
  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables/${tableName}/headerRowRange`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const headerRes = await axios.get(url, { headers: ctx.headers });
      return headerRes.data.values?.[0] || [];
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      if (status === 503 || status === 429) {
        const waitMs = retryAfterHeader
          ? Math.min(Number(retryAfterHeader) * 1000, 60000)
          : 1200 * attempt;
        console.warn(
          `[getTableHeaders] ${status} on table=${tableName}, attempt ${attempt}/4, waiting ${waitMs}ms...`,
        );
        await sleep(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

// Update the values of a specific row in a table by its index (0-based, excluding header row), constructing the appropriate range address and sending a PATCH request to the Graph API
async function updateTableRowValues(tableName, rowIndex, values) {
  const ctx = await getSharePointFileContext();
  const colCount = await getTableColumnCount(tableName);
  const lastColLetter = indexToColumnLetter(colCount - 1);
  const physicalRow = parseInt(rowIndex, 10) + 2;
  const rangeAddress = `A${physicalRow}:${lastColLetter}${physicalRow}`;
  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('${tableName}')/range(address='${rangeAddress}')`;

  await axios.patch(url, { values: [values] }, { headers: ctx.headers });
}

// Delete a specific row in a table by its index (0-based, excluding header row)
async function deleteTableRow(tableName, rowIndex) {
  const ctx = await getSharePointFileContext();
  const colCount = await getTableColumnCount(tableName);
  const lastColLetter = indexToColumnLetter(colCount - 1);
  const physicalRow = parseInt(rowIndex, 10) + 2;
  const rangeAddress = `A${physicalRow}:${lastColLetter}${physicalRow}`;
  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('${tableName}')/range(address='${rangeAddress}')/delete`;
  console.log(`[deleteTableRow] Deleting row ${rowIndex} from ${tableName} at ${rangeAddress}`);

  serverLogger.graphCall("POST", url, { tableName, rowIndex });
  try {
    await axios.post(url, { shift: "Up" }, { headers: ctx.headers });
    serverLogger.sharepointWrite(tableName, "DELETE_ROW", "", { rowIndex });
    console.log(`[deleteTableRow] Successfully deleted row ${rowIndex} from ${tableName}`);
  } catch (err) {
    serverLogger.graphFail("POST", url, err, { tableName, rowIndex });
    throw err;
  }
}

// // Main function to generate dashboard data by fetching and processing BatchListing and JobListing tables
// Creating a structured representation of batches with their associated job info and process steps for frontend consumption
// ============ EXPRESS ROUTES ============
// Redirect root to login.html
app.get("/", (req, res) => {
  console.log("[APP] GET / - redirecting to login");
  res.redirect("/login.html");
});
// Serve static files from the 'public' directory (make sure to create this and add your frontend files)
app.use(express.static(path.join(__dirname, "public")));


// API route to get access token (for testing purposes, not needed by frontend)
app.get("/api/getToken", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/getToken - attempting to get token");
    const token = await getAccessToken();
    console.log("[API] GET /api/getToken - success");
    serverLogger.dataRead(req.body, token.length);
    serverLogger.apiSuccess(req, 200, { rowCount: token.length });
    res.json({ accessToken: token });
  } catch (error) {
    console.error("[API] GET /api/getToken - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to get token" });
  }
});

// //API route to get dashboard data (batches with job info and process steps)
async function generateDashboardData() {
  // Get file context once
  const fileContext = await getSharePointFileContext();

  // Fetch all rows for BatchListing with numeric index preservation
  const batchRowsRaw = await getAllTableRows('BatchListing', fileContext);

  // Convert to objects for JobListing
  const jobListing = await getTableRowsAsObjects("JobListing");

  // Get JobListing headers so we can find column R's actual header name at runtime
  const jobListingHeaders = await getTableHeaders("JobListing");
  // Column R is the 18th column (0-based index 17)
  const colRHeaderName = jobListingHeaders[17] || null;

  // Create jobInfoMap from JobListing for quick lookup
  const jobInfoMap = {};
  jobListing.forEach((job) => {
    const psn = String(job["Product Serial Number"] || job.psn || "").trim();
    if (!psn) return;
    if (!jobInfoMap[psn]) {
      // Column R: read using the actual header name resolved from the sheet at index 17
      const colRRaw = colRHeaderName ? job[colRHeaderName] : null;
      const deliveryDateEdited = colRRaw === true || String(colRRaw).toUpperCase() === "TRUE";
      jobInfoMap[psn] = {
        pi: job["PI Number"] || job.PI_Number || job.pi || job.PI_No || "-",
        code: job.salesCode || job.Sales_Code || job.code || "-",
        client: job["Job Name"] || job.Job_Name || job.client || "-",
        totalQty: job.Quantity,
        productionMarginWaste: job["Production Margin Waste"] || job.Production_Margin_Waste || job.productionMarginWaste || job.production_margin_waste || "0%",
        jobType: job["Job Type"],
        orderDate: displayDate(
          job["Order Date"] || job.Order_Date || job.orderDate,
        ),
        priority: job.Priority || "NORMAL",
        deliveryDate: displayDate(
          job["Delivery Date"] || job.Delivery_Date || job.deliveryDate,
        ),
        status: job.Status || "ON SCHEDULE",
        remainingQty: job.Remaining || 0,
        partialDelivery: job["Partial Delivery"] || 0,
        balanceToDelivery: job.BTD || 0,
        totalDelivery: job["Total Delivery"] || 0,
        Item: job.Item || job["Item"] || "-",
        deliveryDateEdited,
      };
    }
  });
 
  // Process BatchListing to create batches with steps structure
  const batches = [];

  // Use raw rows with numeric indices for step parsing (if available)
  batchRowsRaw.forEach((rawRow, rowIdx) => {
    // Handle different response formats for raw rows
    let values = [];
    if (rawRow.values) {
      if (Array.isArray(rawRow.values)) {
        values = Array.isArray(rawRow.values[0])
          ? rawRow.values[0]
          : rawRow.values;
      } else if (typeof rawRow.values === "string") {
        // If values is a single string, split by comma (CSV format)
        values = rawRow.values.split(",");
      }
    }

    // Extract basic info from numeric indices (matching app.js)
    const psn = String(values[0] || "").trim();
    if (!psn || psn.toLowerCase().includes("done")) {
      return;
    }

    // Parse 12 process steps from columns 6+ (each step is 9 columns)
    let definedSteps = [];
    let ticksFound = 0;
    let activeStepStatus = "";

    const START_COL = 6;
    const BLOCK_SIZE = 9;

    for (let s = 0; s < 12; s++) {
      let base = START_COL + s * BLOCK_SIZE;
      if (base >= values.length) break;

      let pName = String(values[base] || "").trim();

      if (pName !== "" && pName !== "--") {
        let rawTick = values[base + 8];
        let isDone =
          rawTick === true ||
          rawTick === 1 ||
          String(rawTick).toUpperCase() === "TRUE";

        if (isDone) ticksFound++;
        if (!activeStepStatus && !isDone) {
          activeStepStatus = String(values[base + 5] || "").trim();
        }

        // Helper to safely parse dates
        const parseDateValue = (val) => {
          const formatted = displayDate(val);
          if (formatted === "-") return "-";
          return formatted;
        };

        const rawRemark = String(values[base + 6] || "");
        const pipeIdx = rawRemark.indexOf("|");
        const inProgressRemark =
          pipeIdx !== -1 ? rawRemark.slice(0, pipeIdx) : "";
        const delayRemark =
          pipeIdx !== -1 ? rawRemark.slice(pipeIdx + 1) : rawRemark;

        definedSteps.push({
          name: pName,
          expDate: parseDateValue(values[base + 1]) || "-",
          rawExpDate:
            typeof values[base + 1] === "number"
              ? (values[base + 1] - 25569) * 86400000
              : null,
          endDate: parseDateValue(values[base + 2]) || "-",
          duration: values[base + 3] || 0,
          detail: String(values[base + 4] || ""),
          status: String(values[base + 5] || ""),
          inProgressRemark: inProgressRemark,
          remark: delayRemark,
          revertRemark: String(values[base + 7] || ""),
          isDone: isDone,
          baseCol: base,
        });
      }
    }

    let batchProgress =
      definedSteps.length > 0 ? ticksFound / definedSteps.length : 0;

    const info = jobInfoMap[psn] || {
      pi: "-",
      code: "-",
      client: "-",
      jobType: "-",
      totalQty: "-",
      orderDate: "-",
      priority: "NORMAL",
      deliveryDate: "-",
      status: "ON SCHEDULE",
      remainingQty: "-",
      partialDelivery: "-",
      balanceToDelivery: "-",
      totalDelivery: "-",
      Item: "-",
    };
    batches.push({
      row: rowIdx,
      psn: psn,
      batchId: String(values[1] || ""),
      batchDate: excelToJSDate(values[2]),
      jobName: String(values[3] || ""),
      qty: Number(values[4] || 0),
      totalQty: info.totalQty,
      progress: definedSteps.length > 0 ? ticksFound / definedSteps.length : 0,
      steps: definedSteps,
      activeStepStatus: activeStepStatus,
      piNumber: info.pi,
      salesCode: info.code,
      productionMarginWaste: info.productionMarginWaste,
      clientName: info.client,
      jobType: info.jobType,
      orderDate: info.orderDate,
      priority: info.priority,
      deliveryDate: info.deliveryDate,
      status: info.status,
      remainingQty: info.remainingQty,
      partialDelivery: info.partialDelivery,
      balanceToDelivery: info.balanceToDelivery,
      totalDelivery: info.totalDelivery,
      Item: info.Item,
      splitRemark: String(values[118] || "").trim(),
      qtyString: String(values[119] || ""),
      maxQtyString: String(values[120] || ""),
      completedDate: (() => {
        const d = parseDateOnly(values[115]);
        return d ? d.toISOString().split('T')[0] : "";
      })(),
      deliveryDateEdited: info.deliveryDateEdited || false,
    });
  });

  // Calculate process averages for workload display
  const processList = [
    "Attach Handle",
    "Baseboard",
    "Blind Emboss",
    "Convert",
    "Die-cut",
    "Double-Side-Tape",
    "Efluting",
    "Emboss",
    "FlexoSlitting",
    "Gluing",
    "Hotstamping",
    "Lamination",
    "Packing",
    "Peeling",
    "Printing",
    "Punch Hole",
    "Rivet",
    "Sheeting",
    "Slitting",
    "Slitting LF",
    "Spot UV",
    "Texture",
    "Tie String",
    "Trimming",
    "Varnish",
    "Waterbase",
    "Side Glue",
    "2 Point Glue",
    "4 Point Glue",
    "Delivery"
  ];
  const processStats = {};

  // Initialize stats for each process
  processList.forEach((processName) => {
    processStats[processName] = {
      name: processName,
      totalTime: 0,
      count: 0,
      activeCount: 0,
    };
  });

  // Calculate stats from batch steps - ONLY current active step per batch
  batches.forEach((batch) => {
    if (batch.steps && Array.isArray(batch.steps)) {
      // ? 1. Handle DONE steps
      batch.steps.forEach((step) => {
        if (step.isDone && processStats[step.name]) {
          const durationDays = Math.max(
            1,
            Math.ceil(Number(step.duration) || 0),
          );
          processStats[step.name].totalTime += durationDays;
          processStats[step.name].count += 1;
        }
      });

      // ? 2. Handle ONLY current active step
      const currentStep = batch.steps.find((step) => !step.isDone);

      if (currentStep && processStats[currentStep.name]) {
       
        processStats[currentStep.name].activeCount += 1;
      }
    }
  });
  // Calculate averages - CEIL the average time (0.5 = 1 day, 1.5 = 2 days)
  const averages = Object.values(processStats).map((stat) => ({
    name: stat.name,
    avgTime: stat.count > 0 ? Math.ceil(stat.totalTime / stat.count) : 0,
    activeCount: stat.activeCount,
  }));

  // Generate rawCapacity data from COMPLETED batches (isDone = true)
  const machineCapacityMap = {};

  //
  batches.forEach((batch) => {
    if (batch.steps && Array.isArray(batch.steps)) {
      batch.steps.forEach((step) => {
        // Only count COMPLETED steps (isDone = true)
        if (step.isDone && step.endDate && step.endDate !== "-") {
          const machine = step.detail || "GENERAL";
          const dateKey = step.endDate; // Format: D/M/YYYY
          const key = `${dateKey}|${machine}`;

          if (!machineCapacityMap[key]) {
            machineCapacityMap[key] = {
              date: dateKey,
              machine:
                machine === "Ijima" || machine.toLowerCase().includes("ijima")
                  ? "IJIMA"
                  : machine === "Hand" || machine.toLowerCase().includes("hand")
                    ? "HANDSWITCH"
                    : machine === "Out" || machine.toLowerCase().includes("out")
                      ? "OUTSOURCED"
                      : "GENERAL",
              qty: 0,
            };
          }
          machineCapacityMap[key].qty += batch.qty;
        }
      });
    }
  });

  const rawCapacity = Object.values(machineCapacityMap);

  const totalJobs = jobListing.length;
  const totalBatches = batches.length;
  const totalQuantity = batches.reduce(
    (acc, b) => acc + (Number(b.qty) || 0),
    0,
  );

  const completedBatches = batches.filter((b) => {
    const status = String(b.status || "").toLowerCase();
    return status === "completed" || status === "done";
  }).length;

  // Calculate requirement updates
  const requirementUpdates = [];

  batches.forEach((batch) => {
    if (!batch.steps || batch.steps.length === 0) return;
    // Find current step index (first step without isDone, meaning not done)
    let currentStepIndex = -1;
    for (let i = 0; i < batch.steps.length; i++) {
      if (!batch.steps[i].isDone) {
        currentStepIndex = i;
        break;
      }
    }
    if (currentStepIndex === -1) return; // all steps done

    const currentStep = batch.steps[currentStepIndex];
    const expectedDateStr = currentStep.expDate;
    if (!expectedDateStr || expectedDateStr === "-") return;

    // Parse expected date (dd/mm/yyyy)
    const [day, month, year] = expectedDateStr.split("/").map(Number);
    const expectedDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = expectedDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 2) return; // not urgent

    let duration;
    if (diffDays == 0) {
      duration = `Due today`;
    } else if (diffDays > 0) {
      duration = `${diffDays} days left`;
    } else {
      duration = `Overdue ${Math.abs(diffDays)} days`;
    }

    let lastUpdated = "";
    let prevDurationTime = "";
    if (currentStepIndex > 0) {
      const prevStep = batch.steps[currentStepIndex - 1];
      const prevDurationStr = prevStep.endDate;
      if (!prevDurationStr || prevDurationStr === "-") return;

      // Parse expected date (dd/mm/yyyy)
      const [day, month, year] = prevDurationStr.split("/").map(Number);
      const prevDuration = new Date(year, month - 1, day);

      const prevdiffTime = prevDuration - today;
      const prevdiffDays = Math.ceil(prevdiffTime / (1000 * 60 * 60 * 24));
      prevDurationTime = `${Math.abs(prevdiffDays)}`;
      lastUpdated = `${prevStep.name}-${prevStep.endDate}` || "";
    } else {
      // First step: use batch creation date
      const batchDateStr = batch.batchDate;
      if (!batchDateStr || batchDateStr === "-") return;

      const batchDate = new Date(batchDateStr);
      const batchDiffTime = today - batchDate;
      const batchDiffDays = Math.ceil(batchDiffTime / (1000 * 60 * 60 * 24));
      prevDurationTime = `${batchDiffDays}`;
      const formattedBatchDate = batchDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      lastUpdated = `Created-${formattedBatchDate}`;
    }

    requirementUpdates.push({
      psn: batch.psn,
      batchId: batch.batchId,
      jobName: batch.jobName,
      quantity: batch.qty,
      currentProcess: currentStep.name,
      duration,
      lastUpdated,
      dueDays: diffDays,
      isDelayed: diffDays < 0,
      prevDurationTime,
    });
  });

  const result = {
    jobs: batches,
    jobListing: batches, // For compatibility with both old and new frontend
    batchListing: batches, // Also return as batchListing for backward compat
    averages: averages, // For process workload display
    rawCapacity: rawCapacity, // For machine capacity display
    requirementUpdates: requirementUpdates, // New requirement update listing
    stats: {
      totalJobs,
      totalBatches,
      totalQuantity,
      completedBatches,
      pendingBatches: totalBatches - completedBatches,
    },
  };
  return result;
}


// ============ EXPRESS ROUTES ============
// Redirect root to login.html
app.get("/", (req, res) => {
  console.log("[APP] GET / - redirecting to login");
  res.redirect("/login.html");
});
// Serve static files from the 'public' directory (make sure to create this and add your frontend files)
app.use(express.static(path.join(__dirname, "public")));


// API route to get access token (for testing purposes, not needed by frontend)
app.get("/api/getToken", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/getToken - attempting to get token");
    const token = await getAccessToken();
    console.log("[API] GET /api/getToken - success");
    serverLogger.dataRead(req.body, token.length);
    serverLogger.apiSuccess(req, 200, { rowCount: token.length });
    res.json({ accessToken: token });
  } catch (error) {
    console.error("[API] GET /api/getToken - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to get token" });
  }
});


// API route to get BatchListing data
app.get("/api/batchListing", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/batchListing");
    const data = await getTableRowsAsObjects("BatchListing");
    serverLogger.dataRead("BatchListing", data.length);
    serverLogger.apiSuccess(req, 200, { rowCount: data.length });
    res.json(data);
  } catch (error) {
    console.error("[API] GET /api/batchListing - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to load BatchListing" });
  }
});


// API route to get archived JobListing data
// OLD SHAREPOINT FUNCTION - COMMENTED OUT
// This route retrieves archived job listings from the "ArchiveJob" table
app.get("/api/archiveJobListing", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/archiveJobListing");
    const data = await getTableRowsAsObjects("ArchiveJob");
    serverLogger.dataRead("ArchiveJob", data.length);
    serverLogger.apiSuccess(req, 200, { rowCount: data.length });
    res.json(data);
  } catch (error) {
    console.error("[API] GET /api/archiveJobListing - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to load ArchiveJob" });
  }
});




// API route to get archived BatchListing data
// OLD SHAREPOINT FUNCTION - COMMENTED OUT
// This route retrieves archived batch listings from the "ArchiveBatch" table
// Which is used to store historical batch data that has been removed from the active BatchListing.
//  This allows the frontend to display past batches and their details in an archive view.
app.get("/api/archiveBatchListing", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/archiveBatchListing");
    const data = await getTableRowsAsObjects("ArchiveBatch");
    serverLogger.dataRead("ArchiveBatch", data.length);
    serverLogger.apiSuccess(req, 200, { rowCount: data.length });
    res.json(data);
  } catch (error) {
    console.error("[API] GET /api/archiveBatchListing - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to load ArchiveBatch" });
  }
});

// OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE
// API route for user registration
app.post("/api/register", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/register - request received");
    const { email, password, confirmPassword, phone, user_name, job_title, role: requestedRole } = req.body;

    if (!email || !password || !confirmPassword || !phone || !String(user_name || "").trim()) {
      return res
        .status(400)
        .json({ success: false, error: "Please complete all fields." });
    }
    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, error: "Please enter a valid email address." });
    }
    if (!isValidPhone(phone)) {
      return res
        .status(400)
        .json({ success: false, error: "Please enter a valid phone number." });
    }
    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, error: "Passwords do not match." });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        error:
          "Password must be at least 8 characters long and include uppercase, lowercase, number, and symbol.",
      });
    }

    // Determine the role to assign (default to User)
    let assignRole = 'User';
    if (requestedRole) {
      const validRoles = ['User', 'Admin', 'SuperAdmin'];
      if (!validRoles.includes(requestedRole)) {
        return res.status(400).json({
          success: false,
          error: "Invalid role specified.",
        });
      }
      assignRole = requestedRole;
    }

    const users = await getTableRowsAsObjects("User");
    serverLogger.dataRead("User", users.length);
    serverLogger.apiSuccess(req, 200, { rowCount: users.length });
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(user_name).trim().toLowerCase();
    const duplicate = users.find((row) => {
      const existingEmail = String(row.user_email || row.email || "")
        .trim()
        .toLowerCase();
      const activeStatus = String(row.active || "")
        .trim()
        .toLowerCase();
      return existingEmail === normalizedEmail && activeStatus === "active";
    });
    if (duplicate) {
      return res
        .status(409)
        .json({ success: false, error: "This email is already registered." });
    }

    const duplicateUsername = users.find((row) => {
      const existingUsername = String(row.user_name || row.username || "")
        .trim()
        .toLowerCase();
      const activeStatus = String(row.active || "")
        .trim()
        .toLowerCase();
      return existingUsername === normalizedUsername && activeStatus === "active";
    });
    if (duplicateUsername) {
      return res
        .status(409)
        .json({ success: false, error: "This username is already taken." });
    }

    const nextId =
      users.reduce((max, row) => {
        const id = parseInt(row.user_id, 10);
        return !isNaN(id) && id > max ? id : max;
      }, 0) + 1;

    const hashedPassword = await bcrypt.hash(password, 10);
    const headers = await getTableHeaders("User");
    const today = new Date().toISOString().slice(0, 10);

    const rowValues = headers.map((header) => {
      const key = String(header).trim().toLowerCase();
      if (key === "user_id") return nextId;
      if (key === "user_email") return String(email).trim();
      if (key === "user_name") return String(user_name || "").trim();
      if (key === "user_jobtitle") return String(job_title || "").trim();
      if (key === "user_password") return hashedPassword;
      if (key === "user_phone") return String(phone).trim();
      if (key === "role") return assignRole;
      if (key === "created_date") return today;
      if (key === "last_login") return "";
      if (key === "active") return "Active";
      return "";
    });

    await addTableRow("User", rowValues);
    res.json({ success: true, message: "Registration successful." });
  } catch (error) {
    console.error("[API] POST /api/register - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Registration failed." });
  }
});


// API route to update user profile
// OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE
// This route allows users to update their profile information, including name, job title, and password. 
// It also logs the changes in the audit log with a detailed diff of what was changed.
app.post("/api/updateUser", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/updateUser - request received");
    const { user_id, user_name, job_title, password, actor } = req.body;

    if (!user_id) {
      return res
        .status(400)
        .json({ success: false, error: "User ID is required." });
    }

    const users = await getTableRowsAsObjects("User");
    let userIndex = -1;
    let user = null;

    serverLogger.dataRead("User", users.length);
    serverLogger.apiSuccess(req, 200, { rowCount: users.length });

    for (let i = 0; i < users.length; i++) {
      if (String(users[i].user_id) === String(user_id)) {
        userIndex = i;
        user = users[i];
        break;
      }
    }

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const passwordChanged = !!password;

    // Prepare updates
    const updates = {};
    if (user_name !== undefined) {
      const normalizedUsername = String(user_name || "").trim();
      if (!normalizedUsername) {
        return res.status(400).json({
          success: false,
          error: "Username is required.",
        });
      }

      const duplicateUsername = users.find((row) => {
        const existingUsername = String(row.user_name || row.username || "")
          .trim()
          .toLowerCase();
        const activeStatus = String(row.active || "")
          .trim()
          .toLowerCase();
        return (
          String(row.user_id || "") !== String(user_id) &&
          existingUsername === normalizedUsername.toLowerCase() &&
          activeStatus === "active"
        );
      });

      if (duplicateUsername) {
        return res.status(409).json({
          success: false,
          error: "This username is already taken.",
        });
      }

      updates.user_name = normalizedUsername;
    }
    if (job_title !== undefined) updates.user_jobtitle = job_title;
    if (passwordChanged) {
      updates.user_password = await bcrypt.hash(password, 10);
    }

    // Build after-user object for diff (exclude password from diff)
    const afterUser = { ...user };
    if (user_name !== undefined) afterUser.user_name = user_name;
    if (job_title !== undefined) afterUser.user_jobtitle = job_title;

    // Get headers to map column names
    const headers = await getTableHeaders("User");
    const rowValues = headers.map((header) => {
      const key = String(header).toLowerCase();
      if (updates[key] !== undefined) return updates[key];
      return user[header] !== undefined ? user[header] : "";
    });

    await updateTableRowValues("User", userIndex, rowValues);

    // -- Audit log --------------------------------------------------------------
    const auditDiff = buildUserAuditDiff(user, afterUser, passwordChanged);

    // Build change summary
    const profileFields = auditDiff.changedFields.filter(
      (f) => f.field !== "Password",
    );
    const summaryParts = [];
    if (profileFields.length > 0)
      summaryParts.push(profileFields.map((f) => f.display).join("; "));
    if (passwordChanged) summaryParts.push("Password changed");
    const changeSummary = summaryParts.join("; ") || "No changes";

    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(actor) || String(user.user_email || user_id),
      action: "UPDATE",
      module: "Accounts",
      identifier: String(user_id),
      changeSummary,
      dataPayload: {
        source: "updateUser",
        userId: user_id,
        changedFields: auditDiff.changedFields,
        passwordChanged,
        old_data: {
          user_name: user.user_name || "",
          user_jobtitle: user.user_jobtitle || "",
          user_email: user.user_email || "",
        },
        new_data: {
          user_name: afterUser.user_name || "",
          user_jobtitle: afterUser.user_jobtitle || "",
          user_email: afterUser.user_email || "",
        },
      },
    });
    // --------------------------------------------------------------------------

    res.json({ success: true, message: "User updated successfully." });
  } catch (error) {
    console.error("[API] POST /api/updateUser - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Failed to update user." });
  }
});

// OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE
// API route for user login (accepts email or username)
app.post("/api/login", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/login - request received");
    const { email, username, password } = req.body;

    // Accept either email or username
    const credential = email || username;
    serverLogger.authAttempt(credential);

    if (!credential || !password) {
      return res.status(400).json({
        success: false,
        error: "Email/username and password are required.",
      });
    }

    const users = await getTableRowsAsObjects("User");
    const normalizedCredential = String(credential).trim().toLowerCase();
    let foundIndex = -1;
    let user = null;

    // Search for user by email OR username
    for (let i = 0; i < users.length; i++) {
      const row = users[i];

      // Check if credential matches email
      const rowEmail = String(row.user_email || row.email || "")
        .trim()
        .toLowerCase();

      // Check if credential matches username (Column C - user_name)
      const rowUsername = String(row.user_name || row.username || "")
        .trim()
        .toLowerCase();

      if (
        rowEmail === normalizedCredential ||
        rowUsername === normalizedCredential
      ) {
        foundIndex = i;
        user = row;
        break;
      }
    }

    if (
      !user ||
      String(user.active || "")
        .trim()
        .toLowerCase() !== "active"
    ) {
      serverLogger.authFail(credential, "User not found or inactive");
      logToSeq("warn", {
        action: "LOGIN_FAILED",
        module: "Auth",
        reason: "User not found or inactive",
        identifier: normalizedCredential,
      });
      return res
        .status(401)
        .json({ success: false, error: "Invalid email/username or password." });
    }

    const passwordHash = String(user.user_password || user.password || "");
    const passwordMatch = await bcrypt.compare(password, passwordHash);
    if (!passwordMatch) {
      serverLogger.authFail(credential, "Incorrect password");
      logToSeq("warn", {
        action: "LOGIN_FAILED",
        module: "Auth",
        reason: "Incorrect password",
        identifier: normalizedCredential,
      });
      return res
        .status(401)
        .json({ success: false, error: "Invalid email/username or password." });
    }

    const publicUser = {
      user_id: user.user_id,
      user_email: user.user_email,
      user_phone: user.user_phone,
      user_name: user.user_name || "",
      job_title: user.user_jobtitle || "",
      role: user.role || "User",
      active: user.active || "Active",
    };

    try {
      const headers = await getTableHeaders("User");
      const rowValues = headers.map((header) => {
        const key = String(header).trim().toLowerCase();
        if (key === "last_login") return new Date().toISOString().slice(0, 10);
        return user[header] !== undefined ? user[header] : "";
      });
      await updateTableRowValues("User", foundIndex, rowValues);
    } catch (updateError) {
      console.error(
        "[API] Login succeeded but failed to update last_login:",
        updateError,
      );
    }

    const loginDeviceInfo = getDeviceInfo(req);
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account:
        publicUser.user_email || publicUser.user_name || normalizedCredential,
      action: "LOGIN",
      module: "Auth",
      identifier: publicUser.user_id || normalizedCredential,
      changeSummary: `User logged in: ${publicUser.user_email || publicUser.user_name || normalizedCredential} via ${loginDeviceInfo.deviceType} (${loginDeviceInfo.browser}, ${loginDeviceInfo.os})`,
      dataPayload: {
        userId: publicUser.user_id || "",
        email: publicUser.user_email || "",
        username: publicUser.user_name || "",
        role: publicUser.role || "User",
        device: loginDeviceInfo.deviceType,
        browser: loginDeviceInfo.browser,
        os: loginDeviceInfo.os,
        userAgent: loginDeviceInfo.userAgent,
      },
    });

    serverLogger.authSuccess(credential, publicUser.role, publicUser.user_id);
    serverLogger.apiSuccess(req, 200, {
      userId: publicUser.user_id,
      role: publicUser.role,
    });

    res.json({ success: true, user: publicUser });
    logToSeq("info", {
      action: "LOGIN_SUCCESS",
      module: "Auth",
      userId: publicUser.user_id,
      email: publicUser.user_email,
      username: publicUser.user_name,
      role: publicUser.role,
    });
  } catch (error) {
    console.error("[API] POST /api/login - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Login failed." });
  }
});

// API route to check if user exists and is active (for auto-login or session validation)
app.post("/api/check-user", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/check-user - request received");
    const { user_id, email } = req.body;

    if (!user_id || !email) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: "User ID and email are required.",
      });
    }

    const users = await getTableRowsAsObjects("User");
    const normalizedId = String(user_id).trim();
    const normalizedEmail = String(email).trim().toLowerCase();

    const user = users.find((row) => {
      const rowId = String(row.user_id || row.id || "").trim();
      const rowEmail = String(row.user_email || row.email || "")
        .trim()
        .toLowerCase();
      const rowStatus = String(row.active || "").trim().toLowerCase();
      return (
        rowId === normalizedId &&
        rowEmail === normalizedEmail &&
        rowStatus === "active"
      );
    });

    if (!user) {
      serverLogger.apiFail(req, 401, new Error("User not found or inactive"));
      return res.status(401).json({
        success: false,
        valid: false,
        error: "Invalid or inactive user.",
      });
    }

    const publicUser = {
      user_id: user.user_id,
      user_email: user.user_email,
      user_phone: user.user_phone,
      user_name: user.user_name || "",
      job_title: user.user_jobtitle || "",
      role: user.role || "User",
      active: user.active || "Active",
    };

    const autoLoginDeviceInfo = getDeviceInfo(req);
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account:
        publicUser.user_email || publicUser.user_name || publicUser.user_id || "Unknown",
      action: "LOGIN",
      module: "Auth",
      identifier: publicUser.user_id || publicUser.user_email || publicUser.user_name,
      changeSummary: `Auto login by ${publicUser.user_email || publicUser.user_name || publicUser.user_id} via ${autoLoginDeviceInfo.deviceType} (${autoLoginDeviceInfo.browser}, ${autoLoginDeviceInfo.os})`,
      dataPayload: {
        userId: publicUser.user_id || "",
        email: publicUser.user_email || "",
        username: publicUser.user_name || "",
        role: publicUser.role || "User",
        source: "auto-login",
        device: autoLoginDeviceInfo.deviceType,
        browser: autoLoginDeviceInfo.browser,
        os: autoLoginDeviceInfo.os,
        userAgent: autoLoginDeviceInfo.userAgent,
      },
    });

    serverLogger.apiSuccess(req, 200, { userId: publicUser.user_id });
    res.json({ success: true, valid: true, user: publicUser });
  } catch (error) {
    console.error("[API] POST /api/check-user - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, valid: false, error: "User validation failed." });
  }
});

// ============ OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE ============
// API route to get all users (for admin)
app.get("/api/users", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/users - request received");
    const users = await getTableRowsAsObjects("User");
    serverLogger.dataRead("User", users.length);
    serverLogger.apiSuccess(req, 200, { rowCount: users.length });

    // Return only necessary fields, exclude password
    const publicUsers = users.map(user => ({
      user_id: user.user_id,
      user_email: user.user_email,
      user_name: user.user_name || "",
      user_jobtitle: user.user_jobtitle || "",
      user_phone: user.user_phone,
      role: user.role || "User",
      created_date: user.created_date,
      last_login: user.last_login,
      active: user.active || "Active"
    }));

    res.json({ success: true, users: publicUsers });
  } catch (error) {
    console.error("[API] GET /api/users - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Failed to fetch users." });
  }
});

// ============ OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE ============
// API route to delete a user (Old SharePoint code - commented out for migration to database)
app.delete("/api/users/:user_id", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] DELETE /api/users/:user_id - request received");
    const { user_id } = req.params;
    const { actor } = req.body; // actor for audit log

    if (!user_id) {
      return res.status(400).json({ success: false, error: "User ID is required." });
    }

    const users = await getTableRowsAsObjects("User");
    let userIndex = -1;
    let user = null;

    for (let i = 0; i < users.length; i++) {
      if (String(users[i].user_id) === String(user_id)) {
        userIndex = i;
        user = users[i];
        break;
      }
    }

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    // Delete the row from SharePoint
    await deleteTableRow("User", userIndex);

    // Audit log
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(actor) || "Admin",
      action: "DELETE",
      module: "Accounts",
      identifier: String(user_id),
      changeSummary: `User deleted: ${user.user_email || user.user_name || user_id}`,
      dataPayload: {
        source: "deleteUser",
        userId: user_id,
        deletedUser: {
          user_id: user.user_id,
          user_email: user.user_email,
          user_name: user.user_name,
          role: user.role
        }
      },
    });

    serverLogger.apiSuccess(req, 200);
    res.json({ success: true, message: "User deleted successfully." });
  } catch (error) {
    console.error("[API] DELETE /api/users/:user_id - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Failed to delete user." });
  }
});

// ============ OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE ============
// Main API route to get dashboard data (combines JobListing and BatchListing with processing)
app.get("/api/dashboard", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/dashboard - request received");
    // Set cache control headers to prevent caching
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    serverLogger.dashboardStart();
    const data = await generateDashboardData();
    console.log("[API] GET /api/dashboard - sending response");
    serverLogger.dashboardSuccess(
      data.batchListing?.length,
      data.jobListing?.length,
    );
    serverLogger.apiSuccess(req, 200, {
      batchCount: data.batchListing?.length,
    });
    res.json(data);
  } catch (error) {
    console.error("[API] GET /api/dashboard - error:", error);
    serverLogger.dashboardFail(error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

app.get('/api/check-psn', async (req, res) => {
  serverLogger.apiRequest(req);
  const psn = String(req.query.psn || '').trim();
  if (!psn) {
    return res.status(400).json({ error: 'PSN query is required.' });
  }

  try {
    const rows = await getTableRowsAsObjects('JobListing');
    const normalizedSearch = psn.toUpperCase();
    const duplicate = rows.some((row) => {
      const existingPsn = String(row['Product Serial Number'] || row.PSN || row.psn || '').trim().toUpperCase();
      return existingPsn === normalizedSearch;
    });

    if (duplicate) {
      return res.status(409).json({ available: false, error: 'Duplicate PSN' });
    }

    return res.json({ available: true });
  } catch (error) {
    console.error('[API] GET /api/check-psn - error:', error);
    serverLogger.apiFail(req, 500, error);
    return res.status(500).json({ error: 'Unable to verify PSN.' });
  }
});

// Helper function to normalize jobType input (accepts string or array, trims values, removes empties, and joins with commas)
function normalizeJobTypeValue(jobType) {
  if (Array.isArray(jobType)) {
    return jobType
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(",");
  }

  return String(jobType || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");
}


// ============ OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE ============
// API route to submit new job and batch data
app.post("/api/submitData", async (req, res) => {
  serverLogger.apiRequest(req, { psn: req.body?.psn });
  try {
    console.log("?? API HIT: /api/submitData");

    const data = req.body;
    const normalizedJobType = normalizeJobTypeValue(data?.jobType);
    console.log("?? Incoming data:", JSON.stringify(data, null, 2));

    let jobListingColumnCount = null;
    let batchListingColumnCount = null;
    let jobRowLength = null;
    let batchRowLength = null;

    // ? STEP 1: Validate input
    if (!data || !data.psn || !data.batches) {
      console.error("? Validation failed:", data);
      return res.status(400).json({ error: "Invalid submit payload" });
    }
    console.log("? Step 1: Validation passed");

    // ? STEP 2: Check batches array
    if (!Array.isArray(data.batches)) {
      console.error("? batches is not an array:", data.batches);
      return res.status(400).json({ error: "batches must be an array" });
    }
    console.log("? Step 2: batches is valid array");

    // ? STEP 3: Get existing rows
    console.log("? Fetching existing JobListing...");
    const existing = await getTableRowsAsObjects("JobListing");
    console.log("?? Existing rows fetched:", existing.length);

    console.log(
      "?? Existing PSNs:",
      existing.map((j) => j.PSN || j.psn),
    );

    // ? STEP 4: Duplicate check
    if (
      existing.some(
        (job) =>
          String(job["Product Serial Number"] || job.PSN || job.psn).trim() ===
          String(data.psn).trim(),
      )
    ) {
      console.error("? Duplicate PSN found:", data.psn);
      return res.status(409).json({ error: "Duplicate PSN" });
    }
    console.log("? Step 4: No duplicate found");

    // ? STEP 5: Format dates
    console.log("? Formatting dates...");
    const normalizedOrderDate = formatDateForExcel(data.orderDate);
    const normalizedDeliveryDate = formatDateForExcel(data.deliveryDate);

    console.log("?? Formatted dates:", {
      order: normalizedOrderDate,
      delivery: normalizedDeliveryDate,
    });

    const formatDeliveryDate = toExcelDateText(data.deliveryDate);

    // ? STEP 6: Prepare job row
    const jobRow = [
      data.psn,
      data.piNumber || "",
      data.salesCode || "",
      data.jobName || "",
      normalizedJobType,
      data.quantity || 0,
      normalizedOrderDate !== "-" ? normalizedOrderDate : "",
      normalizedDeliveryDate !== "-" ? normalizedDeliveryDate : "",
      data.itemType || "",
      data.priority || "",
      data.status || "ON SCHEDULE",
      formatDeliveryDate || "",
      data.remaining || 0, // Column M (13th column)
      data.balanceToDelivery || 0, // New column
      data.partialDelivery || 0, // New column
      data.totalDelivery || 0, // New column
      data.productionMarginWaste || "0%", // Column Q: Production Margin Waste
      false, // Column R: Delivery Edited default false for new jobs
    ];

    jobListingColumnCount = await getTableColumnCount("JobListing");

    if (jobRow.length < jobListingColumnCount) {
      while (jobRow.length < jobListingColumnCount) jobRow.push("");
    } else if (jobRow.length > jobListingColumnCount) {
      jobRow.splice(jobListingColumnCount);
    }

    jobRowLength = jobRow.length;
    console.log(
      "?? Job row to insert:",
      jobRow,
      `length=${jobRowLength}`,
      `expected=${jobListingColumnCount}`,
    );

    // ? STEP 7: Insert job row
    console.log("? Inserting into JobListing...");
    await addTableRow("JobListing", jobRow);
    serverLogger.dataWrite("JobListing", "INSERT", data.psn);
    console.log("? Step 7: Job row inserted");

    // ? STEP 8: Insert batch rows
    const createDate = toExcelDate(new Date());
    console.log("? Inserting batch rows...");

    batchListingColumnCount = await getTableColumnCount("BatchListing");
    console.log(`?? BatchListing table has ${batchListingColumnCount} columns`);

    for (let batchIndex = 0; batchIndex < data.batches.length; batchIndex++) {
      const batch = data.batches[batchIndex];
      const batchId = `${data.psn}-${batchIndex + 1}`;
      console.log("?? Processing batch:", batchId);

      const batchQty = batch.batchQty || 0;

      // Basic batch info
      const batchRow = [
        data.psn,
        batchId,
        createDate,
        data.jobName || "",
        batchQty,
        "",
      ];

      // Steps block (108 columns)
      const stepsData = new Array(108).fill("");
      const BLOCK_SIZE = 9;

      for (let j = 0; j < 12; j++) {
        const baseIdx = j * BLOCK_SIZE;
        stepsData[baseIdx + 8] = "FALSE";
      }

      if (batch.steps && Array.isArray(batch.steps)) {
        batch.steps.forEach((step, index) => {
          if (index < 12) {
            const baseIdx = index * BLOCK_SIZE;
            stepsData[baseIdx] = step.processName || "";
            stepsData[baseIdx + 1] = formatDateForExcel(step.expDate) || "";
            stepsData[baseIdx + 2] = formatDateForExcel(step.endDate) || "";
            stepsData[baseIdx + 3] = step.duration || "";
            stepsData[baseIdx + 4] = step.detail || "";
            stepsData[baseIdx + 5] = step.status || "";
            stepsData[baseIdx + 6] = step.remark + "|" || "|";
            stepsData[baseIdx + 7] = step.revertRemark || "";
            // ? overwrite if provided
            stepsData[baseIdx + 8] = step.isDone ? "TRUE" : "FALSE";
          }
        });
      }

      // Combine
      let finalRow = batchRow.concat(stepsData);

      // ? NEW DYNAMIC QTY STRING LOGIC
      const START_COL = 6;

      let activeProcessCols = [];

      for (let j = 0; j < 12; j++) {
        let baseIdx = j * BLOCK_SIZE;
        let processName = String(stepsData[baseIdx] || "").trim();

        if (processName !== "" && processName !== "--") {
          let colIndex = START_COL + j * BLOCK_SIZE;
          activeProcessCols.push(colIndex);
        }
      }

      const qtyStringZero = activeProcessCols
        .map((colIdx) => `${colIdx}:${0}`)
        .join("|");

      const qtyString = activeProcessCols
        .map((colIdx) => `${colIdx}:${batchQty}`)
        .join("|");

      // Ensure index 120 exists (DP = 119, DQ = 120)
      if (finalRow.length <= 120) {
        const neededPadding = 121 - finalRow.length;
        for (let i = 0; i < neededPadding; i++) {
          finalRow.push("");
        }
      }

      // Set Column DP & DQ
      finalRow[114] = "FALSE";
      finalRow[119] = qtyStringZero;
      finalRow[120] = qtyString;

      // Pad/trim to match table
      if (finalRow.length < batchListingColumnCount) {
        const neededPadding = batchListingColumnCount - finalRow.length;
        for (let p = 0; p < neededPadding; p++) {
          finalRow.push("");
        }
      } else if (finalRow.length > batchListingColumnCount) {
        finalRow = finalRow.slice(0, batchListingColumnCount);
      }

      batchRowLength = finalRow.length;

      if (batchRowLength !== batchListingColumnCount) {
        throw new Error(`Batch row length mismatch for ${batchId}`);
      }

      await addTableRow("BatchListing", finalRow);
      serverLogger.dataWrite("BatchListing", "INSERT", batchId);
      console.log("? Batch inserted:", batchId);
    }

    console.log("? Step 8: All batch rows inserted");
    serverLogger.apiSuccess(req, 200, {
      psn: data.psn,
      batchCount: data.batches.length,
    });

    res.json({
      message: `Success! Job recorded and ${data.batches.length} batch(es) created.`,
    });
  } catch (error) {
    console.error("?? ERROR:", error.message);
    serverLogger.apiFail(req, 500, error, { psn: req.body?.psn });

    res.status(500).json({
      error: "Failed to submit data",
      message: error.message,
    });
  }
});

// ============ OLD SHAREPOINT CODE - COMMENTED OUT FOR MIGRATION TO DATABASE ============
// API route to update JobListing details by PSN
app.post("/api/updateJobListing", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/updateJobListing - request received");
    const {
      psn,
      piNumber,
      jobName,
      productionMarginWaste,
      quantity,
      orderDate,
      deliveryDate,
      jobType,
      itemType,
      item,
      priority,
      salesCode,
    } = req.body;
    const normalizedJobType = normalizeJobTypeValue(jobType);
    const itemValue = itemType || item || '';

    if (!psn) {
      return res.status(400).json({ success: false, error: "PSN is required" });
    }

    console.log(`[API] Updating JobListing for PSN: ${psn}`);
    const formatDeliveryDate = toExcelDateText(deliveryDate);
    const ctx = await getSharePointFileContext();
    const normalizedSearchPsn = normalizePsn(psn);
    const rows = await getTableRowsAsObjects("JobListing");

    serverLogger.dataRead("JobListing", rows.length);
    serverLogger.apiSuccess(req, 200, { rowCount: rows.length });

    let targetRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const rowPsn = normalizePsn(
        rows[i]["Product Serial Number"] || rows[i].PSN || "",
      );
      if (rowPsn === normalizedSearchPsn) {
        targetRowIndex = i;
        break;
      }
    }

    if (targetRowIndex === -1) {
      return res
        .status(404)
        .json({ success: false, error: "Job not found with the given PSN" });
    }

    const headerRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('JobListing')/headerRowRange`,
      { headers: ctx.headers },
    );
    const headers = headerRes.data.values?.[0] || [];
    const originalRow = rows[targetRowIndex];
    const updatedRow = headers.map((header) => {
      return originalRow[header] !== undefined ? originalRow[header] : "";
    });
    const normalizeDateComparisonKey = (value) => {
      const parsed = parseDateOnly(value);
      if (parsed) return parsed.toISOString().slice(0, 10);
      return String(value ?? "").trim();
    };

    const findColumnIndex = (possibleNames, headerList = headers) => {
      for (let name of possibleNames) {
        const idx = headerList.indexOf(name);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const updateColumn = (value, possibles, label) => {
      const idx = findColumnIndex(possibles);
      if (idx >= 0 && value !== undefined) {
        updatedRow[idx] = value === null ? "" : value;
        console.log(`[API] Updated ${label} at index ${idx}: ${value}`);
      }
    };

    const originalDeliveryDateValue =
      originalRow["Delivery Date"] ??
      originalRow.Delivery_Date ??
      originalRow.deliveryDate ??
      originalRow.delivery_date ??
      originalRow["Delivery Format"] ??
      "";
    const deliveryDateWasEdited =
      deliveryDate !== undefined &&
      normalizeDateComparisonKey(originalDeliveryDateValue) !==
        normalizeDateComparisonKey(deliveryDate);

    updateColumn(
      piNumber,
      ["PI Number", "PI_Number", "PI Number", "piNumber", "pi"],
      "PI Number",
    );
    updateColumn(
      jobName,
      ["Job Name", "Job_Name", "JobName", "jobName"],
      "Job Name",
    );
    updateColumn(quantity, ["Quantity", "Qty", "quantity"], "Quantity");
    updateColumn(
      orderDate,
      ["Order Date", "Order_Date", "orderDate", "order_date"],
      "Order Date",
    );
    updateColumn(
      deliveryDate,
      ["Delivery Date", "Delivery_Date", "deliveryDate", "delivery_date"],
      "Delivery Date",
    );
    updateColumn(
      normalizedJobType,
      ["Job Type", "Job_Type", "JobType", "jobType"],
      "Job Type",
    );
    updateColumn(itemValue, ["Item", "Item Type", "itemType"], "Item");
    updateColumn(priority, ["Priority"], "Priority");
    updateColumn(
      salesCode,
      ["salesCode", "Sales Code", "Sales_Code", "SalesCode", "code"],
      "Sales Code",
    );
    updateColumn(
      productionMarginWaste,
      ["Production Margin Waste", "Production_Margin_Waste", "productionMarginWaste", "production_margin_waste"],
      "Production Margin Waste",
    );
    updateColumn(formatDeliveryDate, ["Delivery Format"], "Delivery Format");
    if (deliveryDateWasEdited) {
      updateColumn(
        true,
        ["Delivery Edited", "Delivery_Edited", "deliveryEdited"],
        "Delivery Edited",
      );
    }

    const physicalRow = targetRowIndex + 2;
    const colCount = await getTableColumnCount("JobListing");
    const lastColLetter = indexToColumnLetter(colCount - 1);
    const rangeAddress = `A${physicalRow}:${lastColLetter}${physicalRow}`;
    const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='${rangeAddress}')`;
    const formattedValues = updatedRow.map((val) => {
      if (val === true) return "TRUE";
      if (val === false) return "FALSE";
      return val === null || val === undefined ? "" : val;
    });

    await axios.patch(
      url,
      { values: [formattedValues] },
      { headers: ctx.headers },
    );
    console.log(`[API] Successfully updated JobListing for PSN: ${psn}`);

    if (jobName !== undefined) {
      const batchHeaderRes = await axios.get(
        `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('BatchListing')/headerRowRange`,
        { headers: ctx.headers },
      );
      const batchHeaders = batchHeaderRes.data.values?.[0] || [];
      const batchRows = await getTableRows("BatchListing");
      const batchPsnIdx = findColumnIndex(
        ["Product Serial Number", "PSN", "psn"],
        batchHeaders,
      );
      const batchJobNameIdx = findColumnIndex(
        ["Job Name", "Job_Name", "jobName"],
        batchHeaders,
      );

      if (batchPsnIdx >= 0 && batchJobNameIdx >= 0) {
        const batchUpdates = [];
        batchRows.forEach((batchRow, rowIndex) => {
          const values = batchRow.values?.[0] || [];
          const batchPsn = normalizePsn(values[batchPsnIdx]);
          if (batchPsn === normalizedSearchPsn) {
            values[batchJobNameIdx] = jobName;
            batchUpdates.push({ rowIndex, values });
          }
        });
        for (const update of batchUpdates) {
          await updateBatchListingRow(update.rowIndex, update.values);
        }
      }
    }

    res.json({ success: true, message: "Job details updated successfully" });
  } catch (error) {
    console.error("[API] POST /api/updateJobListing - error:", error);
    serverLogger.apiFail(req, 500, error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update job details" });
  }
});

// ============ HELPER FUNCTIONS FOR ARCHIVING ============
// This function normalizes header names by trimming, converting to lowercase, and removing spaces, underscores, and hyphens
function normalizeHeaderName(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
}

// This function retrieves the value from a row object based on a normalized header name
function getRowValueByNormalizedHeader(row, headerName) {
  const normalized = normalizeHeaderName(headerName);
  for (const key of Object.keys(row)) {
    if (normalizeHeaderName(key) === normalized) return row[key];
  }
  return undefined;
}

// This function maps the original row data to the archive table format based on the archive headers
function mapArchiveRowValues(rowData, archiveHeaders, deleteRemark, deleteId) {
  const normalizedRowKeys = {};
  Object.keys(rowData).forEach((key) => {
    normalizedRowKeys[normalizeHeaderName(key)] = key;
  });

  const values = archiveHeaders.map((header) => {
    const normalizedHeader = normalizeHeaderName(header);
    if (normalizedHeader === "deleteremark") {
      return deleteRemark || "";
    }
    if (normalizedHeader === "deleteid") {
      return deleteId || "";
    }

    const sourceKey = normalizedRowKeys[normalizedHeader];
    if (sourceKey !== undefined) {
      return rowData[sourceKey] == null ? "" : rowData[sourceKey];
    }

    return "";
  });

  return values;
}

/**
 * Archive a job row to ArchiveJob table before deletion
 */
async function archiveJobRow(jobRowData, deleteRemark, deleteId) {
  try {
    const archiveHeaders = await getTableHeaders("ArchiveJob");
    const archiveValues = archiveHeaders.length
      ? mapArchiveRowValues(jobRowData, archiveHeaders, deleteRemark, deleteId)
      : [...Object.values(jobRowData), deleteRemark || "", deleteId || ""];

    await addTableRow("ArchiveJob", archiveValues);
    console.log(
      `[Archive] Successfully archived JobListing row with PSN: ${jobRowData["Product Serial Number"] || jobRowData.PSN}`,
    );
    return { success: true };
  } catch (error) {
    console.error("[Archive] Error archiving job row:", error);
    throw error;
  }
}

/**
 * Archive batch rows to ArchiveBatch table before deletion
 */
async function archiveBatchRows(batchRowsData, deleteRemark, deleteId) {
  try {
    const archiveHeaders = await getTableHeaders("ArchiveBatch");
    for (const batchRow of batchRowsData) {
      const archiveValues = archiveHeaders.length
        ? mapArchiveRowValues(batchRow, archiveHeaders, deleteRemark, deleteId)
        : [...Object.values(batchRow), deleteRemark || "", deleteId || ""];
      await addTableRow("ArchiveBatch", archiveValues);
      console.log(
        `[Archive] Successfully archived BatchListing row: ${batchRow.BatchId}`,
      );
    }
    return { success: true, count: batchRowsData.length };
  } catch (error) {
    console.error("[Archive] Error archiving batch rows:", error);
    throw error;
  }
}

// ============ END OF HELPER FUNCTIONS FOR ARCHIVING ============
// API route to delete a job listing by PSN (with archiving)
app.post("/api/deleteJobListing", async (req, res) => {
  try {
    console.log("[API] POST /api/deleteJobListing - request received");
    const { psn, deleteRemark } = req.body;
    const remarkText = String(deleteRemark || "").trim();

    if (!psn) {
      return res.status(400).json({ success: false, error: "PSN is required" });
    }
    if (!remarkText) {
      return res
        .status(400)
        .json({ success: false, error: "Delete remark is required." });
    }

    const ctx = await getSharePointFileContext();
    const normalizedSearchPsn = normalizePsn(psn);

    const jobHeaderRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('JobListing')/headerRowRange`,
      { headers: ctx.headers },
    );
    const jobHeaders = jobHeaderRes.data.values?.[0] || [];
    const jobPsnIdx = findColumnIndexInHeaders(
      ["Product Serial Number", "PSN", "psn"],
      jobHeaders,
    );
    if (jobPsnIdx < 0) {
      return res
        .status(500)
        .json({ success: false, error: "PSN column not found in JobListing" });
    }

    const jobRows = await getTableRows("JobListing");

    const jobRowToDelete = jobRows.find((jobRow) => {
      const values = extractRowValues(jobRow);
      const rowPsn = normalizePsn(values[jobPsnIdx]);
      return rowPsn === normalizedSearchPsn;
    });
    console.log(jobRowToDelete.index);
    if (
      !jobRowToDelete ||
      jobRowToDelete.index === undefined ||
      jobRowToDelete.index === null
    ) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }

    console.log(
      `[DeleteJob] Requested PSN=${psn}, matched JobListing rowId=${jobRowToDelete.index}, rowPSN=${extractRowValues(jobRowToDelete)[jobPsnIdx]}`,
    );

    // STEP 1: Fetch the job row as object and archive it before deletion
    const jobRowsAsObjects = await getTableRowsAsObjects("JobListing");
    const jobRowToArchive = jobRowsAsObjects.find((job) => {
      const jobPsn = normalizePsn(
        job["Product Serial Number"] || job.PSN || "",
      );
      return jobPsn === normalizedSearchPsn;
    });

    const deleteId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (jobRowToArchive) {
      console.log("[DeleteJob] Archiving job row to ArchiveJob table...");
      await archiveJobRow(jobRowToArchive, remarkText, deleteId);
      console.log("[DeleteJob] Job row archived successfully");
    }

    // STEP 2: Fetch and archive batch rows before deletion
    const batchHeaderRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('BatchListing')/headerRowRange`,
      { headers: ctx.headers },
    );
    const batchHeaders = batchHeaderRes.data.values?.[0] || [];
    const batchRowsAsObjects = await getTableRowsAsObjects("BatchListing");

    // Find all batch rows matching this PSN
    const batchRowsToArchive = batchRowsAsObjects.filter((batch) => {
      const batchPsn = normalizePsn(
        batch["Product Serial Number"] || batch.PSN || "",
      );
      return batchPsn === normalizedSearchPsn;
    });

    if (batchRowsToArchive.length > 0) {
      console.log(
        `[DeleteJob] Archiving ${batchRowsToArchive.length} batch row(s) to ArchiveBatch table...`,
      );
      await archiveBatchRows(batchRowsToArchive, remarkText, deleteId);
      console.log("[DeleteJob] Batch rows archived successfully");
    }

    // STEP 3: Now delete the job listing
    await deleteTableRowById("JobListing", jobRowToDelete.index);

    // STEP 4: Delete batch rows
    const batchRows = await getTableRows("BatchListing");

    let batchPsnIdx = batchHeaders.indexOf("Product Serial Number");
    if (batchPsnIdx < 0) {
      const normalizedNames = ["PSN", "psn", "Product Serial Number"];
      for (let name of normalizedNames) {
        const idx = batchHeaders.indexOf(name);
        if (idx >= 0) {
          batchPsnIdx = idx;
          break;
        }
      }
    }

    const batchDeleteIds = [];
    batchRows.forEach((batchRow) => {
      const values = extractRowValues(batchRow);
      const rowPsn = normalizePsn(
        batchPsnIdx >= 0 ? values[batchPsnIdx] : undefined,
      );
      if (
        rowPsn === normalizedSearchPsn &&
        batchRow.index !== undefined &&
        batchRow.index !== null
      ) {
        batchDeleteIds.push(batchRow.index);
      }
    });

    // Delete from bottom to top so index shifting cannot skip matched rows.
    batchDeleteIds.reverse();
    for (const rowId of batchDeleteIds) {
      await deleteTableRowById("BatchListing", rowId);
    }

    res.json({
      success: true,
      message: `Job and related BatchListing rows deleted successfully and archived. Archived Batches: ${batchRowsToArchive.length}`,
      deletedBatchRows: batchDeleteIds.length,
      archivedBatchRows: batchRowsToArchive.length,
    });
  } catch (error) {
    console.error("[API] POST /api/deleteJobListing - error:", error);
    const graphMessage =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Failed to delete job";
    res.status(500).json({ success: false, error: graphMessage });
  }
});


// API route to create a new batch based on the latest batch for a PSN
app.post("/api/createBatch", async (req, res) => {
  try {
    console.log("[API] POST /api/createBatch - request received");
    const { psn, quantity, processDates, batchRemark } = req.body;

    if (!psn || !quantity) {
      return res.status(400).json({ error: "PSN and quantity are required" });
    }

    // Fetch all batches
    const batches = await getTableRowsAsObjects("BatchListing");

    // Filter batches for this PSN
    const psnBatches = batches.filter(
      (b) => String(b["Product Serial Number"] || "").trim() === psn,
    );

    if (psnBatches.length === 0) {
      return res
        .status(404)
        .json({ error: "No existing batches found for this PSN" });
    }

    // Sort by batch ID descending to get the latest
    psnBatches.sort((a, b) => {
      const idA = String(a.BatchId || "")
        .split("-")
        .pop();
      const idB = String(b.BatchId || "")
        .split("-")
        .pop();
      console.log("A" + idA);
      console.log("B" + idB);
      return parseInt(idB) - parseInt(idA);
    });

    const latestBatch = psnBatches[0];
    const latestBatchId = String(latestBatch.BatchId || "");
    const baseId = latestBatchId.split("-")[0];
    const nextIdNum = parseInt(latestBatchId.split("-").pop()) + 1;
    const newBatchId = `${baseId}-${nextIdNum}`;

    // Build new batch row array from table headers to preserve column ordering
    const headers = await getTableHeaders("BatchListing");
    const newBatchRow = headers.map(h => (latestBatch && latestBatch.hasOwnProperty(h) ? latestBatch[h] : ""));

    // Update batch-specific fields
    newBatchRow[1] = newBatchId; // Batch ID
    newBatchRow[2] = toExcelDate(new Date()); // Batch Date
    newBatchRow[4] = quantity; // Quantity

    // Update process expected dates and reset completion status
    const START_COL = 6;
    const BLOCK_SIZE = 9;

    // Reset all process steps to fresh state (no expected/start/end dates, no done status, no remarks)
    for (let j = 0; j < 12; j++) {
      const baseIdx = START_COL + j * BLOCK_SIZE;
      const processName = String(newBatchRow[baseIdx] || "").trim();

      if (processName !== "" && processName !== "--") {
        newBatchRow[baseIdx + 1] = ""; // Expected date
        newBatchRow[baseIdx + 2] = ""; // Start date
        newBatchRow[baseIdx + 3] = ""; // Duration
        newBatchRow[baseIdx + 4] = ""; // End date
        newBatchRow[baseIdx + 5] = "FALSE"; // Status
        newBatchRow[baseIdx + 6] = ""; // Remark (inProgress|delay)
        newBatchRow[baseIdx + 7] = ""; // Revert Remark
        newBatchRow[baseIdx + 8] = false; // Checkbox/flag
      }
    }

    if (processDates) {
      Object.entries(processDates).forEach(([processIndex, date]) => {
        const idx = parseInt(processIndex);
        console.log(`[createBatch] Processing idx=${idx}, date="${date}"`);
        let expectedDateCol;

        // Check processIndex range (0-11) FIRST, before checking column index
        if (!isNaN(idx) && idx >= 0 && idx < 12) {
          expectedDateCol = START_COL + idx * BLOCK_SIZE + 1;
          console.log(
            `[createBatch] Matched processIndex branch: idx=${idx} ? expectedDateCol=${expectedDateCol}`,
          );
        } else if (
          // If the key is a base column index like 6, 15, 24, use it directly
          !isNaN(idx) &&
          idx >= START_COL &&
          (idx - START_COL) % BLOCK_SIZE === 0
        ) {
          expectedDateCol = idx + 1;
          console.log(
            `[createBatch] Matched column index branch: idx=${idx} ? expectedDateCol=${expectedDateCol}`,
          );
        }

        console.log(
          `[createBatch] expectedDateCol=${expectedDateCol}, row.length=${newBatchRow.length}`,
        );

        if (
          expectedDateCol !== undefined &&
          expectedDateCol >= 0 &&
          expectedDateCol < newBatchRow.length
        ) {
          const formatted = formatDateForExcel(date);
          console.log(
            `[createBatch] formatDateForExcel("${date}") = "${formatted}"`,
          );
          newBatchRow[expectedDateCol] = formatted;
          console.log(
            `[createBatch] ? Set col ${expectedDateCol} to: ${formatted}`,
          );
        } else {
          console.log(`[createBatch] ? SKIPPED: expectedDateCol out of bounds`);
        }
      });
    }

    // Reset completion status and dates
    newBatchRow[114] = "FALSE"; // Completion status
    newBatchRow[115] = ""; // Completion date

    // Update quantity strings
    let activeProcessCols = [];
    for (let j = 0; j < 12; j++) {
      let baseIdx = START_COL + j * BLOCK_SIZE;
      let processName = String(newBatchRow[baseIdx] || "").trim();
      if (processName !== "" && processName !== "--") {
        activeProcessCols.push(baseIdx);
      }
    }

    const qtyStringZero = activeProcessCols
      .map((colIdx) => `${colIdx}:${0}`)
      .join("|");
    const qtyString = activeProcessCols
      .map((colIdx) => `${colIdx}:${quantity}`)
      .join("|");

    newBatchRow[119] = qtyStringZero;
    newBatchRow[120] = qtyString;

    // Set batch remark if provided (split origin remark)
    if (batchRemark) {
      newBatchRow[118] = batchRemark; // Column 118 is splitRemark
    } else {
      newBatchRow[118] = ""; // Clear batch remark if not provided
    }

    // Add the new batch row
    await addTableRow("BatchListing", newBatchRow);

    // Update JobListing remaining
    const ctx = await getSharePointFileContext();
    const normalizedSearchPsn = normalizePsn(psn);

    // Fetch all JobListing rows to find the matching PSN
    const jobRows = await getTableRowsAsObjects("JobListing");

    // Find the row index that matches the PSN
    let targetRowIndex = -1;
    for (let i = 0; i < jobRows.length; i++) {
      const rowPsn = normalizePsn(
        jobRows[i]["Product Serial Number"] || jobRows[i].PSN || "",
      );
      if (rowPsn === normalizedSearchPsn) {
        targetRowIndex = i;
        break;
      }
    }

    if (targetRowIndex !== -1) {
      // Get current remaining
      const currentRemaining = parseInt(
        jobRows[targetRowIndex]["Remaining"] ||
        jobRows[targetRowIndex].remaining ||
        0,
      );
      const newRemaining = Math.max(0, currentRemaining - quantity);

      // Update the remaining in JobListing
      const physicalRow = targetRowIndex + 2; // Excel rows start at 1, plus header row
      const remainingColIndex = 12; // 0-based, from jobRow structure
      const colLetter = indexToColumnLetter(remainingColIndex);
      const cellAddress = `${colLetter}${physicalRow}`;

      await axios.patch(
        `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='${cellAddress}')`,
        { values: [[newRemaining]] },
        { headers: ctx.headers },
      );

      console.log(
        `[API] Updated JobListing remaining for PSN ${psn}: ${currentRemaining} -> ${newRemaining}`,
      );
    }

    console.log(`[API] Successfully created new batch: ${newBatchId}`);
    res.json({
      success: true,
      createdBatchId: newBatchId,
      message: `Batch ${newBatchId} created successfully`,
    });
  } catch (error) {
    console.error("[API] POST /api/createBatch - error:", error);
    res.status(500).json({ error: "Failed to create batch" });
  }
});


// API route to create a brand new batch while increasing JobListing order qty + BTD
app.post("/api/createNewBatch", async (req, res) => {
  try {
    console.log("[API] POST /api/createNewBatch - request received");
    const { psn, quantity, processDates, batchRemark, actor } = req.body;
    const normalizedPsn = normalizePsn(psn);
    const newBatchQty = Number(quantity || 0);

    if (!normalizedPsn || !newBatchQty) {
      return res.status(400).json({ error: "PSN and quantity are required" });
    }

    const jobRows = await getTableRowsAsObjects("JobListing");
    const matchedJob = jobRows.find((row) => {
      const rowPsn = normalizePsn(
        row["Product Serial Number"] || row.PSN || "",
      );
      return rowPsn === normalizedPsn;
    });

    if (!matchedJob) {
      return res.status(404).json({ error: "Job not found for this PSN" });
    }

    const batches = await getTableRowsAsObjects("BatchListing");
    const psnBatches = batches.filter((b) => {
      const batchPsn = normalizePsn(
        b["Product Serial Number"] || b.PSN || "",
      );
      return batchPsn === normalizedPsn;
    });

    if (psnBatches.length === 0) {
      return res
        .status(404)
        .json({ error: "No existing batches found for this PSN" });
    }

    psnBatches.sort((a, b) => {
      const idA = String(a.BatchId || a["Batch ID"] || "")
        .split("-")
        .pop();
      const idB = String(b.BatchId || b["Batch ID"] || "")
        .split("-")
        .pop();
      return parseInt(idB, 10) - parseInt(idA, 10);
    });

    const latestBatch = psnBatches[0];
    const latestBatchId = String(
      latestBatch.BatchId || latestBatch["Batch ID"] || "",
    );
    const baseId = latestBatchId.split("-")[0];
    const nextIdNum = parseInt(latestBatchId.split("-").pop(), 10) + 1;
    const newBatchId = `${baseId}-${nextIdNum}`;

    // Build new batch row array from table headers to preserve column ordering
    const headers = await getTableHeaders("BatchListing");
    const newBatchRow = headers.map(h => (latestBatch && latestBatch.hasOwnProperty(h) ? latestBatch[h] : ""));
    newBatchRow[1] = newBatchId;
    newBatchRow[2] = toExcelDate(new Date());
    newBatchRow[4] = newBatchQty;

    const START_COL = 6;
    const BLOCK_SIZE = 9;

    for (let j = 0; j < 12; j++) {
      const baseIdx = START_COL + j * BLOCK_SIZE;
      const processName = String(newBatchRow[baseIdx] || "").trim();

      if (processName !== "" && processName !== "--") {
        newBatchRow[baseIdx + 1] = "";
        newBatchRow[baseIdx + 2] = "";
        newBatchRow[baseIdx + 3] = "";
        newBatchRow[baseIdx + 4] = "";
        newBatchRow[baseIdx + 5] = "FALSE";
        newBatchRow[baseIdx + 6] = "";
        newBatchRow[baseIdx + 7] = "";
        newBatchRow[baseIdx + 8] = false;
      }
    }

    if (processDates) {
      Object.entries(processDates).forEach(([processIndex, date]) => {
        const idx = parseInt(processIndex, 10);
        let expectedDateCol;

        if (!Number.isNaN(idx) && idx >= 0 && idx < 12) {
          expectedDateCol = START_COL + idx * BLOCK_SIZE + 1;
        } else if (
          !Number.isNaN(idx) &&
          idx >= START_COL &&
          (idx - START_COL) % BLOCK_SIZE === 0
        ) {
          expectedDateCol = idx + 1;
        }

        if (
          expectedDateCol !== undefined &&
          expectedDateCol >= 0 &&
          expectedDateCol < newBatchRow.length
        ) {
          newBatchRow[expectedDateCol] = formatDateForExcel(date);
        }
      });
    }

    newBatchRow[114] = "FALSE";
    newBatchRow[115] = "";

    const activeProcessCols = [];
    for (let j = 0; j < 12; j++) {
      const baseIdx = START_COL + j * BLOCK_SIZE;
      const processName = String(newBatchRow[baseIdx] || "").trim();
      if (processName !== "" && processName !== "--") {
        activeProcessCols.push(baseIdx);
      }
    }

    newBatchRow[119] = activeProcessCols
      .map((colIdx) => `${colIdx}:0`)
      .join("|");
    newBatchRow[120] = activeProcessCols
      .map((colIdx) => `${colIdx}:${newBatchQty}`)
      .join("|");
    newBatchRow[118] = batchRemark ? String(batchRemark) : "";

    await addTableRow("BatchListing", newBatchRow);

    const orderQtySync = await syncOrderQtyToJobListing(normalizedPsn, newBatchQty, {
      source: "createNewBatch",
      actor,
      logAudit: true,
    });

    if (!orderQtySync) {
      throw new Error("Failed to sync JobListing quantity and BTD");
    }

    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(actor),
      action: "CREATE",
      module: "BatchListing",
      identifier: newBatchId,
      changeSummary: `Created new batch ${newBatchId} for ${normalizedPsn} with additional qty ${newBatchQty}`,
      dataPayload: {
        event: "CREATE_NEW_BATCH",
        psn: normalizedPsn,
        batchId: newBatchId,
        quantity: newBatchQty,
        basedOnBatchId: latestBatchId,
        orderQtySync,
      },
    });

    console.log(`[API] Successfully created new batch: ${newBatchId}`);
    res.json({
      success: true,
      createdBatchId: newBatchId,
      message: `New batch ${newBatchId} created successfully`,
      orderQtySync,
    });
  } catch (error) {
    console.error("[API] POST /api/createNewBatch - error:", error);
    res.status(500).json({ error: "Failed to create new batch" });
  }
});



// API route to reduce batch quantity and update related fields accordingly
// OLD SHAREPOINT ROUTE: reduceBatchQty preserved for reference
// This route reduces the quantity of an existing batch and updates the related quantity maps
// Ensuring that the new quantity is less than the current quantity. It also logs the changes in the audit log.
app.post("/api/reduceBatchQty", async (req, res) => {
  try {
    const { row, newQty } = req.body;
    if (row === undefined || newQty === undefined) {
      return res.status(400).json({ error: "row and newQty are required" });
    }

    const rowIdx = parseInt(row, 10);
    const targetQty = Number(newQty);
    if (isNaN(rowIdx) || isNaN(targetQty) || targetQty < 0) {
      return res.status(400).json({ error: "Invalid row or newQty" });
    }

    const rowValues = await getBatchListingRow(rowIdx);
    const originalValues = [...rowValues];
    const currentQty = Number(rowValues[4] || 0);
    if (targetQty >= currentQty) {
      return res
        .status(400)
        .json({ error: "newQty must be smaller than current batch qty" });
    }

    const currentQtyMap = parseMapString(
      String(rowValues[119] || ""),
      currentQty,
    );
    const maxQtyMap = parseMapString(String(rowValues[120] || ""), currentQty);

    Object.keys(currentQtyMap).forEach((base) => {
      if (Number(currentQtyMap[base]) > targetQty) {
        currentQtyMap[base] = String(targetQty);
      }
    });

    Object.keys(maxQtyMap).forEach((base) => {
      if (Number(maxQtyMap[base]) > targetQty) {
        maxQtyMap[base] = String(targetQty);
      }
    });

    rowValues[4] = targetQty;
    rowValues[119] = serializeMap(currentQtyMap);
    rowValues[120] = serializeMap(maxQtyMap);

    await updateBatchListingRow(rowIdx, rowValues);

    // Audit log for qty reduction
    const _rBatchId = String(rowValues[1] || "").trim();
    const _rPsn = String(rowValues[0] || "").trim();
    const _rDiff = buildBatchAuditDiff(originalValues, rowValues);
    const _origQtyMap = parseMapString(String(originalValues[119] || ""), 0);
    const _affectedProcesses = Object.keys(currentQtyMap)
      .filter(
        (base) =>
          Number(_origQtyMap[base] || 0) !== Number(currentQtyMap[base] || 0),
      )
      .map((base) => {
        const name = String(rowValues[Number(base)] || "").trim();
        return name
          ? `${name}: ${_origQtyMap[base] || 0} ? ${currentQtyMap[base]}`
          : null;
      })
      .filter(Boolean);
    const _rSummary =
      `Batch qty ${currentQty} -> ${targetQty}` +
      (_affectedProcesses.length > 0
        ? `; ${_affectedProcesses.join(", ")}`
        : "");

    await addAuditLogEntryWithRetry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(req.body?.actor),
      action: "UPDATE",
      module: "BatchListing",
      identifier: _rBatchId || _rPsn,
      changeSummary: _rSummary,
      dataPayload: {
        source: "reduceBatchQty",
        rowIndex: rowIdx,
        psn: _rPsn,
        batchId: _rBatchId,
        changedFields: _rDiff.changedFields,
        old_data: { qty: currentQty },
        new_data: { qty: targetQty },
      },
    }, { retries: 3, baseDelayMs: 1200 });

    res.json({ success: true, message: "Original batch qty reduced" });
  } catch (error) {
    console.error("[API] POST /api/reduceBatchQty - error:", error);
    res.status(500).json({ error: "Failed to reduce batch qty" });
  }
});


// API route to create split batch based on an existing batch with specified quantity and process date adjustments
// OLD SHAREPOINT ROUTE: createSplitBatch preserved for reference
app.post("/api/createSplitBatch", async (req, res) => {
  try {
    console.log("[API] POST /api/createSplitBatch - request received");
    const {
      psn,
      quantity,
      processDates,
      splitQtyMap,
      batchRemark,
      actor,
      parentRow,
      parentBatchId,
      parentNewQty,
      isIncrease,
      trigger,
    } = req.body;

    if (!psn || !quantity) {
      return res.status(400).json({ error: "PSN and quantity are required" });
    }

    let parentRowValues = null;
    if (
      parentRow !== undefined &&
      parentRow !== null &&
      !isNaN(Number(parentRow))
    ) {
      parentRowValues = await getBatchListingRow(Number(parentRow));
    }

    // Fetch all batches
    const batches = await getTableRowsAsObjects("BatchListing");

    // Filter batches for this PSN
    const psnBatches = batches.filter(
      (b) => String(b["Product Serial Number"] || "").trim() === psn,
    );

    if (psnBatches.length === 0) {
      return res
        .status(404)
        .json({ error: "No existing batches found for this PSN" });
    }

    // Sort by batch ID descending to get the latest
    psnBatches.sort((a, b) => {
      const idA = String(a.BatchId || "")
        .split("-")
        .pop();
      const idB = String(b.BatchId || "")
        .split("-")
        .pop();
      console.log("A" + idA);
      console.log("B" + idB);
      return parseInt(idB) - parseInt(idA);
    });

    const latestBatch = psnBatches[0];
    const latestBatchId = String(latestBatch.BatchId || "");
    const baseId = latestBatchId.split("-")[0];
    const nextIdNum = parseInt(latestBatchId.split("-").pop()) + 1;
    const newBatchId = `${baseId}-${nextIdNum}`;

    // Create new batch row based on latest batch
    const { _rowIdx: _discarded, ...latestBatchData } = latestBatch;
    const newBatchRow = Object.values(latestBatchData);

    // Update batch-specific fields
    newBatchRow[1] = newBatchId; // Batch ID
    newBatchRow[2] = toExcelDate(new Date()); // Batch Date
    newBatchRow[4] = quantity; // Quantity

    // Reset all process steps to fresh state (no expected/start/end dates, no done status, no remarks)
    const START_COL = 6;
    const BLOCK_SIZE = 9;
    for (let j = 0; j < 12; j++) {
      const baseIdx = START_COL + j * BLOCK_SIZE;
      const processName = String(newBatchRow[baseIdx] || "").trim();

      if (processName !== "" && processName !== "--") {
        newBatchRow[baseIdx + 1] = ""; // Expected date
        newBatchRow[baseIdx + 2] = ""; // Start date
        newBatchRow[baseIdx + 3] = ""; // Duration
        newBatchRow[baseIdx + 4] = ""; // End date
        newBatchRow[baseIdx + 5] = "FALSE"; // Status
        newBatchRow[baseIdx + 6] = ""; // Remark (inProgress|delay)
        newBatchRow[baseIdx + 7] = ""; // Revert Remark
        newBatchRow[baseIdx + 8] = false; // Checkbox/flag
      }
    }

    if (processDates) {
      Object.entries(processDates).forEach(([processIndex, date]) => {
        const idx = parseInt(processIndex);
        console.log(`[createSplitBatch] Processing idx=${idx}, date="${date}"`);
        let expectedDateCol;

        // Check column index FIRST (patterns like 6, 15, 24, 33, 42, 51, 60, 69, 78, 87, 96, 105)
        if (
          !isNaN(idx) &&
          idx >= START_COL &&
          (idx - START_COL) % BLOCK_SIZE === 0
        ) {
          expectedDateCol = idx + 1;
          console.log(
            `[createSplitBatch] Matched column index branch: idx=${idx} ? expectedDateCol=${expectedDateCol}`,
          );
        } else if (!isNaN(idx) && idx >= 0 && idx < 12) {
          // Then check processIndex range (0-11)
          expectedDateCol = START_COL + idx * BLOCK_SIZE + 1;
          console.log(
            `[createSplitBatch] Matched processIndex branch: idx=${idx} ? expectedDateCol=${expectedDateCol}`,
          );
        }

        console.log(
          `[createSplitBatch] expectedDateCol=${expectedDateCol}, row.length=${newBatchRow.length}`,
        );

        if (
          expectedDateCol !== undefined &&
          expectedDateCol >= 0 &&
          expectedDateCol < newBatchRow.length
        ) {
          const formatted = formatDateForExcel(date);
          console.log(
            `[createSplitBatch] formatDateForExcel("${date}") = "${formatted}"`,
          );
          newBatchRow[expectedDateCol] = formatted;
          console.log(
            `[createSplitBatch] ? Set col ${expectedDateCol} to: ${formatted}`,
          );
        } else {
          console.log(
            `[createSplitBatch] ? SKIPPED: expectedDateCol out of bounds`,
          );
        }
      });
    }

    // Reset completion status and dates
    newBatchRow[114] = "FALSE"; // Completion status
    newBatchRow[115] = ""; // Completion date

    // Update quantity strings based on splitQtyMap
    let activeProcessCols = [];
    for (let j = 0; j < 12; j++) {
      let baseIdx = START_COL + j * BLOCK_SIZE;
      let processName = String(newBatchRow[baseIdx] || "").trim();
      if (processName !== "" && processName !== "--") {
        activeProcessCols.push(baseIdx);
      }
    }

    const qtyStringZero = activeProcessCols
      .map((colIdx) => `${colIdx}:${0}`)
      .join("|");
    const qtyString = activeProcessCols
      .map((colIdx) => {
        const splitQty = splitQtyMap ? Number(splitQtyMap[colIdx]) || 0 : 0;
        return `${colIdx}:${splitQty}`;
      })
      .join("|");
    const maxQtyString = activeProcessCols
      .map((colIdx) => `${colIdx}:${quantity}`)
      .join("|");

    newBatchRow[119] = qtyString; // Current qtys (split amounts)
    newBatchRow[120] = maxQtyString; // Max qtys (full split batch qty)

    // Set batch remark if provided (split origin remark)
    if (batchRemark) {
      newBatchRow[118] = batchRemark; // Column 118 is splitRemark
    } else {
      newBatchRow[118] = ""; // Clear batch remark if not provided
    }

    // Ensure row length matches the actual BatchListing table column count
    const batchListingColCount = await getTableColumnCount("BatchListing");
    if (newBatchRow.length < batchListingColCount) {
      const needed = batchListingColCount - newBatchRow.length;
      for (let p = 0; p < needed; p++) newBatchRow.push("");
    } else if (newBatchRow.length > batchListingColCount) {
      newBatchRow.splice(batchListingColCount);
    }
    if (newBatchRow.length !== batchListingColCount) {
      throw new Error(`[createSplitBatch] Row length mismatch: got ${newBatchRow.length}, expected ${batchListingColCount}`);
    }

    // Add the new batch row
    await addTableRow("BatchListing", newBatchRow);

    // updatePopupSplit: splitting an existing batch into two — no qty moves in or out
    // of JobListing, so skip ALL JobListing interactions entirely.
    let orderQtySync = null;
    if (trigger === "updatePopupSplit") {
      console.log(
        `[createSplitBatch] Skipping ALL JobListing interactions (updatePopupSplit — no net qty change)`,
      );
    } else {
      // Sync order qty changes to JobListing (columns F and N).
      // For edit-popup splits only skip when batch qty is being reduced.
      const isIncreaseBool = Boolean(isIncrease === true || isIncrease === "true");
      const shouldSyncOrderQty = isIncreaseBool || trigger !== "editPopupSplit";

      if (shouldSyncOrderQty) {
        console.log(
          `[createSplitBatch] Syncing order qty to JobListing: PSN=${psn}, quantity=${quantity}, trigger=${trigger}, isIncrease=${isIncrease}`,
        );
        orderQtySync = await syncOrderQtyToJobListing(psn, quantity, {
          actor,
          source: trigger || "createSplitBatch",
        });
      } else {
        console.log(
          `[createSplitBatch] Skipping JobListing sync (editPopupSplit subtract scenario)`,
        );
      }

      // Update JobListing remaining — only for actual batch deletes, never for splits.
      // editPopupSplit and any future split triggers must never touch this.
      const isSplitTrigger = trigger === "editPopupSplit" || trigger === "updatePopupSplit";
      if (!isSplitTrigger) {
        try {
          await syncBatchDeleteRemainingToJobListing(psn, quantity, actor);
          console.log(`[createSplitBatch] Remaining updated for PSN ${psn} (-${quantity})`);
        } catch (remainingErr) {
          console.warn(`[createSplitBatch] Could not update JobListing remaining for ${psn}:`, remainingErr.message);
        }
      } else {
        console.log(`[createSplitBatch] Skipping syncBatchDeleteRemainingToJobListing (split trigger: ${trigger} — no batch deleted)`);
      }
    }

    if (parentRowValues) {
      const splitMapNamed = mapBatchQtyByProcessName(
        parentRowValues,
        serializeMap(splitQtyMap || {}),
      );
      const _parentOldQty = Number(parentRowValues[4] || 0);
      const _parentNewQtyVal =
        parentNewQty !== undefined && parentNewQty !== null
          ? Number(parentNewQty)
          : _parentOldQty;
      const _splitChangedFields = [
        {
          field: "Batch Quantity",
          oldValue: "(none)",
          newValue: Number(quantity),
          display: `Batch Quantity: (none) -> ${quantity}`,
        },
        {
          field: "Split From",
          oldValue: parentBatchId || String(parentRowValues[1] || ""),
          newValue: "(origin)",
          display: `Split from: ${parentBatchId || String(parentRowValues[1] || "")}`,
        },
      ];
      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(actor),
        action: "SPLIT",
        module: "BatchListing",
        identifier: parentBatchId || String(parentRowValues[1] || ""),
        changeSummary: `Split batch into ${newBatchId || String(newBatchRow[1] || "")}: ${Number(quantity).toLocaleString()} units`,
        dataPayload: {
          source: trigger || "createSplitBatch",
          psn,
          parentBatchId: parentBatchId || String(parentRowValues[1] || ""),
          childBatchId: newBatchId,
          changedFields: _splitChangedFields,
          old_data: {
            parentQty: _parentOldQty,
            processSequence: getBatchProcessList(parentRowValues).map(
              (item) => item.name,
            ),
            splitQtyMap: splitMapNamed,
          },
          new_data: {
            parentQty: _parentNewQtyVal,
            childQty: Number(quantity || 0),
            childQtyMap: splitMapNamed,
            jobListingSync: orderQtySync?.newValues || null,
          },
        },
      }, { retries: 3, baseDelayMs: 1200 });
    }

    console.log(`[API] Successfully created split batch: ${newBatchId}`);
    res.json({
      success: true,
      message: `Split batch ${newBatchId} created successfully`,
      newBatchId,
    });
  } catch (error) {
    console.error("[API] POST /api/createSplitBatch - error:", error);
    res.status(500).json({ error: "Failed to create split batch" });
  }
});


// ============ HELPER FUNCTIONS FOR BATCH UPDATES ============
/**
 * Normalize PSN: trim, lowercase, remove trailing '.0'
 */
function normalizePsn(value) {
  let str = String(value || "")
    .trim()
    .toLowerCase();
  // Remove trailing .0 (common in Excel number conversions)
  str = str.replace(/\.0$/, "");
  return str;
}

/**
 * Fetch a specific row from BatchListing by row number
 * Uses the table rows API to get the row at the specified index
 */
async function getBatchListingRow(tableRowIndex) {
  const ctx = await getSharePointFileContext();
  const res = await axios.get(
    `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('BatchListing')/rows/itemAt(index=${tableRowIndex})`,
    { headers: ctx.headers }
  );
  return res.data.values?.[0] || [];
}

/**
 * Convert column index (0-based) to Excel column letter
 * 0=A, 1=B, ..., 25=Z, 26=AA, 27=AB, etc.
 */
function indexToColumnLetter(index) {
  let letter = "";
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// Inside your saveMultiBatchUpdate or helper function:
async function updateBatchListingCell(tableRowIndex, colIndex, value) {
  const ctx = await getSharePointFileContext();
  const colLetter = indexToColumnLetter(colIndex);
  const physicalRow = parseInt(tableRowIndex) + 4;

  const cellAddress = `${colLetter}${physicalRow}`;
  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('BatchListing')/range(address='${cellAddress}')`;
  console.log(
    `[Patch] Targeting ${cellAddress} for Table Index ${tableRowIndex}`,
  );
  let formattedValue = value;
  if (value === true) formattedValue = "TRUE";
  if (value === false) formattedValue = "FALSE";

  await axios.patch(
    url,
    {
      values: [[formattedValue]],
    },
    { headers: ctx.headers },
  );
}

/**
 * Updates an entire row in the BatchListing table in one API call.
 * @param {number} tableRowIndex - 0-based index of the row in the table
 * @param {Array} fullRowValues - The complete array of values for that row (all columns)
 */
async function updateBatchListingRow(tableRowIndex, fullRowValues) {
  const ctx = await getSharePointFileContext();
  const physicalRow = parseInt(tableRowIndex) + 4; // Your existing offset logic

  // We target the range from Column A (0) to the end of your data (e.g., Column ZZ or DP)
  const lastColLetter = indexToColumnLetter(fullRowValues.length - 1);
  const rangeAddress = `A${physicalRow}:${lastColLetter}${physicalRow}`;

  const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('BatchListing')/range(address='${rangeAddress}')`;

  // Ensure booleans are strings if your Excel logic requires "TRUE"/"FALSE"
  const ddmmDatePattern = /^\d{2}\/\d{2}\/\d{2,4}$/;

  const formattedValues = fullRowValues.map((val) => {
    if (val === true) return "TRUE";
    if (val === false) return "FALSE";
    if (val === null || val === undefined) return "";
    // Force DD/MM/YY or DD/MM/YYYY strings as text so Excel doesn't reinterpret them
    if (typeof val === "string") {
      const clean = val.startsWith("'") ? val.slice(1) : val;
      if (ddmmDatePattern.test(clean)) return `'${clean}`;
    }
    return val;
  });

  await axios.patch(
    url,
    { values: [formattedValues] },
    { headers: ctx.headers },
  );
  console.log(`[Row Update] Successfully patched Row ${physicalRow}`);
}

// Retrieves all rows from a specified table and returns them as an array of arrays (raw values)
async function getTableRows(tableName) {
  const ctx = await getSharePointFileContext();
  return getAllTableRows(tableName, ctx);
}

// Deletes a row from a specified table based on the row's index (0-based)
async function deleteTableRowById(tableName, rowId) {
  const ctx = await getSharePointFileContext();
  const rows = await getAllTableRows(tableName, ctx);
  const rowPosition = rows.findIndex((r) => String(r.index) === String(rowId));

  if (rowPosition < 0) {
    throw new Error(
      `Cannot delete ${tableName} row. Row id ${rowId} not found.`,
    );
  }

  const actionUrl = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('${tableName}')/rows/itemAt(index=${rowPosition})`;

  try {
    await axios.delete(actionUrl, { headers: ctx.headers });
  } catch (error) {
    // Fallback for tenants that support direct index DELETE.
    const fallbackUrl = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('${tableName}')/rows/${rowPosition}`;
    await axios.delete(fallbackUrl, { headers: ctx.headers });
  }
}

/**
 * Update JobListing delivery date by PSN match
 */
// This function updates both the display column (H) and the Excel-safe column (L) for the delivery date.
async function updateJobListingDeliveryDateByPsn(
  psn,
  deliveryDate,
  actor = null,
) {
  const ctx = await getSharePointFileContext();
  const normalizedSearchPsn = normalizePsn(psn);

  try {
    const rowsRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('JobListing')/rows`,
      { headers: ctx.headers },
    );
    const rows = rowsRes.data.value || [];

    // Fetch as objects to capture all old values
    const jobRows = await getTableRowsAsObjects("JobListing");
    let targetRowIndex = -1;
    let oldRowObject = null;

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].values?.[0] || [];
      const rowPsn = normalizePsn(values[0]);

      if (rowPsn === normalizedSearchPsn) {
        targetRowIndex = i;
        // Find corresponding object row
        oldRowObject = jobRows[i] || {};
        break;
      }
    }

    if (targetRowIndex === -1) {
      console.warn(
        `[updateJobListingDeliveryDateByPsn] PSN ${psn} not found in JobListing.`,
      );
      return false;
    }

    const excelRowNumber = targetRowIndex + 2;

    // --- PREPARE DIFFERENT FORMATS ---
    // Column H gets the display format (dd/mm/yyyy)
    const formatH = formatDateForExcel(deliveryDate);
    // Column L gets the Excel-safe text format ('yyyy-MM-dd)
    const formatL = toExcelDateText(deliveryDate);

    // --- UPDATE COLUMN H ---
    const endpointH = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='H${excelRowNumber}')`;
    await axios.patch(
      endpointH,
      { values: [[formatH]] },
      { headers: ctx.headers },
    );

    // --- UPDATE COLUMN L ---
    const endpointL = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='L${excelRowNumber}')`;
    await axios.patch(
      endpointL,
      { values: [[formatL]] },
      { headers: ctx.headers },
    );

    // --- UPDATE COLUMN R (delivery date edited flag) ---
    const endpointR = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='R${excelRowNumber}')`;
    await axios.patch(
      endpointR,
      { values: [[true]] },
      { headers: ctx.headers },
    );

    console.log(
      `[Success] PSN ${psn}: H updated to ${formatH}, L updated to ${formatL}, R flagged as edited`,
    );

    // --- AUDIT LOGGING ---
    // Get headers to map old row values
    const headers = await getTableHeaders("JobListing");
    const oldRowArray = headers.map((header) => oldRowObject[header] || "");

    // Create new row array with updated delivery date
    const newRowArray = [...oldRowArray];
    const deliveryDateColIndex = headers.findIndex(
      (h) =>
        String(h).toLowerCase().includes("delivery") &&
        String(h).toLowerCase().includes("date"),
    );
    const deliveryFormatColIndex = headers.findIndex(
      (h) => String(h).toLowerCase() === "delivery format",
    );

    if (deliveryDateColIndex >= 0) {
      newRowArray[deliveryDateColIndex] = formatH;
    }
    if (deliveryFormatColIndex >= 0) {
      newRowArray[deliveryFormatColIndex] = formatL;
    }

    const auditDiff = buildJobListingAuditDiff(oldRowArray, newRowArray);
    if (auditDiff.changedFields.length > 0) {
      const _oldDateDisplay = formatBatchAuditValue(
        oldRowArray[deliveryDateColIndex] || "",
      );
      const _newDateDisplay = formatBatchAuditValue(formatH);
      await addAuditLogEntry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(actor),
        action: "UPDATE",
        module: "JobListing",
        identifier: psn,
        changeSummary: `Delivery Date: ${_oldDateDisplay} -> ${_newDateDisplay}`,
        dataPayload: {
          source: "updateJobListingDeliveryDateByPsn",
          psn,
          changedFields: auditDiff.changedFields,
          old_data: {
            deliveryDate: oldRowArray[deliveryDateColIndex] || "",
            deliveryFormat: oldRowArray[deliveryFormatColIndex] || "",
          },
          new_data: {
            deliveryDate: formatH,
            deliveryFormat: formatL,
          },
        },
      });
    }

    return true;
  } catch (error) {
    console.error(`[Error] Update failed:`, error.message);
    throw error;
  }
}

/**
 * Generate a new Batch ID based on existing suffixes
 * Example: If J101-1 exists, returns J101-2
 */
async function generateNewBatchId(currentBatchId, localNewIds = []) {
  const rows = await getTableRowsAsObjects("BatchListing");
  const baseId = String(currentBatchId).split("-")[0];

  // Collect all used suffixes for this base
  const usedSuffixes = new Set();

  rows.forEach((row) => {
    const bId = String(row.BatchId || row.batchId || "");
    if (bId.startsWith(baseId + "-")) {
      const suffix = parseInt(bId.split("-").pop());
      if (!isNaN(suffix)) usedSuffixes.add(suffix);
    }
  });

  localNewIds.forEach((bId) => {
    if (bId.startsWith(baseId + "-")) {
      const suffix = parseInt(bId.split("-").pop());
      if (!isNaN(suffix)) usedSuffixes.add(suffix);
    }
  });

  // Find the lowest available suffix >= 2
  // (suffix 1 is the original batch, start from 2 for splits)
  let candidate = 2;
  while (usedSuffixes.has(candidate)) candidate++;

  return `${baseId}-${candidate}`;
}

/**
 * Main function: saveMultiBatchUpdate
 * Orchestrates batch updates with waterfall logic and splits
 */
function excelToJSDate(serial) {
  if (!serial || isNaN(serial)) return null;
  // If it's already a string date, just return it as a Date object
  if (typeof serial === "string" && serial.includes("-"))
    return new Date(serial);

  // Excel base date is Dec 30, 1899
  const excelEpoch = new Date(1899, 11, 30);
  const jsDate = new Date(excelEpoch.getTime() + serial * 86400000);
  return jsDate;
}
// Parses a value that can be an Excel serial date, a date string, or null/empty 
// Returns a Date object with time set to 00:00:00 UTC.
function parseDateOnly(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && !Number.isNaN(value)) {
    const date = excelToJSDate(value);
    return date
      ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
      : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) {
    const [day, month, yearPart] = text.split("/").map(Number);
    const year = yearPart < 100 ? 2000 + yearPart : yearPart;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }

  return null;
}

// SAVE FUNCTION FOR MULITPLE BATCH PROCESS wth SAVE JOB DELIVERY DATE
// This function is designed to handle complex updates to a batch row, including multiple process updates, 
// Waterfall logic for dates and statuses, and syncing delivery info to JobListing.
async function saveMultiBatchUpdate(payload, actor = null) {
  const rowIdx = parseInt(payload.row);
  const START_COL = 6;
  const BLOCK_SIZE = 9;

  const COL_COMPLETED_DATE = 115;
  const COL_COMPLETION_STATUS = 114;
  try {
    // 1. Fetch current row
    let runningRowData = await getBatchListingRow(rowIdx);
    const originalRow = [...runningRowData];
    const psn = String(runningRowData[0] || "").trim();
    const batchId = String(runningRowData[1] || "").trim();
    const todayISO = new Date().toISOString().split("T")[0];

    let currentBatchTotalQty = Number(runningRowData[4] || 0);
    let currentBatchQty = Number(runningRowData[4] || 0);

    // Parse Maps
    let qtyMap = {};
    let maxQtyMap = {};

    let newBatchIdCreated = null;

    const parseToMap = (str, target) => {
      if (str && str !== "0") {
        str.split("|").forEach((p) => {
          const pts = p.split(":");
          if (pts.length === 2) target[pts[0]] = pts[1];
        });
      }
    };
    parseToMap(String(runningRowData[119] || ""), qtyMap);
    parseToMap(String(runningRowData[120] || ""), maxQtyMap);

    const updates = (payload.updates || []).sort(
      (a, b) => a.baseCol - b.baseCol,
    );

    // Guard: saveMultiBatchUpdate must never trigger a split.
    // A split intent is only when a step is marked done with a qty strictly outside
    // the acceptable margin range. Within-margin done qtys are allowed.
    const parseMarginPct = (str) => {
      const s = String(str || '0').trim();
      const hasPercentSign = s.includes('%');
      const n = parseFloat(s.replace('%', '').trim());
      if (!Number.isFinite(n)) return 0;
      // Excel stores percentage cells as decimals (e.g. 10% → 0.1, 3% → 0.03).
      // If there's no % sign and the value is between 0 and 1 exclusive, treat as decimal fraction.
      if (!hasPercentSign && n > 0 && n < 1) return n * 100;
      return n;
    };
    const batchMarginPct = parseMarginPct(runningRowData[16]); // Col Q = index 16 (0-based) of BatchListing — but margin comes from JobListing below
    // Fetch margin from JobListing by PSN
    let jobMarginPct = 0;
    try {
      const jobRows = await getTableRowsAsObjects("JobListing");
      const matchedJob = jobRows.find(r => String(r["Product Serial Number"] || r.PSN || "").trim() === psn);
      if (matchedJob) jobMarginPct = parseMarginPct(matchedJob["Production Margin Waste"] || "0%");
    } catch (_e) { /* non-fatal */ }

    const isWithinMarginBE = (qty, batchQty, pct) => {
      if (pct <= 0) return qty === batchQty;
      return qty >= Math.floor(batchQty * (1 - pct / 100)) && qty <= Math.ceil(batchQty * (1 + pct / 100));
    };

    const hasSplitIntent = updates.some(
      (u) => u.isDone && !isWithinMarginBE(Number(u.qty), currentBatchQty, jobMarginPct)
    );
    if (hasSplitIntent) {
      throw new Error(
        "saveMultiBatchUpdate does not handle batch splits. Use the Split Batch button which calls adminChangeBatchQty."
      );
    }

    for (const u of updates) {
      const base = u.baseCol;
      const stepMax = Number(maxQtyMap[base] || currentBatchQty);
      const currentProcessName = String(runningRowData[base] || "").trim();
      const currentStepMax = Number(maxQtyMap[base] || currentBatchTotalQty);
      const isDeliveryStep = currentProcessName
        .toLowerCase()
        .includes("delivery");
      // isSplitting has been removed — splits are handled exclusively by the
      // Split Batch button (adminChangeBatchQty). saveMultiBatchUpdate only saves
      // progress; it never creates a child batch.

      // Update memory array instead of API
      // For delivery steps with qty, status is set per-branch to preserve "Partially Delivered".
      // For non-delivery steps (or delivery with no qty), apply the delay/clear status here.
      if (!isDeliveryStep || !u.qty) {
        runningRowData[base + 5] = u.isDelayed ? "Delayed" : "";
      }
      const inProgPart = u.inProgressRemark || "";
      const delayPart = u.isDelayed ? u.remark || "" : "";
      runningRowData[base + 6] = `${inProgPart}|${delayPart}`;
      if (u.detail) runningRowData[base + 4] = u.detail;

      if (u.isDone) {
        // Duration Logic
        let prevDateRaw = null;
        for (let pb = base - BLOCK_SIZE; pb >= START_COL; pb -= BLOCK_SIZE) {
          if (runningRowData[pb + 2]) {
            prevDateRaw = runningRowData[pb + 2];
            break;
          }
        }

        if (!prevDateRaw) prevDateRaw = runningRowData[2];

        const startDate = parseDateOnly(prevDateRaw) || parseDateOnly(todayISO);
        const finishDate = parseDateOnly(u.finishDate || todayISO) || parseDateOnly(todayISO);
        const rawDiff = (finishDate.getTime() - startDate.getTime()) / 86400000;
        const diffDays = Number.isFinite(rawDiff) ? Math.ceil(rawDiff) : "";

        runningRowData[base + 2] = u.finishDate || todayISO;
        runningRowData[base + 3] = diffDays;
        runningRowData[base + 8] = true;

        // DELIVERY SYNC
        if (isDeliveryStep) {
          // 1. Mark BatchListing row as completed
          runningRowData[COL_COMPLETION_STATUS] = true;
          runningRowData[COL_COMPLETED_DATE] = todayISO;

          // 2. Calculate net qty to sync to JobListing.
          // previouslySaved = what was already synced via a prior partial delivery save for this step.
          // When marking done, sync the delta (u.qty minus what was already synced).
          // u.qty is proposedTotal = backendQty + userTyped from frontend.
          // backendQty already equals previouslySaved in most cases, so the delta
          // captures only the newly added amount in this save.
          const previouslySaved = Number(qtyMap[base] || 0);
          const submittedQty = Number(u.qty || 0);
          const addNowQty = submittedQty - previouslySaved;
          const syncQty = Math.max(0, addNowQty);
          console.log(
            `[saveMultiBatchUpdate] Delivery mark-done sync trigger: batchId=${batchId}, psn=${psn}, process="${currentProcessName}", base=${base}, submittedQty=${submittedQty}, previouslySaved=${previouslySaved}, delta=${addNowQty}, syncQty=${syncQty}`,
          );
          if (addNowQty < 0) {
            console.warn(
              `[saveMultiBatchUpdate] Delivery mark-done delta is negative for batchId=${batchId}, psn=${psn}, base=${base}. Sync will verify JobListing with 0 added qty instead of reversing totals.`,
            );
          }
          await syncDeliveryToJobListing(psn, syncQty, {
            actor,
            source: "saveMultiBatchUpdate_markDone",
            batchId,
            processName: currentProcessName,
            baseCol: base,
            submittedQty,
            previouslySaved,
            requestedDelta: addNowQty,
          });

          // 3. Existing Delivery Date Sync
          const targetDate = payload.deliveryDate || payload.newDeliveryDate;
          if (targetDate && targetDate !== "KEEP_ORIGINAL") {
            await updateJobListingDeliveryDateByPsn(psn, targetDate, actor);
          }

          // 4. Check if this is the last completed batch, and if so, set job-level delivery status
          // This block runs AFTER the delivery date edit above, so column R is already updated if date was changed.
          try {
            const allBatchRows = await getTableRowsAsObjects("BatchListing");
            const normalizedPsn = normalizePsn(psn);

            // Get all batches for this PSN
            const psnBatches = allBatchRows.filter((b) => {
              return normalizePsn(b["Product Serial Number"] || b.PSN || "") === normalizedPsn;
            });

            const currentBatchId = String(batchId || "").trim();

            // Exclude the current batch by row index (unambiguous) with Batch ID as fallback
            const otherBatches = psnBatches.filter((b) => {
              if (b._rowIdx === rowIdx) return false; // same physical row — this is the current batch
              const batchBatchId = String(b["Batch ID"] || b.BatchID || b.batch_id || "").trim();
              if (batchBatchId === currentBatchId) return false; // same Batch ID — also current batch
              return true;
            });

            // Only block if other batches exist AND any of them are incomplete
            const hasIncompleteBatch = otherBatches.length > 0 && otherBatches.some((b) => {
              const completionStatus = b["Completion Status"] ?? b.CompletionStatus ?? b.completion_status ?? null;
              return !(completionStatus === true || String(completionStatus).toUpperCase() === "TRUE");
            });

            console.log(`[saveMultiBatchUpdate] PSN ${psn}: totalBatches=${psnBatches.length}, otherBatches=${otherBatches.length}, rowIdx=${rowIdx}, currentBatchId="${currentBatchId}", hasIncompleteBatch=${hasIncompleteBatch}`);

            if (hasIncompleteBatch) {
              console.log(`[saveMultiBatchUpdate] PSN ${psn}: skipping job delivery status — incomplete batches still exist.`);
            } else {
              // All batches are completed — now check remaining qty in JobListing
              const jobRows = await getTableRowsAsObjects("JobListing");
              const matchedJob = jobRows.find((row) => {
                return normalizePsn(row["Product Serial Number"] || row.PSN || "") === normalizedPsn;
              });

              if (!matchedJob) {
                console.warn(`[saveMultiBatchUpdate] PSN ${psn}: job not found in JobListing for delivery status check.`);
              } else {
                const remainingQty = Number(matchedJob["Remaining"] || matchedJob.remaining || 0);

                if (remainingQty > 0) {
                  console.log(`[saveMultiBatchUpdate] PSN ${psn}: skipping job delivery status — remaining qty is ${remainingQty}.`);
                } else {
                  // All batches done and no remaining qty — determine final delivery status
                  // Read column H (expected delivery date, index 7) and column R (delivery edited flag, index 17)
                  const jobListingHeaders = await getTableHeaders("JobListing");
                  const jobRowArray = jobListingHeaders.map((h) => matchedJob[h] ?? "");

                  const expectedDeliveryRaw = jobRowArray[7]; // Column H
                  const deliveryEditedRaw = jobRowArray[17];  // Column R
                  const completionDateISO = todayISO;         // Current batch's completion date

                  const expectedDeliveryDate = parseDateOnly(expectedDeliveryRaw);
                  const completionDate = parseDateOnly(completionDateISO);
                  const isDeliveryEdited = deliveryEditedRaw === true || String(deliveryEditedRaw).toUpperCase() === "TRUE";

                  let newJobStatus;
                  if (expectedDeliveryDate && completionDate && completionDate > expectedDeliveryDate) {
                    newJobStatus = "Delivery/Delay";
                  } else if (isDeliveryEdited) {
                    newJobStatus = "Delivery/Edited";
                  } else {
                    newJobStatus = "Delivery/Completed";
                  }

                  console.log(`[saveMultiBatchUpdate] PSN ${psn}: setting job status to "${newJobStatus}" (edited=${isDeliveryEdited}, late=${!!(expectedDeliveryDate && completionDate && completionDate > expectedDeliveryDate)})`);

                  // Patch column K (Status, index 10) in JobListing
                  const ctx = await getSharePointFileContext();
                  const jobRowsRaw = await axios.get(
                    `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('JobListing')/rows`,
                    { headers: ctx.headers },
                  );
                  const rawRows = jobRowsRaw.data.value || [];
                  let jobRowIndex = -1;
                  for (let i = 0; i < rawRows.length; i++) {
                    const rowPsn = normalizePsn(String(rawRows[i].values?.[0]?.[0] || ""));
                    if (rowPsn === normalizedPsn) {
                      jobRowIndex = i;
                      break;
                    }
                  }

                  if (jobRowIndex !== -1) {
                    const excelRow = jobRowIndex + 2;
                    const statusEndpoint = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='K${excelRow}')`;
                    await axios.patch(
                      statusEndpoint,
                      { values: [[newJobStatus]] },
                      { headers: ctx.headers },
                    );
                    console.log(`[saveMultiBatchUpdate] PSN ${psn}: JobListing K${excelRow} updated to "${newJobStatus}"`);

                    await addAuditLogEntry({
                      timestamp: new Date().toISOString(),
                      account: resolveAuditAccount(actor),
                      action: "UPDATE",
                      module: "JobListing",
                      identifier: psn,
                      changeSummary: `Job delivery status set to "${newJobStatus}" upon last batch completion`,
                      dataPayload: {
                        source: "saveMultiBatchUpdate_deliveryStatus",
                        psn,
                        newStatus: newJobStatus,
                        isDeliveryEdited,
                        expectedDelivery: expectedDeliveryRaw,
                        completionDate: completionDateISO,
                      },
                    });
                  } else {
                    console.warn(`[saveMultiBatchUpdate] PSN ${psn}: could not find row index for K-column patch.`);
                  }
                }
              }
            }
          } catch (deliveryStatusErr) {
            console.error(`[saveMultiBatchUpdate] PSN ${psn}: delivery status update failed:`, deliveryStatusErr.message);
            // Non-fatal — don't throw, let the main save succeed
          }
        }

        qtyMap[base] = u.qty;

        // Split logic removed — splits are handled by adminChangeBatchQty only.
      } else if (u.isDelayed) {
        // --- DELAY / INPROG+DELAY LOGIC ---
        runningRowData[base + 5] = "Delayed";
        const inProgPart2 = u.inProgressRemark || "";
        const delayPart2 = u.remark || "";
        runningRowData[base + 6] = `${inProgPart2}|${delayPart2}`;
        runningRowData[base + 8] = false;

        if (u.qty > 0 && isDeliveryStep) {
          runningRowData[base + 5] = "Partially Delivered";
          const previouslySaved = Number(qtyMap[base] || 0);
          const addNowQty = Number(u.qty || 0) - previouslySaved;
          if (addNowQty > 0) {
            console.log(
              `[saveMultiBatchUpdate] Delivery delayed+qty sync trigger: batchId=${batchId}, psn=${psn}, process="${currentProcessName}", base=${base}, submittedQty=${u.qty}, previouslySaved=${previouslySaved}, delta=${addNowQty}`,
            );
            await syncDeliveryToJobListing(psn, addNowQty, {
              actor,
              source: "saveMultiBatchUpdate_delayedDelivery",
              batchId,
              processName: currentProcessName,
              baseCol: base,
              submittedQty: Number(u.qty || 0),
              previouslySaved,
              requestedDelta: addNowQty,
            });
          }
        }

        qtyMap[base] = u.qty;
      } else {
        // --- QTY PROGRESS UPDATE ONLY (not done, not delayed) ---
        // User typed a partial qty — persist it to the qty map so it's saved.
        if (u.qty > 0) {
          // Delivery step with partial qty → mark as Partially Delivered and sync to JobListing.
          if (isDeliveryStep) {
            runningRowData[base + 5] = "Partially Delivered";

            // Sync only the new increment, not the full cumulative qty.
            // Calculate previouslySaved BEFORE updating qtyMap[base]
            console.log("Triggered delivery step");
            const previouslySaved = Number(qtyMap[base] || 0);
            const addNowQty = Number(u.qty || 0) - previouslySaved;
            if (addNowQty > 0) {
              await syncDeliveryToJobListing(psn, addNowQty, {
                actor,
                source: "saveMultiBatchUpdate_partialDelivery",
                batchId,
                processName: currentProcessName,
                baseCol: base,
                submittedQty: Number(u.qty || 0),
                previouslySaved,
                requestedDelta: addNowQty,
              });
            }
          }

          qtyMap[base] = u.qty;
        }
      }
      if (u.detail) runningRowData[base + 4] = u.detail;
    }

    // Finalize maps and save
    const fmt = (m) =>
      Object.keys(m)
        .sort((a, b) => a - b)
        .map((k) => `${k}:${m[k]}`)
        .join("|");
    runningRowData[4] = currentBatchQty; // batch qty column unchanged (row 4 = original batch qty)
    runningRowData[119] = fmt(qtyMap);   // qtyMap already holds user-typed qty via qtyMap[base] = u.qty
    runningRowData[120] = fmt(maxQtyMap);

    // 2. ONE SINGLE API CALL TO SAVE EVERYTHING
    await updateBatchListingRow(rowIdx, runningRowData);

    const auditDiff = buildBatchAuditDiff(originalRow, runningRowData);
    if (auditDiff.changedFields.length > 0) {
      const _doneU = updates.filter((u) => u.isDone);
      const _delayOnlyU = updates.filter(
        (u) => !u.isDone && u.isDelayed && !u.inProgressRemark,
      );
      const _inProgDelayU = updates.filter(
        (u) => !u.isDone && u.isDelayed && u.inProgressRemark,
      );
      const _inProgOnlyU = updates.filter(
        (u) => !u.isDone && !u.isDelayed && u.inProgressRemark,
      );
      const _smParts = [];
      if (_doneU.length > 0)
        _smParts.push(
          _doneU
            .map(
              (u) =>
                `${String(originalRow[u.baseCol] || "").trim()} done -> ${Number(u.qty).toLocaleString()} units${u.isDelayed ? " (delayed)" : ""}${u.finishDate ? ` (finish: ${u.finishDate})` : ""}`,
            )
            .join("; "),
        );
      if (_delayOnlyU.length > 0)
        _smParts.push(
          _delayOnlyU
            .map(
              (u) =>
                `${String(originalRow[u.baseCol] || "").trim()} marked delayed`,
            )
            .join("; "),
        );
      if (_inProgDelayU.length > 0)
        _smParts.push(
          _inProgDelayU
            .map(
              (u) =>
                `${String(originalRow[u.baseCol] || "").trim()} in-progress remark added & marked delayed`,
            )
            .join("; "),
        );
      else if (_inProgOnlyU.length > 0)
        _smParts.push(
          _inProgOnlyU
            .map(
              (u) =>
                `${String(originalRow[u.baseCol] || "").trim()} in-progress remark added`,
            )
            .join("; "),
        );
      const smartSummary =
        _smParts.length > 0 ? _smParts.join("; ") : auditDiff.summary;

      await addAuditLogEntryWithRetry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(actor),
        action: "UPDATE",
        module: "BatchListing",
        identifier: batchId || psn || String(rowIdx),
        changeSummary: smartSummary,
        dataPayload: {
          source: "saveMultiBatchUpdate",
          rowIndex: Number(rowIdx),
          psn,
          batchId,
          changedFields: auditDiff.changedFields,
          updates: payload.updates || [],
          splitRemark: payload.splitRemark || "",
          newBatchId: newBatchIdCreated,
        },
      }, { retries: 3, baseDelayMs: 1200 });
    }
    await sleep(4000);
    return { success: true, newBatchId: newBatchIdCreated || null };
  } catch (error) {
    console.error("[saveMultiBatchUpdate] Failed:", error.message);
    throw error;
  }
}

/**
 * Create a split batch from waterfall
 */
// This function creates a new batch with the remaining quantity and resets future processes based on the split point.
async function createSplitBatchFromWaterfall(
  parentData,
  diffQty,
  splitAtBase,
  userRemark,
) {
  const START_COL = 6;
  const BLOCK_SIZE = 9;

  let newRow = [...parentData];
  const parentBatchId = String(parentData[1] || "Unknown");
  const newId = await generateNewBatchId(String(parentData[1]), []);

  newRow[1] = newId;
  newRow[2] = new Date().toISOString().split("T")[0];
  newRow[4] = diffQty; // Child Batch starts with the remaining total
  // Appends the original batch ID to the end of the user's remark
  const originTag = ` (From: ${parentBatchId})`;
  newRow[118] = userRemark ? `${userRemark}${originTag}` : `Split${originTag}`;

  let childQtyMap = {};
  let childMaxMap = {};

  for (let i = 0; i < 12; i++) {
    let base = START_COL + i * BLOCK_SIZE;
    if (String(parentData[base] || "").trim() !== "") {
      // Logic: Future processes (from split point onwards) start at 0
      // but are allowed to go up to diffQty.
      if (base >= splitAtBase) {
        childQtyMap[base] = 0;
        childMaxMap[base] = diffQty;

        // Reset process markers for the child
        newRow[base + 2] = ""; // End Date
        newRow[base + 3] = ""; // Duration
        newRow[base + 8] = false; // Checkbox
        if (newRow[base + 5] === "Completed") newRow[base + 5] = "";
      } else {
        // Processes already finished by parent carry over their full qty to the child
        childQtyMap[base] = diffQty;
        childMaxMap[base] = diffQty;
      }
    }
  }

  const fmt = (m) =>
    Object.keys(m)
      .sort((a, b) => a - b)
      .map((k) => `${k}:${m[k]}`)
      .join("|");
  newRow[119] = fmt(childQtyMap);
  newRow[120] = fmt(childMaxMap);
  newRow[114] = "";
  newRow[115] = "";

  await addTableRow("BatchListing", newRow);
  return { success: true, newBatchId: newId };
}

/**
 * Revert a process step
 */
// This function reverts the specified step and all subsequent steps,
// with special handling for delivery steps to sync back to JobListing.
async function revertProcessStep(rowIdx, baseCol, revertRemark, actor = null) {
  try {
    if (!revertRemark || revertRemark.trim() === "")
      throw new Error("Revert remark is mandatory.");

    let rowValues = await getBatchListingRow(rowIdx);
    const originalRow = [...rowValues];
    const psn = String(rowValues[0] || "").trim(); // Get PSN for JobListing sync
    const batchQty = Number(rowValues[4] || 0);

    let currentQtyMap = parseMapString(rowValues[119], batchQty);

    const manualRevertedSteps = [];
    const autoRevertedSteps = [];

    for (let i = 0; i < 12; i++) {
      let currentStepBase = 6 + i * 9;

      if (currentStepBase >= baseCol) {
        const pName = String(rowValues[currentStepBase] || "").trim();
        if (!pName || pName === "" || pName === "--") continue;

        const isDelivery = pName.toLowerCase().includes("delivery");
        const wasDone =
          rowValues[currentStepBase + 8] === true ||
          String(rowValues[currentStepBase + 8]).toUpperCase() === "TRUE";

        if (currentStepBase === baseCol) {
          manualRevertedSteps.push(pName);

          // --- TARGET STEP ---
          if (isDelivery) {
            const qtyToRevert = Number(currentQtyMap[currentStepBase] || 0);
            if (qtyToRevert > 0) {
              await syncRevertToJobListing(psn, qtyToRevert, {
                actor,
                source: "revertProcessStep",
              });
            }
          }

          currentQtyMap[currentStepBase] = 0;
          rowValues[currentStepBase + 2] = "";
          rowValues[currentStepBase + 3] = "";
          rowValues[currentStepBase + 5] = "Reverted";
          const [existingInProg] = String(
            rowValues[currentStepBase + 6] || "",
          ).split("|", 2);
          rowValues[currentStepBase + 6] = `${existingInProg || ""}|`;
          rowValues[currentStepBase + 7] = revertRemark;
          rowValues[currentStepBase + 8] = false;
        } else if (wasDone) {
          autoRevertedSteps.push(pName);

          // --- SEQUENTIAL AUTO-REVERT ---
          if (isDelivery) {
            const qtyToRevert = Number(currentQtyMap[currentStepBase] || 0);
            if (qtyToRevert > 0) {
              await syncRevertToJobListing(psn, qtyToRevert, {
                actor,
                source: "revertProcessStep",
              });
            }
          }

          currentQtyMap[currentStepBase] = 0;
          rowValues[currentStepBase + 2] = "";
          rowValues[currentStepBase + 3] = "";
          rowValues[currentStepBase + 5] = "";
          const [existingInProg] = String(
            rowValues[currentStepBase + 6] || "",
          ).split("|", 2);
          rowValues[currentStepBase + 6] = `${existingInProg || ""}|`;
          rowValues[currentStepBase + 7] = "Auto-reverted (Sequential)";
          rowValues[currentStepBase + 8] = false;
        }
      }
    }

    rowValues[119] = serializeMap(currentQtyMap);
    await updateBatchListingRow(rowIdx, rowValues);

    // Check if we reverted any delivery step and update job status accordingly
    const revertedDeliveryStep = manualRevertedSteps.some(stepName => 
      String(stepName || "").toLowerCase().includes("delivery")
    ) || autoRevertedSteps.some(stepName => 
      String(stepName || "").toLowerCase().includes("delivery")
    );

    if (revertedDeliveryStep) {
      try {
        // Clear BatchListing completion status and completed date on delivery revert
        rowValues[114] = false; // Completion Status → FALSE
        rowValues[115] = "";    // Completed Date → empty
        await updateBatchListingRow(rowIdx, rowValues);
        console.log(`[revertProcessStep] PSN ${psn}: BatchListing col 114 (Completion Status) cleared, col 115 (Completed Date) cleared.`);

        const allJobRows = await getTableRowsAsObjects("JobListing");
        const normalizedPsn = normalizePsn(psn);
        const matchedJob = allJobRows.find((row) => {
          return normalizePsn(row["Product Serial Number"] || row.PSN || "") === normalizedPsn;
        });

        if (matchedJob) {
          const currentJobStatus = matchedJob["Status"] || matchedJob.Status || "";
          const deliveryStatuses = ["Delivery/Delay", "Delivery/Completed", "Delivery/Edited"];
          
          // Only revert job status if it's currently in one of the delivery statuses
          if (deliveryStatuses.includes(currentJobStatus)) {
            // Get headers and convert matchedJob to array format to access expected delivery date by column index (Column H = index 7)
            const jobListingHeaders = await getTableHeaders("JobListing");
            const jobRowArray = jobListingHeaders.map((h) => matchedJob[h] ?? "");
            const expectedDeliveryRaw = jobRowArray[7]; // Column H - Expected Delivery Date
            const newJobStatus = calculateJobStatusFromDeliveryDate(expectedDeliveryRaw);
            
            console.log(`[revertProcessStep] PSN ${psn}: reverting job status from "${currentJobStatus}" to "${newJobStatus}" (expectedDelivery: ${expectedDeliveryRaw})`);

            // Patch column K (Status, index 10) in JobListing
            const ctx = await getSharePointFileContext();
            const jobRowsRaw = await axios.get(
              `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('JobListing')/rows`,
              { headers: ctx.headers },
            );
            const rawRows = jobRowsRaw.data.value || [];
            let jobRowIndex = -1;
            for (let i = 0; i < rawRows.length; i++) {
              const rowPsn = normalizePsn(String(rawRows[i].values?.[0]?.[0] || ""));
              if (rowPsn === normalizedPsn) {
                jobRowIndex = i;
                break;
              }
            }

            if (jobRowIndex !== -1) {
              const excelRow = jobRowIndex + 2;
              const statusEndpoint = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/worksheets('JobListing')/range(address='K${excelRow}')`;
              await axios.patch(
                statusEndpoint,
                { values: [[newJobStatus]] },
                { headers: ctx.headers },
              );
              console.log(`[revertProcessStep] PSN ${psn}: JobListing K${excelRow} reverted to "${newJobStatus}"`);

              await addAuditLogEntry({
                timestamp: new Date().toISOString(),
                account: resolveAuditAccount(actor),
                action: "REVERT",
                module: "JobListing",
                identifier: psn,
                changeSummary: `Job delivery status reverted from "${currentJobStatus}" to "${newJobStatus}" upon delivery step revert`,
                dataPayload: {
                  source: "revertProcessStep_jobStatusRevert",
                  psn,
                  previousStatus: currentJobStatus,
                  newStatus: newJobStatus,
                  expectedDelivery: expectedDeliveryRaw,
                },
              });
            }
          }
        }
      } catch (jobStatusRevertErr) {
        console.error(`[revertProcessStep] PSN ${psn}: job status revert failed:`, jobStatusRevertErr.message);
        // Non-fatal — don't throw, let the main revert succeed
      }
    }

    const auditDiff = buildBatchAuditDiff(originalRow, rowValues);
    if (auditDiff.changedFields.length > 0) {
      const summaryParts = [];
      if (manualRevertedSteps.length) {
        summaryParts.push(`Reverted ${manualRevertedSteps.join(", ")}`);
      }
      if (autoRevertedSteps.length) {
        summaryParts.push(`Auto-reverted ${autoRevertedSteps.join(", ")}`);
      }
      if (revertRemark) {
        summaryParts.push(`Reason: ${revertRemark}`);
      }

      // Include specific field changes in the audit log for better traceability
      await addAuditLogEntry({
        action: "REVERT",
        module: "Batch Process",
        identifier: String(rowValues[1] || ""),
        account: resolveAuditAccount(actor),
        dataPayload: {
          source: "revertProcessStep",
          row: rowIdx,
          psn,
          batchId: String(rowValues[1] || ""),
          baseCol,
          revertRemark,
          manualRevertedSteps,
          autoRevertedSteps,
          changedFields: auditDiff.changedFields,
        },
        changeSummary: summaryParts.join("; ") || auditDiff.summary,
      });
    }
    return {
      success: true,
      message: "Step reverted. Completed following steps reset.",
    };
  } catch (error) {
    console.error("[revertProcessStep] Error:", error.message);
    throw error;
  }
}
// This function is called when a delivery step is reverted, to sync the revert action back to JobListing.
async function saveDateUpdates(payload) {
  const rowIdx = parseInt(payload.row);

  try {
    let runningRowData = await getBatchListingRow(rowIdx);

    if (payload.updates && Array.isArray(payload.updates)) {
      payload.updates.forEach((u) => {
        const expDateColIndex = u.baseCol + 1;

        // u.newExpDate is "DD/MM/YY" from your frontend
        const parts = u.newExpDate.split("/");
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // 0-indexed
        const year = parseInt("20" + parts[2]);

        // 1. Create a date object in LOCAL Malaysia time
        // 2. Set the time to 12:00 PM (Noon) to act as a GMT+8 buffer
        const safeDate = new Date(year, month, day, 12, 0, 0);

        // 3. Convert back to your specific string format
        // This ensures the value sent to Excel is a PURE string
        const d = String(safeDate.getDate()).padStart(2, "0");
        const m = String(safeDate.getMonth() + 1).padStart(2, "0");
        const y = String(safeDate.getFullYear()).substring(2);

        const finalString = `${d}/${m}/${y}`;

        // 4. Wrap in a single quote if the backend is still auto-converting
        // This is the "Nuclear Option" to stop Excel from changing the date
        runningRowData[expDateColIndex] = `'${finalString}`;
      });
    }

    await updateBatchListingRow(rowIdx, runningRowData);
    return { success: true };
  } catch (error) {
    console.error("[saveDateUpdates] Failed:", error.message);
    throw error;
  }
}

// Utility to convert a map object back into the serialized string format for Excel storage
function serializeMap(map) {
  return Object.keys(map)
    .sort((a, b) => a - b)
    .map((k) => `${k}:${map[k]}`)
    .join("|");
}

// Parses a string like "6:100|15:200" into an object { "6": "100", "15": "200" }
function parseMapString(str, fallbackQty) {
  if (!str || str === "0" || str === "" || str === "undefined") {
    return {};
  }
  const map = {};
  str.split("|").forEach((pair) => {
    const [k, v] = pair.split(":");
    if (k) map[k] = v;
  });
  return map;
}

// Helper function to calculate job status based on expected delivery date
function calculateJobStatusFromDeliveryDate(expectedDeliveryRaw) {
  if (!expectedDeliveryRaw) return "ON SCHEDULE"; // Default if no date
  
  const expectedDeliveryDate = parseDateOnly(expectedDeliveryRaw);
  if (!expectedDeliveryDate) return "ON SCHEDULE";
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset time to start of day
  
  const daysUntilDelivery = Math.floor((expectedDeliveryDate.getTime() - today.getTime()) / 86400000);
  
  if (daysUntilDelivery < 0) {
    return "OVERDUE";
  } else if (daysUntilDelivery <= 3) {
    return "DUE SOON";
  } else {
    return "ON SCHEDULE";
  }
}

// This function is called when a delivery step is marked as done in the BatchListing.
async function syncDeliveryToJobListing(psn, addedQty, auditMeta = {}) {
  const normalizedSearchPsn = normalizePsn(psn);
  const numericAddedQty = Number(addedQty || 0);
  const batchLabel = auditMeta.batchId ? `, batchId=${auditMeta.batchId}` : "";
  const processLabel = auditMeta.processName ? `, process="${auditMeta.processName}"` : "";
  console.log(
    `[syncDeliveryToJobListing] TRIGGERED source=${auditMeta.source || "unknown"}, psn=${psn}${batchLabel}${processLabel}, baseCol=${auditMeta.baseCol ?? "-"}, submittedQty=${auditMeta.submittedQty ?? "-"}, previouslySaved=${auditMeta.previouslySaved ?? "-"}, requestedDelta=${auditMeta.requestedDelta ?? numericAddedQty}, addedQty=${numericAddedQty}`,
  );
  try {
    if (!normalizedSearchPsn) {
      throw new Error("Missing PSN for delivery sync.");
    }
    if (!Number.isFinite(numericAddedQty) || numericAddedQty < 0) {
      throw new Error(`Invalid delivery sync qty: ${addedQty}`);
    }

    const fileContext = await getSharePointFileContext();
    const tableName = "JobListing";

    // 1. Get all rows from JobListing to find the PSN and current totals
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/rows`,
      { headers: fileContext.headers },
    );
    const rows = response.data.value || [];

    // 2. Find the row index and current values
    let targetRowIndex = -1;
    let currentRemaining = 0; // Column N (Index 13)
    let currentPartial = 0; // Column O (Index 14)
    let currentTotal = 0; // Column P (Index 15)
    let beforeRowValues = [];

    for (let i = 0; i < rows.length; i++) {
      const rowValues = rows[i].values[0];
      if (normalizePsn(rowValues[0]) === normalizedSearchPsn) {
        targetRowIndex = i + 2;
        beforeRowValues = [...rowValues];
        currentRemaining = Number(rowValues[13] || 0);
        currentPartial = Number(rowValues[14] || 0);
        currentTotal = Number(rowValues[15] || 0);
        break;
      }
    }

    if (targetRowIndex === -1) {
      throw new Error(`PSN ${psn} not found in JobListing.`);
    }

    // 3. Calculate new values
    // Subtract from Remaining, Add to Partial and Total
    const newRemaining = Math.max(0, currentRemaining - numericAddedQty);
    const newPartial = currentPartial + numericAddedQty;
    const newTotal = currentTotal + numericAddedQty;

    // 4. Update Columns N, O, and P (Indices 13, 14, and 15)
    // Range address spans from N to P: N[index]:P[index]
    const rangeAddress = `N${targetRowIndex}:P${targetRowIndex}`;

    console.log(
      `[syncDeliveryToJobListing] PATCH JobListing ${rangeAddress} for psn=${psn}${batchLabel}: Remaining ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
    );

    await axios.patch(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/worksheets('JobListing')/range(address='${rangeAddress}')`,

      { values: [[newRemaining, newPartial, newTotal]] },
      { headers: fileContext.headers },
    );

    console.log(
      `[syncDeliveryToJobListing] SUCCESS psn=${psn}${batchLabel}: Remaining ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
    );

    const syncResult = {
      psn,
      batchId: auditMeta.batchId || "",
      addedQty: numericAddedQty,
      oldValues: {
        remaining: currentRemaining,
        partial: currentPartial,
        total: currentTotal,
      },
      newValues: {
        remaining: newRemaining,
        partial: newPartial,
        total: newTotal,
      },
    };

    if (auditMeta.logAudit !== false) {
      const afterRowValues = [...beforeRowValues];
      afterRowValues[13] = newRemaining;
      afterRowValues[14] = newPartial;
      afterRowValues[15] = newTotal;
      const auditDiff = buildJobListingAuditDiff(beforeRowValues, afterRowValues);

      try {
        await addAuditLogEntryWithRetry({
          timestamp: new Date().toISOString(),
          account: resolveAuditAccount(auditMeta.actor),
          action: "UPDATE",
          module: "JobListing",
          identifier: psn,
          changeSummary: `Delivery sync updated JobListing for ${psn}${auditMeta.batchId ? ` (${auditMeta.batchId})` : ""}: BTD ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
          dataPayload: {
            event: "DELIVERY_SYNC",
            source: auditMeta.source || "saveMultiBatchUpdate",
            psn,
            batchId: auditMeta.batchId || "",
            processName: auditMeta.processName || "",
            baseCol: auditMeta.baseCol ?? null,
            amount: numericAddedQty,
            requestedDelta: auditMeta.requestedDelta ?? numericAddedQty,
            submittedQty: auditMeta.submittedQty ?? null,
            previouslySaved: auditMeta.previouslySaved ?? null,
            changedFields: auditDiff.changedFields,
            old_data: syncResult.oldValues,
            new_data: syncResult.newValues,
          },
        });
        console.log(
          `[syncDeliveryToJobListing] AUDIT SUCCESS psn=${psn}${batchLabel}: changedFields=${auditDiff.changedFields.length}`,
        );
      } catch (auditError) {
        console.warn(
          `[syncDeliveryToJobListing] Audit log failed after Excel sync succeeded for psn=${psn}${batchLabel}:`,
          auditError.message,
        );
      }
    }

    return syncResult;
  } catch (error) {
    console.error(
      `[syncDeliveryToJobListing] ERROR psn=${psn}${batchLabel}:`,
      error.response?.data || error.message,
    );
    throw error;
  }
}

// This function is called when a delivery step is reverted in the BatchListing.
async function syncOrderQtyToJobListing(psn, deltaQty, auditMeta = {}) {
  if (!psn || !deltaQty || Number(deltaQty) === 0) return;

  console.log("[syncOrderQtyToJobListing] start", { psn, deltaQty });
  try {
    const fileContext = await getSharePointFileContext();
    const tableName = "JobListing";
    const normalizedSearchPsn = normalizePsn(psn);

    // Get headers to find column indices
    const headerRes = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/headerRowRange`,
      { headers: fileContext.headers },
    );
    const headers = headerRes.data.values?.[0] || [];

    console.log("[syncOrderQtyToJobListing] Headers:", headers);

    // Find column indices for F and N (or their equivalents)
    let colF = headers.indexOf("F") >= 0 ? headers.indexOf("F") : 5;
    let colN = headers.indexOf("N") >= 0 ? headers.indexOf("N") : 13;

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/rows`,
      { headers: fileContext.headers },
    );
    const rows = response.data.value || [];

    console.log(
      `[syncOrderQtyToJobListing] Found ${rows.length} rows, searching for PSN: ${normalizedSearchPsn}`,
    );

    let targetRowNumber = -1;
    let currentF = 0;
    let currentN = 0;
    let foundRow = null;

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].values?.[0] || [];
      const rowPsn = normalizePsn(values[0] || "");

      if (rowPsn === normalizedSearchPsn) {
        targetRowNumber = i + 2;
        currentF = Number(values[colF] || 0);
        currentN = Number(values[colN] || 0);
        foundRow = values;

        console.log(
          `[syncOrderQtyToJobListing] Found matching row at index ${i}:`,
          {
            psnMatch: rowPsn,
            colFIndex: colF,
            colNIndex: colN,
            values_colF: values[colF],
            values_colN: values[colN],
            currentF,
            currentN,
          },
        );
        break;
      }
    }

    if (targetRowNumber === -1) {
      console.warn(
        `[syncOrderQtyToJobListing] PSN ${psn} not found in JobListing.`,
      );
      return null;
    }

    const newF = currentF + Number(deltaQty);
    const newN = currentN + Number(deltaQty);

    console.log(
      `[syncOrderQtyToJobListing] Updating: F: ${currentF} ? ${newF}, N: ${currentN} ? ${newN}`,
    );

    // Helper function to update a single cell with retry logic
    const updateCell = async (column, value, retries = 3, delayMs = 2000) => {
      const endpoint = `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/worksheets('JobListing')/range(address='${column}${targetRowNumber}')`;
      console.log(
        `[syncOrderQtyToJobListing] Patching ${column}${targetRowNumber} with value ${value}`,
      );
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await axios.patch(
            endpoint,
            { values: [[value]] },
            { headers: fileContext.headers },
          );
          return; // success
        } catch (err) {
          const status = err.response?.status;
          if (
            (status === 504 || status === 503 || status === 429) &&
            attempt < retries
          ) {
            console.warn(
              `[syncOrderQtyToJobListing] ${column} patch got ${status}, retrying (${attempt}/${retries}) after ${delayMs}ms...`,
            );
            await sleep(delayMs);
          } else {
            throw err; // give up or non-retryable error
          }
        }
      }
    };

    await updateCell("F", newF);
    await sleep(1000); // brief pause between writes so Graph doesn't lock
    await updateCell("N", newN);

    console.log(
      `[syncOrderQtyToJobListing] SUCCESS - PSN ${psn}: F ${currentF} ? ${newF}, N ${currentN} ? ${newN}`,
    );

    const syncResult = {
      psn,
      deltaQty: Number(deltaQty),
      oldValues: {
        orderQty: currentF,
        remaining: currentN,
      },
      newValues: {
        orderQty: newF,
        remaining: newN,
      },
    };

    if (auditMeta.logAudit !== false) {
      const _jlOldRow = [...(foundRow || [])];
      const _jlNewRow = [..._jlOldRow];
      _jlNewRow[colF] = newF;
      _jlNewRow[colN] = newN;
      const _jlDiff = buildJobListingAuditDiff(_jlOldRow, _jlNewRow);
      await addAuditLogEntry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(auditMeta.actor),
        action: "UPDATE",
        module: "JobListing",
        identifier: psn,
        changeSummary: `Order qty sync: ${psn} qty ${currentF} -> ${newF}, remaining ${currentN} -> ${newN}`,
        dataPayload: {
          event: "ORDER_QTY_SYNC",
          source: auditMeta.source || "syncOrderQtyToJobListing",
          deltaQty: Number(deltaQty),
          psn,
          changedFields: _jlDiff.changedFields,
          old_data: syncResult.oldValues,
          new_data: syncResult.newValues,
        },
      });
    }

    return syncResult;
  } catch (error) {
    console.error(
      "[syncOrderQtyToJobListing] Error:",
      error.response?.data || error.message,
      error.stack,
    );
    return null;
  }
}

// This function is called when a delivery step is reverted in the BatchListing, to add back the qty to JobListing.
async function syncRevertToJobListing(psn, revertQty, auditMeta = {}) {
  try {
    const fileContext = await getSharePointFileContext();
    const tableName = "JobListing";

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/rows`,
      { headers: fileContext.headers },
    );
    const rows = response.data.value || [];

    let targetRowIndex = -1;
    let currentRemaining = 0; // N
    let currentPartial = 0; // O
    let currentTotal = 0; // P

    for (let i = 0; i < rows.length; i++) {
      const rowValues = rows[i].values[0];
      if (String(rowValues[0] || "").trim() === psn) {
        targetRowIndex = i + 2;
        currentRemaining = Number(rowValues[13] || 0);
        currentPartial = Number(rowValues[14] || 0);
        currentTotal = Number(rowValues[15] || 0);
        break;
      }
    }

    if (targetRowIndex === -1) return null;

    // REVERT MATH:
    // Add back to Remaining, Subtract from Deliveries
    const newRemaining = currentRemaining + revertQty;
    const newPartial = Math.max(0, currentPartial - revertQty);
    const newTotal = Math.max(0, currentTotal - revertQty);

    const rangeAddress = `N${targetRowIndex}:P${targetRowIndex}`;

    await axios.patch(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/worksheets('JobListing')/range(address='${rangeAddress}')`,

      { values: [[newRemaining, newPartial, newTotal]] },
      { headers: fileContext.headers },
    );

    console.log(
      `[Revert Sync] PSN ${psn}: BTD: ${newRemaining}, Part: ${newPartial}, Tot: ${newTotal}`,
    );

    const syncResult = {
      psn,
      revertQty: Number(revertQty),
      oldValues: {
        remaining: currentRemaining,
        partial: currentPartial,
        total: currentTotal,
      },
      newValues: {
        remaining: newRemaining,
        partial: newPartial,
        total: newTotal,
      },
    };

    if (auditMeta.logAudit !== false) {
      await addAuditLogEntry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(auditMeta.actor),
        action: "REVERT",
        module: "JobListing",
        identifier: psn,
        changeSummary: `JobListing revert synced for ${psn}: BTD ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
        dataPayload: {
          event: "REVERT_SYNC",
          source: auditMeta.source || "syncRevertToJobListing",
          psn,
          revertQty: Number(revertQty),
          old_data: syncResult.oldValues,
          new_data: syncResult.newValues,
        },
      });
    }

    return syncResult;
  } catch (error) {
    console.error("[syncRevertToJobListing] Error:", error.message);
    return null;
  }
}

//change remaining inside job listing
async function syncBatchDeleteRemainingToJobListing(psn, restoreQty, actor = null) {
  try {
    const fileContext = await getSharePointFileContext();
    const tableName = "JobListing";

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/rows`,
      { headers: fileContext.headers },
    );
    const rows = response.data.value || [];

    let targetRowIndex = -1;
    let currentRemaining = 0; // M
    let beforeRowValues = [];

    for (let i = 0; i < rows.length; i++) {
      const rowValues = rows[i].values[0];
      if (String(rowValues[0] || "").trim() === psn) {
        targetRowIndex = i + 2;
        beforeRowValues = rowValues;
        currentRemaining = Number(rowValues[12] || 0);
        break;
      }
    }

    if (targetRowIndex === -1) return;

    const newRemaining = currentRemaining + Number(restoreQty || 0);
    const rangeAddress = `M${targetRowIndex}`;

    await axios.patch(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/worksheets('JobListing')/range(address='${rangeAddress}')`,

      { values: [[newRemaining]] },
      { headers: fileContext.headers },
    );

    // Fetch the updated row for audit logging
    const updatedResponse = await axios.get(
      `https://graph.microsoft.com/v1.0/drives/${fileContext.driveId}/items/${fileContext.fileId}/workbook/tables('${tableName}')/rows`,
      { headers: fileContext.headers },
    );
    const updatedRows = updatedResponse.data.value || [];
    let afterRowValues = [];

    for (let i = 0; i < updatedRows.length; i++) {
      const rowValues = updatedRows[i].values[0];
      if (String(rowValues[0] || "").trim() === psn) {
        afterRowValues = rowValues;
        break;
      }
    }

    // Build audit diff
    const auditDiff = buildJobListingAuditDiff(beforeRowValues, afterRowValues);

    // Log to audit
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(actor),
      action: "UPDATE",
      module: "JobListing",
      identifier: psn,
      changeSummary: `Batch deleted: Remaining qty restored for ${psn}: ${currentRemaining} -> ${newRemaining} (restored ${Number(restoreQty)})`,
      dataPayload: {
        source: "syncBatchDeleteRemainingToJobListing",
        psn,
        restoredQty: Number(restoreQty),
        oldRemaining: currentRemaining,
        newRemaining,
        changedFields: [
          {
            field: "Remaining",
            oldValue: currentRemaining,
            newValue: newRemaining,
            display: `Remaining: ${currentRemaining} -> ${newRemaining}`,
          },
        ],
      },
    });

    console.log(
      `[Batch Delete Sync] PSN ${psn}: M Remaining ${currentRemaining} -> ${newRemaining}`,
    );
  } catch (error) {
    console.error(
      "[syncBatchDeleteRemainingToJobListing] Error:",
      error.message,
    );
  }
}


// Endpoint to save batch updates with waterfall logic and splits
app.post("/api/saveMultiBatchUpdate", async (req, res) => {
  try {
    console.log("[API] POST /api/saveMultiBatchUpdate");
    const result = await saveMultiBatchUpdate(req.body, req.body?.actor);
    res.json(result);
  } catch (error) {
    console.error("[API] POST /api/saveMultiBatchUpdate - error:", error);
    res
      .status(500)
      .json({ error: "Failed to save batch update", details: error.message });
  }
});

// Endpoint to revert a process step
app.post("/api/revertProcessStep", async (req, res) => {
  try {
    console.log("[API] POST /api/revertProcessStep");
    const { row, baseCol, revertRemark, actor } = req.body;

    const result = await revertProcessStep(row, baseCol, revertRemark, actor);
    res.json(result);
  } catch (error) {
    console.error("[API] POST /api/revertProcessStep - error:", error);
    res
      .status(500)
      .json({ error: "Failed to revert process step", details: error.message });
  }
});

// Endpoint to update expected dates for processes
// OLD SHAREPOINT ROUTE: updateProcessDates preserved for reference
// This endpoint receives an array of updates, each containing a baseCol and newExpDate (in "DD/MM/YY" format). 
// It processes each update, applies the necessary date transformations to prevent Excel auto-conversion issues 
// Updates the corresponding cells in the BatchListing. The frontend is responsible for sending the correct row index 
// An array of updates for the specific process steps being edited.
app.post("/api/updateProcessDates", async (req, res) => {
  try {
    console.log("[API] POST /api/updateProcessDates");
    const result = await saveDateUpdates(req.body);
    res.json(result);
  } catch (error) {
    console.error("[API] Error updating process dates:", error);
    res.status(500).json({
      error: "Failed to update expected dates",
      details: error.message,
    });
  }
});


// Admin endpoint for batch editing multiple fields with complex logic
// OLD SHAREPOINT ROUTE: adminBatchEdit preserved for reference
app.post("/api/adminBatchEdit", async (req, res) => {
  console.log("[API] POST /api/adminBatchEdit", {
    row: req.body.row,
    hasChanges: !!req.body.changes,
    actor: req.body.actor,
  });
  serverLogger.apiRequest(req);
  try {
    const result = await adminBatchEdit(
      req.body.row,
      req.body.changes,
      req.body.actor,
    );
    serverLogger.dataRead("BatchListing", result.length);
    serverLogger.apiSuccess(req, 200, { rowCount: result.length });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[adminBatchEdit endpoint] Error:", e.message, e.stack);
    serverLogger.apiFail(req, 500, e);
    res.status(500).json({
      success: false,
      error: e.message,
      details: e.stack,
    });
  }
});



// -- HANDLER -------------------------------------------------------------------
// This is a powerful admin function that can apply multiple types of edits to a batch listing row in one go, with built-in logic to maintain data integrity (like capping process quantities when order qty is reduced). The "changes" object can contain any combination of the following properties:
// - orderQtyDelta: a number to add (or subtract) from the current order quantity
// - inProgressQtyEdits: an object where keys are base column indices and values are the new in-progress quantities
async function adminBatchEdit(rowIdx, changes, actor = null) {
  const START_COL = 6,
    BLOCK_SIZE = 9;
  console.log("[adminBatchEdit] start", {
    rowIdx,
    changesSummary: {
      orderQtyDelta: changes?.orderQtyDelta,
      inProgressQtyEdits: changes?.inProgressQtyEdits
        ? Object.keys(changes.inProgressQtyEdits)
        : [],
      processNameEdits: changes?.processNameEdits
        ? Object.keys(changes.processNameEdits)
        : [],
    },
    actor,
  });
  let row = await getBatchListingRow(rowIdx);
  const originalRow = [...row];

  // -- 1. Order qty delta -------------------------------------------------------
  if (changes.orderQtyDelta && changes.orderQtyDelta !== 0) {
    const newQty = Number(row[4] || 0) + changes.orderQtyDelta;
    if (newQty <= 0)
      throw new Error("Order qty cannot become zero or negative.");
    row[4] = newQty;

    // Parse and update maxQtyMap � cap all processes at new qty
    let maxQtyMap = parseMapString(String(row[120] || ""), newQty);
    let qtyMap = parseMapString(String(row[119] || ""), 0);

    if (changes.orderQtyDelta < 0) {
      // Subtracting: cap any already-done qty that exceeds the new total
      for (let i = 0; i < 12; i++) {
        const base = String(START_COL + i * BLOCK_SIZE);
        if (maxQtyMap[base] !== undefined)
          maxQtyMap[base] = Math.min(Number(maxQtyMap[base]), newQty);
        if (qtyMap[base] !== undefined && Number(qtyMap[base]) > newQty)
          qtyMap[base] = newQty;
      }
    } else {
      // Adding: expand max maps
      for (let i = 0; i < 12; i++) {
        const base = String(START_COL + i * BLOCK_SIZE);
        if (String(row[START_COL + i * BLOCK_SIZE] || "").trim() !== "") {
          if (!maxQtyMap[base]) maxQtyMap[base] = newQty;
          else maxQtyMap[base] = Math.max(Number(maxQtyMap[base]), newQty);
        }
      }
    }

    row[119] = serializeMap(qtyMap);
    row[120] = serializeMap(maxQtyMap);
  }

  // -- 2. In-progress qty edits -------------------------------------------------
  if (
    changes.inProgressQtyEdits &&
    Object.keys(changes.inProgressQtyEdits).length > 0
  ) {
    let qtyMap = parseMapString(String(row[119] || ""), 0);
    for (const [baseColStr, newVal] of Object.entries(
      changes.inProgressQtyEdits,
    )) {
      qtyMap[baseColStr] = newVal;
    }
    row[119] = serializeMap(qtyMap);
  }

  // -- 4. Delay remark edits ----------------------------------------------------
  if (changes.delayRemarkEdits) {
    for (const [baseColStr, newRemark] of Object.entries(
      changes.delayRemarkEdits,
    )) {
      const base = Number(baseColStr);
      const rawRemark = String(row[base + 6] || "");
      const pipeIdx = rawRemark.indexOf("|");
      const inProg = pipeIdx !== -1 ? rawRemark.slice(0, pipeIdx) : "";
      row[base + 6] = `${inProg}|${newRemark}`;
    }
  }

  // -- 5. Undo delays -----------------------------------------------------------
  if (changes.undoDelays && changes.undoDelays.length > 0) {
    for (const baseCol of changes.undoDelays) {
      const base = Number(baseCol);
      if (String(row[base + 5] || "").includes("Delayed")) {
        row[base + 5] = "";
        // Clear delay remark but preserve in-progress remark
        const rawRemark = String(row[base + 6] || "");
        const pipeIdx = rawRemark.indexOf("|");
        const inProg = pipeIdx !== -1 ? rawRemark.slice(0, pipeIdx) : "";
        row[base + 6] = `${inProg}|`;
      }
    }
  }

  // -- 7. Finish date edits (done steps) — also recalculate duration + status ----
  if (changes.finishDateEdits) {
    // Helper: read a raw endDate cell and return something parseDateOnly can handle.
    // Strips the apostrophe prefix written by this function, but preserves numbers
    // (Excel serials) and YYYY-MM-DD strings as-is.
    const readRawDate = (val) => {
      if (!val) return null;
      return typeof val === 'string' ? val.replace(/^'/, '') : val;
    };

    // Process changed finish dates in base-column order (smallest base first) so that
    // when a later step looks back at row[prevBase+2] it sees the already-updated value.
    const sortedEdits = Object.entries(changes.finishDateEdits)
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    // Track the highest base that was edited so we know from where to cascade.
    let highestEditedBase = -1;
    let lowestEditedBase = Infinity;

    for (const [baseColStr, newDateRaw] of sortedEdits) {
      const base = Number(baseColStr);
      const parts = newDateRaw.split("-");
      if (parts.length !== 3) continue;

      // 1. Find the previous done step's finish date (walk backward through blocks).
      let prevDateRaw = null;
      for (let pb = base - BLOCK_SIZE; pb >= START_COL; pb -= BLOCK_SIZE) {
        const raw = row[pb + 2];
        if (raw) { prevDateRaw = readRawDate(raw); break; }
      }
      if (!prevDateRaw) prevDateRaw = row[2] ?? null; // batch creation date (Excel serial or string)

      // 2. Calculate duration BEFORE writing row[base+2].
      const finishDate = parseDateOnly(newDateRaw);
      const startDate = parseDateOnly(prevDateRaw);
      if (startDate && finishDate) {
        const rawDiff = (finishDate.getTime() - startDate.getTime()) / 86400000;
        row[base + 3] = Number.isFinite(rawDiff) ? Math.ceil(rawDiff) : '';
      }

      // 3. Write the new finish date in apostrophe-prefixed DD/MM/YY format.
      const d = parts[2], m = parts[1], y = parts[0].substring(2);
      row[base + 2] = `'${d}/${m}/${y}`;

      // 4. Mark as Delayed if new finish date exceeds expected date.
      const expDateRaw = readRawDate(row[base + 1]);
      const expDate = parseDateOnly(expDateRaw);
      if (expDate && finishDate && finishDate > expDate) {
        const currentStatus = String(row[base + 5] || '');
        if (!currentStatus.includes('Delayed')) row[base + 5] = 'Delayed';
      }

      if (base > highestEditedBase) highestEditedBase = base;
      if (base < lowestEditedBase) lowestEditedBase = base;
    }

    // 5. Cascade: recalculate duration for every subsequent DONE step whose fin date
    //    was NOT edited but whose start point (prev step's fin date) just changed.
    //    Walk forward from the block immediately after the LOWEST edited base, so that
    //    done steps between two non-adjacent edits (e.g. P2 and P4 edited, P3 skipped)
    //    also get their durations recalculated.
    if (highestEditedBase >= START_COL) {
      for (let base = lowestEditedBase + BLOCK_SIZE; base < START_COL + 12 * BLOCK_SIZE; base += BLOCK_SIZE) {
        const stepName = String(row[base] || '').trim();
        if (!stepName || stepName === '--') break; // no more defined steps

        const isDone = row[base + 8] === true || String(row[base + 8]).toLowerCase() === 'true';
        if (!isDone) break; // only cascade through done steps; stop at first undone step

        // Skip steps that were directly edited — their duration was already set in the edit loop above.
        if (changes.finishDateEdits[String(base)] !== undefined) continue;

        // This step's fin date was not changed — its existing row[base+2] stays.
        // But its duration must be recomputed from its new start point.
        const existingFinRaw = readRawDate(row[base + 2]);
        if (!existingFinRaw) break; // no fin date recorded — nothing to recalculate

        let prevDateRaw = null;
        for (let pb = base - BLOCK_SIZE; pb >= START_COL; pb -= BLOCK_SIZE) {
          const raw = row[pb + 2];
          if (raw) { prevDateRaw = readRawDate(raw); break; }
        }
        if (!prevDateRaw) prevDateRaw = row[2] ?? null;

        const finishDate = parseDateOnly(existingFinRaw);
        const startDate = parseDateOnly(prevDateRaw);
        if (startDate && finishDate) {
          const rawDiff = (finishDate.getTime() - startDate.getTime()) / 86400000;
          row[base + 3] = Number.isFinite(rawDiff) ? Math.ceil(rawDiff) : '';
        }
      }
    }
  }

  // -- 8. Batch remark ----------------------------------------------------------
  if (changes.batchRemark !== null && changes.batchRemark !== undefined) {
    row[118] = changes.batchRemark;
  }

  // -- 9. Completed date --------------------------------------------------------
  if (
    changes.completedDateEdit !== null &&
    changes.completedDateEdit !== undefined
  ) {
    row[115] = changes.completedDateEdit;
  }

  // -- 10. Machine detail edits -------------------------------------------------
  if (changes.machineDetailEdits) {
    for (const [baseColStr, newMachine] of Object.entries(
      changes.machineDetailEdits,
    )) {
      row[Number(baseColStr) + 4] = newMachine;
    }
  }

  // -- 3 / 6 / 11 / 12 (combined): Write complete process sequence -------------
  if (changes.sequenceEdited && Array.isArray(changes.newSequence)) {
    const seq = changes.newSequence;

    // Build lookup from original row so existing data is preserved for kept steps
    const origBlocks = {};
    for (let i = 0; i < 12; i++) {
      const base = START_COL + i * BLOCK_SIZE;
      const name = String(row[base] || '').trim();
      if (name && name !== '--') origBlocks[base] = row.slice(base, base + BLOCK_SIZE);
    }

    // Build old qtyMap / maxQtyMap keyed by original baseCol
    const oldQtyMap = parseMapString(String(row[119] || ''), 0);
    const oldMaxMap = parseMapString(String(row[120] || ''), 0);

    // Wipe all 12 process slots
    for (let i = 0; i < 12; i++) {
      const base = START_COL + i * BLOCK_SIZE;
      for (let j = 0; j < BLOCK_SIZE; j++) row[base + j] = '';
    }

    const newQtyMap = {}, newMaxMap = {};
    const orderQty = Number(row[4] || 0); // already updated by step 1 if delta applied

    seq.slice(0, 12).forEach((step, i) => {
      const newBase = START_COL + i * BLOCK_SIZE;

      if (step.isNew || step.baseCol === null) {
        // -- New step: write name + expDate, zero qty ----------------------
        row[newBase + 0] = step.name;
        if (step.expDate) {
          // expDate is stored as DD/MM/YY
          row[newBase + 1] = `'${step.expDate}`;
        }
        for (let j = 2; j < BLOCK_SIZE - 1; j++) row[newBase + j] = '';
        row[newBase + BLOCK_SIZE - 1] = false; // Tick
        newQtyMap[String(newBase)] = 0;
        newMaxMap[String(newBase)] = orderQty;
      } else {
        // -- Existing step: copy its original block -------------------------
        const origBase = step.baseCol; // original column index
        const origBlock = origBlocks[origBase];
        if (origBlock) {
          for (let j = 0; j < BLOCK_SIZE; j++) row[newBase + j] = origBlock[j];
        }
        // Update name if changed
        if (step.name !== (origBlock ? origBlock[0] : '')) {
          row[newBase + 0] = step.name;
        }
        // Update expDate if changed (stored as DD/MM/YY — seq carries DD/MM/YY)
        if (step.expDate) {
          const oldExpDate = origBlock ? String(origBlock[1] || '').replace(/^'/, '').trim() : '';
          const isDeliveryStep = String(step.name || '').toLowerCase().includes('delivery');
          // Normalize both sides to DD/MM/YY via parseDateOnly before comparing,
          // so format differences (ISO, serial, apostrophe-prefixed) don't cause
          // a false-positive "date changed" detection when the date is actually the same.
          const normDate = (raw) => {
            if (!raw) return '';
            // If the raw value is a numeric string (e.g. Excel serial "46184"),
            // convert to Number so parseDateOnly hits the numeric branch correctly.
            const coerced = (typeof raw === 'string' && /^\d+$/.test(raw.trim()))
              ? Number(raw.trim())
              : raw;
            const d = parseDateOnly(coerced);
            if (!d) return String(raw).trim();
            const dd = String(d.getUTCDate()).padStart(2, '0');
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const yy = String(d.getUTCFullYear()).substring(2);
            return `${dd}/${mm}/${yy}`;
          };
          const oldNorm = normDate(oldExpDate);
          const newNorm = normDate(step.expDate);
          if (isDeliveryStep && oldNorm && oldNorm !== newNorm) {
            // Find the delivery step's current baseCol in the row to update its detail
            const deliveryBase = newBase; // newBase IS the delivery step's new position
            const readableOldDate = displayDate(oldExpDate || oldNorm); // converts DD/MM/YY → DD/MM/YYYY
            const dateChangedNote = `Date Changed from ${readableOldDate}`;
            const currentDetail = String(row[deliveryBase + 4] || '');
            // Strip ALL existing "Date Changed from ..." occurrences (including mid-string),
            // then clean up any orphaned separators, so re-saves fully overwrite the note.
            const cleanedDetail = currentDetail
              .replace(/Date Changed from \d{2}\/\d{2}\/\d{4}/g, '')
              .replace(/\s*\|\s*\|\s*/g, ' | ')   // collapse double separators
              .replace(/^\s*\|\s*/g, '')            // strip leading separator
              .replace(/\s*\|\s*$/g, '')            // strip trailing separator
              .trim();
            row[deliveryBase + 4] = cleanedDetail ? `${cleanedDetail} | ${dateChangedNote}` : dateChangedNote;
          }
          row[newBase + 1] = `'${step.expDate}`;
        }
        // Remap qty keys
        if (oldQtyMap[String(origBase)] !== undefined)
          newQtyMap[String(newBase)] = oldQtyMap[String(origBase)];
        if (oldMaxMap[String(origBase)] !== undefined)
          newMaxMap[String(newBase)] = oldMaxMap[String(origBase)];
      }
    });

    row[119] = serializeMap(newQtyMap);
    row[120] = serializeMap(newMaxMap);
  }

  // -- Write row ----------------------------------------------------------------
  // Note: For better performance, we could consider batching updates (e.g. write once after all changes)
  // But for simplicity and to ensure triggers like syncOrderQtyToJobListing work correctly, we'll update after the order qty change 
  // Then again at the end if there are sequence or qty map changes.
  await updateBatchListingRow(rowIdx, row);

  // -- Reset done processes if adding qty ----------------------------------------
  if (changes.orderQtyDelta && changes.orderQtyDelta > 0) {
    // Check if batch is fully completed
    let isFullyCompleted = true;
    for (let i = 0; i < 12; i++) {
      const base = START_COL + i * BLOCK_SIZE;
      if (String(row[base] || '').trim() !== '') {
        const isDone = row[base + 8] === true || String(row[base + 8]).toLowerCase() === 'true';
        if (!isDone) {
          isFullyCompleted = false;
          break;
        }
      }
    }

    // Reset processes
    for (let i = 0; i < 12; i++) {
      const base = START_COL + i * BLOCK_SIZE;
      if (String(row[base] || '').trim() !== '') {
        const isDone = row[base + 8] === true || String(row[base + 8]).toLowerCase() === 'true';
        if (isFullyCompleted || isDone) {
          row[base + 8] = false;
        }
      }
    }

    if (isFullyCompleted) {
      row[114] = 0; // completion_status
      row[115] = null; // completion_date
    }

    // Update the row again with reset ticks
    await updateBatchListingRow(rowIdx, row);
  }

  if (changes.orderQtyDelta && changes.orderQtyDelta !== 0) {
    const psn = String(row[0] || originalRow[0] || "").trim();
    const deltaQty = Number(changes.orderQtyDelta || 0);

    // Check if this is a split scenario (subtracting with step changes)
    const hasStepDeletions =
      Array.isArray(changes.stepsToDelete) && changes.stepsToDelete.length > 0;
    const isSplitting = deltaQty < 0 && hasStepDeletions;

    // Sync logic:
    // - If adding qty (positive delta): ALWAYS sync
    // - If subtracting qty without split: sync
    // - If subtracting qty WITH split: don't sync
    const shouldSync = deltaQty > 0 || (deltaQty < 0 && !isSplitting);

    if (shouldSync) {
      console.log(
        `[adminBatchEdit] Syncing order qty change: PSN=${psn}, delta=${deltaQty}, isSplitting=${isSplitting}`,
      );
      await syncOrderQtyToJobListing(psn, deltaQty, {
        actor,
        source: "adminBatchEdit",
      });
    } else {
      console.log(
        `[adminBatchEdit] Skipping sync (split scenario): PSN=${psn}, delta=${deltaQty}`,
      );
    }
  }

  const auditDiff = buildBatchAuditDiff(originalRow, row);
  const batchId = String(row[1] || originalRow[1] || "").trim();
  const psn = String(row[0] || originalRow[0] || "").trim();

  if (auditDiff.changedFields.length > 0) {
    const _adminSummaryParts = [];

    // Batch qty change
    if (changes.orderQtyDelta && changes.orderQtyDelta !== 0) {
      const _oldQty = Number(originalRow[4] || 0);
      const _newQty = _oldQty + changes.orderQtyDelta;
      _adminSummaryParts.push(`Batch qty: ${_oldQty} -> ${_newQty}`);
    }

    // In-progress qty edits per process
    if (changes.inProgressQtyEdits && Object.keys(changes.inProgressQtyEdits).length > 0) {
      const _origQtyMap = parseMapString(String(originalRow[119] || ""), 0);
      const _qParts = Object.entries(changes.inProgressQtyEdits).map(([base, newVal]) => {
        const name = String(originalRow[Number(base)] || "").trim();
        const oldVal = Number(_origQtyMap[base] || 0);
        return `${name || `col${base}`}: ${oldVal} -> ${newVal}`;
      });
      _adminSummaryParts.push(`In-progress qty — ${_qParts.join(", ")}`);
    }

    // Completed date edit
    if (changes.completedDateEdit !== undefined && changes.completedDateEdit !== null) {
      const oldDate = originalRow[115] ? displayDate(originalRow[115]) : "(none)";
      _adminSummaryParts.push(`Completed date: ${oldDate} -> ${changes.completedDateEdit || "(cleared)"}`);
    }

    // Machine (Die-cut) detail edits
    if (changes.machineDetailEdits && Object.keys(changes.machineDetailEdits).length > 0) {
      const machineParts = Object.entries(changes.machineDetailEdits).map(([base, machine]) => {
        const name = String(originalRow[Number(base)] || "").trim();
        return `${name || `col${base}`}: ${machine}`;
      });
      _adminSummaryParts.push(`Machine — ${machineParts.join(", ")}`);
    }

    // Undo delays — detect from changes.undoDelays
    if (changes.undoDelays && changes.undoDelays.length > 0) {
      const undoNames = changes.undoDelays.map((baseCol) => {
        const name = String(originalRow[Number(baseCol)] || "").trim();
        return name || `col${baseCol}`;
      });
      _adminSummaryParts.push(`Delay removed: ${undoNames.join(", ")}`);
    }

    // Process expected date edits — detected from newSequence diff against originalRow
    if (changes.sequenceEdited && Array.isArray(changes.newSequence)) {
      const expDateChanges = [];
      changes.newSequence.forEach((step) => {
        if (!step.expDate || step.isNew || step.baseCol === null) return;
        const oldRaw = String(originalRow[Number(step.baseCol) + 1] || "").replace(/^'/, "").trim();
        if (oldRaw && oldRaw !== step.expDate) {
          const name = String(originalRow[Number(step.baseCol)] || step.name || "").trim();
          expDateChanges.push(`${name}: ${displayDate(oldRaw)} -> ${displayDate(step.expDate)}`);
        }
      });
      if (expDateChanges.length > 0) {
        _adminSummaryParts.push(`Exp date — ${expDateChanges.join(", ")}`);
      }
    }

    // Steps deleted
    if (changes.stepsToDelete && changes.stepsToDelete.length > 0) {
      const names = changes.stepsToDelete.map((base) =>
        String(originalRow[Number(base)] || base).trim(),
      );
      _adminSummaryParts.push(`Removed: ${names.join(", ")}`);
    }

    // Steps added
    if (changes.stepsToAdd && changes.stepsToAdd.length > 0) {
      _adminSummaryParts.push(`Added: ${changes.stepsToAdd.map((s) => s.name).join(", ")}`);
    }

    // Batch remark — show old -> new (truncate long values)
    if (changes.batchRemark !== undefined && changes.batchRemark !== null) {
      const oldRemark = String(originalRow[118] || "").trim();
      const newRemark = String(changes.batchRemark).trim();
      const truncate = (s) => s.length > 40 ? s.slice(0, 40) + "…" : s;
      if (oldRemark !== newRemark) {
        const oldPart = oldRemark ? `"${truncate(oldRemark)}"` : "(none)";
        const newPart = newRemark ? `"${truncate(newRemark)}"` : "(cleared)";
        _adminSummaryParts.push(`Batch remark: ${oldPart} -> ${newPart}`);
      }
    }

    // Sequence reorder
    const _seqEntry = auditDiff.changedFields.find((f) => f.field === "Process Sequence");
    if (_seqEntry) _adminSummaryParts.push(`Reordered: ${_seqEntry.newValue}`);

    const _adminSummary =
      _adminSummaryParts.length > 0
        ? _adminSummaryParts.join("; ")
        : auditDiff.summary;

    try {
      await addAuditLogEntry({
        timestamp: new Date().toISOString(),
        account: resolveAuditAccount(actor),
        action: "UPDATE",
        module: "BatchListing",
        identifier: batchId || psn || String(rowIdx),
        changeSummary: _adminSummary,
        dataPayload: {
          rowIndex: Number(rowIdx),
          psn,
          batchId,
          changeCount: auditDiff.changedFields.length,
          changedFields: auditDiff.changedFields,
          frontendChanges: changes || {},
        },
      });
    } catch (auditError) {
      console.error(
        "[adminBatchEdit] Audit log write failed after row update:",
        auditError.message,
      );
    }
  }

  return { success: true };
}

// -- Delete batch --------------------------------------------------------------
// 1. The Route Handler (ensure it passes req.body)
// OLD SHAREPOINT ROUTE: adminArchiveBatch preserved for reference
app.post("/api/adminArchiveBatch", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    const result = await adminArchiveBatch(req.body);
    serverLogger.dataRead(req.body, result.length);
    serverLogger.apiSuccess(req, 200, { rowCount: result.length });
    res.json(result);
  } catch (e) {
    console.error("[adminArchiveBatch endpoint]", e.message);
    serverLogger.apiFail(req, 500, e);
    res.status(500).json({ success: false, error: e.message });
  }
});


// 2. The adminArchiveBatch Function
async function adminArchiveBatch(payload) {
  // 1. Destructure from the single payload object
  // We remove 'psn' from here because we fetch the fresh value from the row later
  const { row: rowIdx, batchId, deleteRemark, actor, hasBatchOrigin } = payload;

  if (rowIdx === undefined) throw new Error("Row index is required.");

  try {
    // 2. Fetch the current data BEFORE deletion
    const rowValues = await getBatchListingRow(parseInt(rowIdx));
    if (!rowValues) throw new Error("Batch row not found in SharePoint.");

    // 3. Initialize variables from the fetched row
    const psn = String(rowValues[0] || "").trim(); // Fresh PSN from data
    const batchQty = Number(rowValues[4] || 0);

    // 4. Build 'changedFields' for the "Old vs New" UI
    const qtyMap = mapBatchQtyByProcessName(rowValues, rowValues[119]);
    const changedFields = [
      { field: "Batch ID", oldValue: batchId, newValue: "(Deleted)" },
      { field: "PSN", oldValue: psn, newValue: "(This Batch Deleted)" },
      { field: "Quantity", oldValue: batchQty, newValue: 0 },
      {
        field: "Processes",
        oldValue: formatNamedQtyMap(qtyMap),
        newValue: "(Cleared)",
      },
      { field: "Reason", oldValue: "(N/A)", newValue: deleteRemark },
    ];

    // 5. ARCHIVE THE DATA
    const rowsAsObjects = await getTableRowsAsObjects("BatchListing");
    const batchRowsToArchive = [
      rowsAsObjects.find(
        (r) => String(r["BatchId"] || r.batchId || "").trim() === batchId,
      ),
    ];

    if (batchRowsToArchive[0]) {
      await archiveBatchRows(batchRowsToArchive, deleteRemark, null);
    }

    // 6. SYNC QUANTITIES
    // Ensure hasBatchOrigin is checked correctly

    await syncBatchDeleteRemainingToJobListing(psn, batchQty, actor);


    // 7. DELETE FROM ACTIVE TABLE
    const ctx = await getSharePointFileContext();
    const url = `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/items/${ctx.fileId}/workbook/tables('BatchListing')/rows/itemAt(index=${rowIdx})`;
    await axios.delete(url, { headers: ctx.headers });

    // 8. IMPROVED AUDIT LOG
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: resolveAuditAccount(actor),
      action: "DELETE",
      module: "BatchListing",
      identifier: batchId || psn,
      changeSummary: `Batch Deleted: ${batchId}. Reason: ${deleteRemark}`,
      dataPayload: {
        batchId,
        psn,
        changedFields: changedFields, // For "Old vs New" UI
        payload: rowValues, // For "Payload JSON" box
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error in adminArchiveBatch:", error);
    throw error;
  }
}

// // API route to get AuditLog entries (GET)
app.get("/api/auditLogs", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] GET /api/auditLogs");
    const data = await getAuditLogEntries();
    serverLogger.dataRead(req.body, data.length);
    serverLogger.apiSuccess(req, 200, { rowCount: data.length });
    res.json(data);
  } catch (error) {
    serverLogger.apiFail(req, 500, error);
    console.error("[API] GET /api/auditLogs - error:", error);
    res.status(500).json({ error: "Failed to load AuditLog" });
  }
});

// // API route to add a new AuditLog entry (POST)
app.post("/api/auditLogs", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    console.log("[API] POST /api/auditLogs");
    const entry = await addAuditLogEntry(req.body || {});
    serverLogger.dataWrite("auditlog", "INSERT", req.body?.identifier || "unknown");
    serverLogger.apiSuccess(req, 200, { rowCount: 1 });
    res.json({ success: true, entry });
  } catch (error) {
    console.error("[API] POST /api/auditLogs - error:", error);
    serverLogger.apiFail(req, 500, error);
    res.status(500).json({ success: false, error: "Failed to save AuditLog" });
  }
});

// // NEW MySQL migration handlers for BatchDetail update/save/revert flows

// // Database Migration Version of reduceBatchQty with enhanced error handling and logging
// app.post("/api/reduceBatchQty", async (req, res) => {
//   try {
//     const batchIdentifier = req.body.batchId || req.body.row;
//     console.log("[API] POST /api/reduceBatchQty (MySQL)", {
//       row: req.body.row,
//       batchId: req.body.batchId,
//       newQty: req.body.newQty,
//     });

//     const result = await mysqlReduceBatchQty(
//       batchIdentifier,
//       req.body.newQty,
//       req.body.actor,
//     );
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/reduceBatchQty (MySQL) - error:", error);
//     res.status(500).json({
//       error: "Failed to reduce batch qty",
//       details: error.message,
//     });
//   }
// });

// // Database Migration Function: createSplitBatch with MySQL
// app.post("/api/createSplitBatch", async (req, res) => {
//   try {
//     console.log("[API] POST /api/createSplitBatch (MySQL) - request received");
//     const result = await mysqlCreateSplitBatch(req.body);
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/createSplitBatch (MySQL) - error:", error);
//     res.status(500).json({
//       error: "Failed to create split batch",
//       details: error.message,
//     });
//   }
// });

// // Database Migration Function for Batch Deletion (with JobListing sync and audit log)
// app.post("/api/adminArchiveBatch", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     const result = await mysqlAdminArchiveBatch(req.body);
//     serverLogger.apiSuccess(req, 200, { rowCount: 1 });
//     res.json(result);
//   } catch (error) {
//     console.error("[adminArchiveBatch endpoint]", error.message);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Database Migration Function: Admin batch edit with complex logic for order qty and process quantities
// app.post("/api/adminBatchEdit", async (req, res) => {
//   console.log("[API] POST /api/adminBatchEdit (MySQL)", {
//     row: req.body.row,
//     hasChanges: !!req.body.changes,
//     actor: req.body.actor,
//   });
//   serverLogger.apiRequest(req);
//   try {
//     const result = await mysqlAdminBatchEdit(
//       req.body.row,
//       req.body.changes,
//       req.body.actor,
//     );
//     serverLogger.apiSuccess(req, 200, { rowCount: 1 });
//     res.json({ success: true, ...result });
//   } catch (error) {
//     console.error("[adminBatchEdit endpoint] Error:", error.message, error.stack);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({
//       success: false,
//       error: error.message,
//       details: error.stack,
//     });
//   }
// });


// // Database Migration Function: Update expected dates for processes
// app.post("/api/updateProcessDates", async (req, res) => {
//   try {
//     console.log("[API] POST /api/updateProcessDates (MySQL)");
//     const result = await mysqlUpdateProcessDates(req.body);
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/updateProcessDates (MySQL) - error:", error);
//     res.status(500).json({
//       error: "Failed to update expected dates",
//       details: error.message,
//     });
//   }
// });

// // ============ API ENDPOINTS FOR BATCH UPDATES ============
// // Endpoint to update process quantities only (without marking as done)
// app.post("/api/updateProcessQtysOnly", async (req, res) => {
//   try {
//     console.log("[API] POST /api/updateProcessQtysOnly");
//     const { row, qtyMapArray, actor } = req.body;

//     const result = await mysqlUpdateProcessQtysOnly(row, qtyMapArray, actor);
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/updateProcessQtysOnly - error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to update quantities", details: error.message });
//   }
// });

// // Endpoint to save batch updates with waterfall logic and splits
// app.post("/api/saveMultiBatchUpdate", async (req, res) => {
//   try {
//     console.log("[API] POST /api/saveMultiBatchUpdate");
//     const result = await mysqlSaveMultiBatchUpdate(req.body, req.body?.actor);
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/saveMultiBatchUpdate - error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to save batch update", details: error.message });
//   }
// });

// // Endpoint to revert a process step
// app.post("/api/revertProcessStep", async (req, res) => {
//   try {
//     console.log("[API] POST /api/revertProcessStep");
//     const { row, baseCol, revertRemark, actor } = req.body;

//     const result = await mysqlRevertProcessStep(row, baseCol, revertRemark, actor);
//     res.json(result);
//   } catch (error) {
//     console.error("[API] POST /api/revertProcessStep - error:", error);
//     res
//       .status(500)
//       .json({ error: "Failed to revert process step", details: error.message });
//   }
// });

// async function mysqlFetchBatchWithProcesses(batchIdentifier) {
//   const batchId = String(batchIdentifier || "").trim();
//   const numericId = Number(batchIdentifier);
//   const conn = db.promise();

//   const [batchRows] = await conn.query(
//     `SELECT * FROM batchlisting WHERE (batch_id = ? OR id = ?) AND COALESCE(batch_active, 'Active') = 'Active' LIMIT 1`,
//     [batchId, Number.isNaN(numericId) ? -1 : numericId],
//   );
//   if (!batchRows.length) return null;

//   const batch = batchRows[0];
//   const [processes] = await conn.query(
//     `SELECT * FROM processes WHERE batch_id = ? AND COALESCE(process_active, 'Active') = 'Active' ORDER BY process_order ASC`,
//     [batch.batch_id],
//   );

//   return { batch, processes };
// }

// async function mysqlResolveBatchListingId(conn, batch) {
//   const directId = Number(
//     batch?.id ?? batch?.batchlisting_id ?? batch?.batchlistingId ?? 0,
//   );
//   if (Number.isInteger(directId) && directId > 0) {
//     return directId;
//   }

//   const [rows] = await conn.query(
//     `SELECT id FROM batchlisting WHERE batch_id = ? LIMIT 1`,
//     [String(batch?.batch_id || "").trim()],
//   );
//   const resolvedId = Number(rows?.[0]?.id || 0);
//   return Number.isInteger(resolvedId) && resolvedId > 0 ? resolvedId : null;
// }

// function mysqlBaseColToProcessOrder(baseCol) {
//   const val = Number(baseCol);
//   if (Number.isNaN(val) || val < 6) return null;
//   return Math.floor((val - 6) / 9) + 1;
// }

// async function mysqlUpdateJobListingDeliveryDateByPsn(psn, deliveryDate, actor = null) {
//   if (!psn || !deliveryDate) return null;
//   const conn = db.promise();
//   const normalizedPsn = String(psn || "").trim();
//   const formattedDate = formatDateForExcel(deliveryDate);

//   const [rows] = await conn.query(
//     `SELECT * FROM joblisting WHERE job_psn = ? LIMIT 1`,
//     [normalizedPsn],
//   );
//   if (!rows.length) {
//     console.warn(`[mysqlUpdateJobListingDeliveryDateByPsn] PSN ${normalizedPsn} not found.`);
//     return null;
//   }

//   await conn.query(
//     `UPDATE joblisting SET job_deliveryDate = ? WHERE job_psn = ?`,
//     [formattedDate, normalizedPsn],
//   );

//   if (actor) {
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "UPDATE",
//       module: "JobListing",
//       identifier: normalizedPsn,
//       changeSummary: `Delivery date updated for ${normalizedPsn} ? ${formattedDate}`,
//       dataPayload: {
//         source: "mysqlUpdateJobListingDeliveryDateByPsn",
//         psn: normalizedPsn,
//         jobDeliveryDate: formattedDate,
//       },
//     });
//   }

//   return { success: true, job_psn: normalizedPsn, job_deliveryDate: formattedDate };
// }

// async function mysqlSyncDeliveryToJobListing(psn, addedQty, auditMeta = {}) {
//   if (!psn || Number(addedQty) === 0) return null;
//   const conn = db.promise();
//   const normalizedPsn = String(psn || "").trim();

//   const [rows] = await conn.query(
//     `SELECT job_remainingqty, job_partialDelivery, job_totalDelivery FROM joblisting WHERE job_psn = ? LIMIT 1`,
//     [normalizedPsn],
//   );
//   if (!rows.length) return null;

//   const job = rows[0];
//   const currentRemaining = Number(job.job_remainingqty || 0);
//   const currentPartial = Number(job.job_partialDelivery || 0);
//   const currentTotal = Number(job.job_totalDelivery || 0);
//   const newRemaining = Math.max(0, currentRemaining - Number(addedQty));
//   const newPartial = currentPartial + Number(addedQty);
//   const newTotal = currentTotal + Number(addedQty);

//   await conn.query(
//     `UPDATE joblisting SET job_remainingqty = ?, job_partialDelivery = ?, job_totalDelivery = ? WHERE job_psn = ?`,
//     [newRemaining, newPartial, newTotal, normalizedPsn],
//   );

//   if (auditMeta.logAudit !== false) {
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(auditMeta.actor),
//       action: "UPDATE",
//       module: "JobListing",
//       identifier: normalizedPsn,
//       changeSummary: `Delivery sync updated JobListing for ${normalizedPsn}: Remaining ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
//       dataPayload: {
//         event: "DELIVERY_SYNC",
//         source: auditMeta.source || "mysqlSyncDeliveryToJobListing",
//         psn: normalizedPsn,
//         addedQty: Number(addedQty),
//         old_data: { remaining: currentRemaining, partial: currentPartial, total: currentTotal },
//         new_data: { remaining: newRemaining, partial: newPartial, total: newTotal },
//       },
//     });
//   }

//   return {
//     success: true,
//     psn: normalizedPsn,
//     oldValues: { remaining: currentRemaining, partial: currentPartial, total: currentTotal },
//     newValues: { remaining: newRemaining, partial: newPartial, total: newTotal },
//   };
// }

// async function mysqlSyncRevertToJobListing(psn, revertQty, auditMeta = {}) {
//   if (!psn || Number(revertQty) === 0) return null;
//   const conn = db.promise();
//   const normalizedPsn = String(psn || "").trim();

//   const [rows] = await conn.query(
//     `SELECT job_remainingqty, job_partialDelivery, job_totalDelivery FROM joblisting WHERE job_psn = ? LIMIT 1`,
//     [normalizedPsn],
//   );
//   if (!rows.length) return null;

//   const job = rows[0];
//   const currentRemaining = Number(job.job_remainingqty || 0);
//   const currentPartial = Number(job.job_partialDelivery || 0);
//   const currentTotal = Number(job.job_totalDelivery || 0);
//   const newRemaining = currentRemaining + Number(revertQty);
//   const newPartial = Math.max(0, currentPartial - Number(revertQty));
//   const newTotal = Math.max(0, currentTotal - Number(revertQty));

//   await conn.query(
//     `UPDATE joblisting SET job_remainingqty = ?, job_partialDelivery = ?, job_totalDelivery = ? WHERE job_psn = ?`,
//     [newRemaining, newPartial, newTotal, normalizedPsn],
//   );

//   if (auditMeta.logAudit !== false) {
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(auditMeta.actor),
//       action: "REVERT",
//       module: "JobListing",
//       identifier: normalizedPsn,
//       changeSummary: `JobListing revert synced for ${normalizedPsn}: Remaining ${currentRemaining} -> ${newRemaining}, Partial ${currentPartial} -> ${newPartial}, Total ${currentTotal} -> ${newTotal}`,
//       dataPayload: {
//         event: "REVERT_SYNC",
//         source: auditMeta.source || "mysqlSyncRevertToJobListing",
//         psn: normalizedPsn,
//         revertQty: Number(revertQty),
//         old_data: { remaining: currentRemaining, partial: currentPartial, total: currentTotal },
//         new_data: { remaining: newRemaining, partial: newPartial, total: newTotal },
//       },
//     });
//   }

//   return {
//     success: true,
//     psn: normalizedPsn,
//     oldValues: { remaining: currentRemaining, partial: currentPartial, total: currentTotal },
//     newValues: { remaining: newRemaining, partial: newPartial, total: newTotal },
//   };
// }

// async function mysqlGenerateNewBatchId(currentBatchId) {
//   const baseId = String(currentBatchId || "").split("-")[0];
//   const conn = db.promise();
//   const [rows] = await conn.query(
//     `SELECT batch_id FROM batchlisting WHERE batch_id LIKE ?`,
//     [`${baseId}-%`],
//   );

//   const usedSuffixes = new Set();
//   rows.forEach((row) => {
//     const suffix = String(row.batch_id || "").split("-").pop();
//     const num = Number(suffix);
//     if (!Number.isNaN(num)) usedSuffixes.add(num);
//   });

//   let nextSuffix = 1;
//   while (usedSuffixes.has(nextSuffix)) nextSuffix += 1;
//   return `${baseId}-${nextSuffix}`;
// }

// async function mysqlCreateSplitBatchFromWaterfall(
//   conn,
//   parentBatch,
//   parentProcesses,
//   diffQty,
//   splitAtOrder,
//   userRemark,
//   actor = null,
// ) {
//   const newBatchId = await mysqlGenerateNewBatchId(parentBatch.batch_id);
//   const remarkText = userRemark
//     ? `${userRemark} (From: ${parentBatch.batch_id})`
//     : `Split (From: ${parentBatch.batch_id})`;

//   const [insertResult] = await conn.query(
//     `INSERT INTO batchlisting (
//       batch_id,
//       job_psn,
//       batch_date,
//       batch_quantity,
//       completion_status,
//       completion_date,
//       new_batch_remark,
//       batch_active,
//       batch_status,
//       delete_remark
//       ) VALUES (?, ?, CURDATE(), ?,  0, NULL, ?, 'Active', NULL, NULL)`,
//     [
//       newBatchId,
//       parentBatch.job_psn,
//       diffQty,
//       remarkText
//     ]
//   );

//   const batchListingId = insertResult.insertId;
//   for (const proc of parentProcesses) {
//     const isBeforeSplit = Number(proc.process_order) < Number(splitAtOrder);
//     const isSplitStep = Number(proc.process_order) === Number(splitAtOrder);

//     const childCurrentQty = isBeforeSplit ? diffQty : 0;
//     const childMaxQty = diffQty;
//     const childComplete = isBeforeSplit && proc.process_complete ? 1 : 0;
//     const childStatus = isBeforeSplit && proc.process_complete
//       ? String(proc.process_status || "").trim() || "Completed"
//       : "";
//     const childEndDate = isBeforeSplit ? proc.process_end_date || null : null;
//     const childDuration = isBeforeSplit ? proc.process_duration || 0 : 0;
//     const childDelayRemark = isBeforeSplit ? proc.process_delay_remark || null : null;
//     const childInProgRemark = isBeforeSplit ? proc.process_in_progress_remark || null : null;
//     const childRevertRemark = isBeforeSplit ? proc.process_revert_remark || null : null;

//     await conn.query(
//       `INSERT INTO processes (
//         batch_id,
//         batchlisting_id,
//         process_order,
//         process_name,
//         process_expected_date,
//         process_end_date,
//         process_duration,
//         process_detail,
//         process_status,
//         process_delay_remark,
//         process_in_progress_remark,
//         process_revert_remark,
//         process_complete,
//         current_qty,
//         max_qty,
//         process_active
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
//       [
//         newBatchId,
//         batchListingId,
//         proc.process_order,
//         proc.process_name,
//         proc.process_expected_date || null,
//         childEndDate,
//         childDuration,
//         proc.process_detail || null,
//         childStatus,
//         childDelayRemark,
//         childInProgRemark,
//         childRevertRemark,
//         childComplete,
//         childCurrentQty,
//         childMaxQty,
//       ],
//     );
//   }

//   if (actor) {
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "SPLIT",
//       module: "BatchListing",
//       identifier: newBatchId,
//       changeSummary: `Created split batch ${newBatchId} from ${parentBatch.batch_id} with qty ${diffQty}`,
//       dataPayload: {
//         source: "mysqlCreateSplitBatchFromWaterfall",
//         parentBatchId: parentBatch.batch_id,
//         childBatchId: newBatchId,
//         splitQty: diffQty,
//       },
//     });
//   }

//   return { success: true, newBatchId };
// }

// async function mysqlSaveMultiBatchUpdate(payload, actor = null) {
//   console.log("[mysqlSaveMultiBatchUpdate] Payload received:", payload);
//   const batchIdentifier = String(payload.batchId || payload.row || "").trim();
//   const batchData = await mysqlFetchBatchWithProcesses(batchIdentifier);
//   if (!batchData) {
//     throw new Error(`Batch not found: ${batchIdentifier || payload.row}`);
//   }

//   const { batch, processes } = batchData;
//   const mutableProcesses = processes.map((proc) => ({ ...proc }));
//   const processMap = new Map(
//     mutableProcesses.map((proc) => [Number(proc.process_order), proc]),
//   );
//   const todayISO = new Date().toISOString().split("T")[0];
//   const conn = db.promise();
//   const updates = (payload.updates || []).sort((a, b) => a.baseCol - b.baseCol);

//   let newBatchIdCreated = null;
//   let deliveryAddedQty = 0;
//   let parentBatchQty = Number(batch.batch_quantity || 0);
//   let hasCompletionChanged = false;
//   let completionDate = batch.completion_date;
//   let completionStatus = Number(batch.completion_status) ? 1 : 0;

//   await conn.beginTransaction();
//   try {
//     for (const u of updates) {
//       console.log(u);
//       const processOrder = mysqlBaseColToProcessOrder(u.baseCol);
//       if (processOrder === null) continue;
//       const proc = processMap.get(processOrder);
//       if (!proc) continue;

//       const isDeliveryStep = String(proc.process_name || "").toLowerCase().includes("delivery");
//       const originalMaxQty = Number(proc.max_qty || parentBatchQty || 0);
//       const proposedQty = Number(u.qty || 0);
//       const isSplit = u.isDone && proposedQty < originalMaxQty;

//       const delayRemark = u.isDelayed || u.isDone ? String(u.remark || "").trim() : String(proc.process_delay_remark || "").trim();
//       const inProgRemark = String(u.inProgressRemark || proc.process_in_progress_remark || "").trim();
//       const detailValue = u.detail || proc.process_detail || null;
//       const processComplete = u.isDone ? 1 : 0;
//       const processStatus = u.isDone
//         ? isDeliveryStep && isSplit
//           ? "Partially Delivered"
//           : u.isDelayed
//             ? "Delayed"
//             : "Completed"
//         : u.isDelayed
//           ? "Delayed"
//           : String(proc.process_status || "").trim();

//       let computedEndDate = null;
//       let computedDuration = proc.process_duration || 0;
//       if (u.isDone) {
//         let prevCompletedDate = batch.batch_date || todayISO;
//         const earlier = mutableProcesses
//           .filter((p) => Number(p.process_order) < processOrder)
//           .reverse()
//           .find((p) => p.process_end_date);
//         if (earlier && earlier.process_end_date) {
//           prevCompletedDate = earlier.process_end_date;
//         }

//         const startDate = new Date(prevCompletedDate);
//         const finishDateISO = u.finishDate || todayISO;
//         const endDate = new Date(finishDateISO);
//         const diffDays = Math.max(1, Math.ceil((endDate - startDate) / 86400000));
//         computedEndDate = finishDateISO;
//         computedDuration = diffDays;
//       }

//       const currentQty = proposedQty;
//       // FIX: When splitting, max_qty should be set to the new batch quantity (proposedQty)
//       // This ensures correct quantity tracking for parent batch after split
//       const maxQty = isSplit ? proposedQty : Number(u.maxQty || originalMaxQty || 0);

//       await conn.query(
//         `UPDATE processes SET
//           process_status = ?,
//           process_in_progress_remark = ?,
//           process_delay_remark = ?,
//           process_detail = ?,
//           current_qty = ?,
//           max_qty = ?,
//           process_complete = ?,
//           process_end_date = ?,
//           process_duration = ?,
//           process_revert_remark = ?
//          WHERE batch_id = ?
//            AND process_order = ?
//            AND COALESCE(process_active, 'Active') = 'Active'`,
//         [
//           processStatus,
//           inProgRemark,
//           delayRemark,
//           detailValue,
//           currentQty,
//           maxQty,
//           processComplete,
//           computedEndDate,
//           computedDuration,
//           String(proc.process_revert_remark || "").trim(),
//           batch.batch_id,
//           processOrder,
//         ],
//       );

//       proc.process_status = processStatus;
//       proc.process_in_progress_remark = inProgRemark;
//       proc.process_delay_remark = delayRemark;
//       proc.process_detail = detailValue;
//       proc.current_qty = currentQty;
//       proc.max_qty = maxQty;
//       proc.process_complete = processComplete;
//       proc.process_end_date = computedEndDate;
//       proc.process_duration = computedDuration;

//       if (isDeliveryStep && u.isDone && proposedQty > 0) {
//         deliveryAddedQty += proposedQty;
//         completionStatus = 1;
//         completionDate = todayISO;
//         hasCompletionChanged = true;
//       }

//       if (isSplit) {
//         const remainder = originalMaxQty - proposedQty;
//         if (remainder > 0) {
//           const splitResult = await mysqlCreateSplitBatchFromWaterfall(
//             conn,
//             batch,
//             mutableProcesses,
//             remainder,
//             processOrder,
//             payload.splitRemark || "",
//             actor,
//           );
//           newBatchIdCreated = splitResult.newBatchId;
//           parentBatchQty = proposedQty;
//           batch.batch_quantity = proposedQty;
//           await conn.query(
//             `UPDATE batchlisting SET batch_quantity = ? WHERE batch_id = ?`,
//             [proposedQty, batch.batch_id],
//           );
//           for (const liveProc of mutableProcesses) {
//             const liveMax = Number(liveProc.max_qty || originalMaxQty || 0);
//             const cappedMax = Math.min(liveMax || proposedQty, proposedQty);
//             const cappedCurrent = Math.min(
//               Number(liveProc.current_qty || 0),
//               proposedQty,
//             );

//             if (
//               Number(liveProc.max_qty || 0) !== cappedMax ||
//               Number(liveProc.current_qty || 0) !== cappedCurrent
//             ) {
//               await conn.query(
//                 `UPDATE processes
//                    SET max_qty = ?, current_qty = ?
//                  WHERE batch_id = ?
//                    AND process_order = ?
//                    AND COALESCE(process_active, 'Active') = 'Active'`,
//                 [cappedMax, cappedCurrent, batch.batch_id, liveProc.process_order],
//               );
//             }

//             liveProc.max_qty = cappedMax;
//             liveProc.current_qty = cappedCurrent;
//           }
//         }
//       }
//     }

//     if (hasCompletionChanged) {
//       await conn.query(
//         `UPDATE batchlisting SET completion_status = ?, completion_date = ? WHERE batch_id = ?`,
//         [completionStatus, completionDate, batch.batch_id],
//       );
//     }

//     if (payload.newDeliveryDate && payload.newDeliveryDate !== "KEEP_ORIGINAL") {
//       await mysqlUpdateJobListingDeliveryDateByPsn(batch.job_psn, payload.newDeliveryDate, actor);
//     }

//     if (deliveryAddedQty > 0) {
//       await mysqlSyncDeliveryToJobListing(batch.job_psn, deliveryAddedQty, {
//         actor,
//         source: "mysqlSaveMultiBatchUpdate",
//       });
//     }

//     await conn.commit();

//     return { success: true, newBatchId: newBatchIdCreated || null };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlSaveMultiBatchUpdate] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlUpdateProcessQtysOnly(rowIdentifier, qtyMapArray, actor = null) {
//   const batchData = await mysqlFetchBatchWithProcesses(rowIdentifier);
//   if (!batchData) throw new Error(`Batch not found: ${rowIdentifier}`);
//   const { batch, processes } = batchData;
//   const processMap = new Map(
//     processes.map((proc) => [Number(proc.process_order), proc]),
//   );
//   const conn = db.promise();

//   await conn.beginTransaction();
//   try {
//     for (const item of qtyMapArray) {
//       const processOrder = mysqlBaseColToProcessOrder(item.baseCol);
//       if (processOrder === null) continue;
//       const proc = processMap.get(processOrder);
//       if (!proc) continue;

//       const newQty = Number(item.qty || 0);
//       const maxAllowed = Number(proc.max_qty || batch.batch_quantity || 0);
//       if (newQty > maxAllowed) {
//         throw new Error(`Qty for process ${proc.process_name} exceeds allowed max of ${maxAllowed}.`);
//       }

//       await conn.query(
//         `UPDATE processes SET current_qty = ? WHERE process_id = ?`,
//         [newQty, proc.process_id],
//       );
//     }

//     await conn.commit();

//     const auditSummary = qtyMapArray
//       .map((item) => {
//         const processOrder = mysqlBaseColToProcessOrder(item.baseCol);
//         const proc = processMap.get(processOrder);
//         return proc
//           ? `${proc.process_name}: ${item.qty}`
//           : null;
//       })
//       .filter(Boolean)
//       .join("; ");

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "UPDATE",
//       module: "BatchListing",
//       identifier: batch.batch_id || batch.job_psn,
//       changeSummary: auditSummary || "Process qty updated",
//       dataPayload: {
//         source: "mysqlUpdateProcessQtysOnly",
//         batchId: batch.batch_id,
//         psn: batch.job_psn,
//         qtyMapArray,
//       },
//     });

//     return { success: true };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlUpdateProcessQtysOnly] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlRevertProcessStep(rowIdentifier, baseCol, revertRemark, actor = null) {
//   if (!revertRemark || String(revertRemark).trim() === "") {
//     throw new Error("Revert remark is mandatory.");
//   }

//   const batchData = await mysqlFetchBatchWithProcesses(rowIdentifier);
//   if (!batchData) throw new Error(`Batch not found: ${rowIdentifier}`);
//   const { batch, processes } = batchData;
//   const targetOrder = mysqlBaseColToProcessOrder(baseCol);
//   if (targetOrder === null) throw new Error(`Invalid baseCol: ${baseCol}`);

//   const conn = db.promise();
//   await conn.beginTransaction();
//   try {
//     const manualRevertedSteps = [];
//     const autoRevertedSteps = [];

//     for (const proc of processes) {
//       if (Number(proc.process_order) < targetOrder) continue;
//       const isDelivery = String(proc.process_name || "").toLowerCase().includes("delivery");
//       const wasDone = Number(proc.process_complete) === 1;

//       if (!wasDone && Number(proc.process_order) !== targetOrder) {
//         continue;
//       }

//       const revertLabel = Number(proc.process_order) === targetOrder
//         ? String(revertRemark).trim()
//         : "Auto-reverted (Sequential)";

//       if (Number(proc.process_order) === targetOrder) {
//         manualRevertedSteps.push(proc.process_name);
//       } else {
//         autoRevertedSteps.push(proc.process_name);
//       }

//       if (isDelivery && Number(proc.current_qty || 0) > 0) {
//         await mysqlSyncRevertToJobListing(batch.job_psn, Number(proc.current_qty || 0), {
//           actor,
//           source: "mysqlRevertProcessStep",
//         });
//       }

//       await conn.query(
//         `UPDATE processes SET
//            process_complete = 0,
//            process_status = '',
//            current_qty = 0,
//            process_end_date = NULL,
//            process_duration = 0,
//            process_in_progress_remark = '',
//            process_delay_remark = '',
//            process_revert_remark = ?
//          WHERE process_id = ?`,
//         [revertLabel, proc.process_id],
//       );
//     }

//     await conn.query(
//       `UPDATE batchlisting SET completion_status = 0, completion_date = NULL WHERE batch_id = ?`,
//       [batch.batch_id],
//     );

//     await conn.commit();

//     const summaryParts = [];
//     if (manualRevertedSteps.length) {
//       summaryParts.push(`Reverted ${manualRevertedSteps.join(", ")}`);
//     }
//     if (autoRevertedSteps.length) {
//       summaryParts.push(`Auto-reverted ${autoRevertedSteps.join(", ")}`);
//     }
//     if (revertRemark) {
//       summaryParts.push(`Reason: ${revertRemark}`);
//     }

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "REVERT",
//       module: "Batch Process",
//       identifier: batch.batch_id || batch.job_psn,
//       changeSummary: summaryParts.join("; ") || "Reverted process step",
//       dataPayload: {
//         source: "mysqlRevertProcessStep",
//         batchId: batch.batch_id,
//         psn: batch.job_psn,
//         baseCol,
//         revertRemark,
//         manualRevertedSteps,
//         autoRevertedSteps,
//       },
//     });

//     return {
//       success: true,
//       message: "Step reverted. Completed following steps reset.",
//     };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlRevertProcessStep] Error:", error.message || error);
//     throw error;
//   }
// }

// function mysqlNormalizeProcessDateInput(value) {
//   if (!value) return null;
//   const raw = String(value || "").trim();
//   if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

//   const parts = raw.split("/");
//   if (parts.length === 3) {
//     let [day, month, year] = parts;
//     if (year.length === 2) year = `20${year}`;
//     return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
//   }

//   return raw;
// }

// function mysqlProcessOrderToBaseCol(processOrder) {
//   const order = Number(processOrder);
//   if (Number.isNaN(order) || order < 1) return null;
//   return 6 + (order - 1) * 9;
// }

// async function mysqlUpdateProcessDates(payload) {
//   const { row, updates, actor } = payload || {};
//   if (!row) throw new Error("Batch row identifier is required.");
//   if (!Array.isArray(updates) || updates.length === 0) {
//     return { success: true, message: "No process date updates provided." };
//   }

//   const batchData = await mysqlFetchBatchWithProcesses(row);
//   if (!batchData) throw new Error(`Batch not found: ${row}`);

//   const conn = db.promise();
//   await conn.beginTransaction();
//   try {
//     const changed = [];
//     for (const update of updates) {
//       const processOrder = mysqlBaseColToProcessOrder(update.baseCol);
//       if (processOrder === null) continue;

//       const normalized = mysqlNormalizeProcessDateInput(update.newExpDate);
//       if (!normalized) continue;

//       const [result] = await conn.query(
//         `UPDATE processes SET process_expected_date = ?
//           WHERE batch_id = ?
//             AND process_order = ?
//             AND COALESCE(process_active, 'Active') = 'Active'`,
//         [normalized, batchData.batch.batch_id, processOrder],
//       );

//       if (result.affectedRows) {
//         changed.push({ baseCol: update.baseCol, processOrder, processExpectedDate: normalized });
//       }
//     }

//     await conn.commit();

//     if (changed.length > 0) {
//       await addAuditLogEntry({
//         timestamp: new Date().toISOString(),
//         account: resolveAuditAccount(actor),
//         action: "UPDATE",
//         module: "BatchListing",
//         identifier: batchData.batch.batch_id,
//         changeSummary: `Updated ${changed.length} process expected date(s)`,
//         dataPayload: {
//           source: "mysqlUpdateProcessDates",
//           batchId: batchData.batch.batch_id,
//           psn: batchData.batch.job_psn,
//           updates: changed,
//         },
//       });
//     }

//     return { success: true, updatedCount: changed.length };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlUpdateProcessDates] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlReduceBatchQty(rowIdentifier, newQty, actor = null) {
//   const batchData = await mysqlFetchBatchWithProcesses(rowIdentifier);
//   if (!batchData) throw new Error(`Batch not found: ${rowIdentifier}`);

//   const batch = batchData.batch;
//   const currentBatchQty = Number(batch.batch_quantity || 0);
//   const targetQty = Number(newQty);

//   if (Number.isNaN(targetQty) || targetQty < 0) {
//     throw new Error("Invalid newQty");
//   }
//   if (targetQty >= currentBatchQty) {
//     throw new Error("newQty must be smaller than current batch qty");
//   }

//   const conn = db.promise();
//   await conn.beginTransaction();
//   try {
//     await conn.query(
//       `UPDATE batchlisting SET batch_quantity = ? WHERE batch_id = ? AND COALESCE(batch_active, 'Active') = 'Active'`,
//       [targetQty, batch.batch_id],
//     );

//     const changedProcesses = [];
//     for (const proc of batchData.processes) {
//       const currentQty = Number(proc.current_qty || 0);
//       const maxQty = Number(proc.max_qty || currentBatchQty || 0);
//       const newCurrent = currentQty > targetQty ? targetQty : currentQty;
//       const newMax = maxQty > targetQty ? targetQty : maxQty;

//       if (newCurrent !== currentQty || newMax !== maxQty) {
//         await conn.query(
//           `UPDATE processes SET current_qty = ?, max_qty = ? WHERE process_id = ?`,
//           [newCurrent, newMax, proc.process_id],
//         );
//         changedProcesses.push({
//           processName: proc.process_name,
//           oldCurrent: currentQty,
//           newCurrent,
//           oldMax: maxQty,
//           newMax,
//         });
//       }
//     }

//     await conn.commit();

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "UPDATE",
//       module: "BatchListing",
//       identifier: batch.batch_id,
//       changeSummary: `Reduced batch quantity ${currentBatchQty} ? ${targetQty}`,
//       dataPayload: {
//         source: "mysqlReduceBatchQty",
//         batchId: batch.batch_id,
//         psn: batch.job_psn,
//         oldQty: currentBatchQty,
//         newQty: targetQty,
//         changedProcesses,
//       },
//     });

//     return { success: true, message: "Original batch qty reduced" };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlReduceBatchQty] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlSyncBatchDeleteRemainingToJobListing(psn, restoreQty, actor = null) {
//   if (!psn || Number(restoreQty) === 0) return null;

//   const conn = db.promise();
//   const [rows] = await conn.query(
//     `SELECT job_remainingqty FROM joblisting WHERE job_psn = ? AND COALESCE(job_active, 'Active') = 'Active' LIMIT 1`,
//     [String(psn).trim()],
//   );
//   if (!rows.length) return null;

//   const currentRemaining = Number(rows[0].job_remainingqty || 0);
//   const newRemaining = currentRemaining + Number(restoreQty);

//   await conn.query(
//     `UPDATE joblisting SET job_remainingqty = ? WHERE job_psn = ? AND COALESCE(job_active, 'Active') = 'Active'`,
//     [newRemaining, String(psn).trim()],
//   );

//   await addAuditLogEntry({
//     timestamp: new Date().toISOString(),
//     account: resolveAuditAccount(actor),
//     action: "UPDATE",
//     module: "JobListing",
//     identifier: psn,
//     changeSummary: `Restored ${restoreQty} remaining qty for ${psn}`,
//     dataPayload: {
//       source: "mysqlSyncBatchDeleteRemainingToJobListing",
//       psn,
//       oldRemaining: currentRemaining,
//       newRemaining,
//     },
//   });

//   return {
//     success: true,
//     oldRemaining: currentRemaining,
//     newRemaining,
//   };
// }

// async function mysqlAdminArchiveBatch(payload) {
//   const { row: rowIdentifier, batchId, deleteRemark, deleteType, actor, hasBatchOrigin } = payload;
//   if (!deleteRemark || !String(deleteRemark).trim()) {
//     throw new Error("Delete remark is required.");
//   }

//   const statusValue = String(deleteType || "Deleted").trim() || "Deleted";
//   const batchIdentifier = batchId || rowIdentifier;
//   const batchData = await mysqlFetchBatchWithProcesses(batchIdentifier);
//   if (!batchData) throw new Error(`Batch not found: ${batchIdentifier}`);

//   const batch = batchData.batch;
//   const conn = db.promise();
//   await conn.beginTransaction();
//   try {
//     await conn.query(
//       `UPDATE batchlisting SET batch_active = 'Inactive', delete_remark = ?, batch_status = ? WHERE batch_id = ?`,
//       [String(deleteRemark).trim(), statusValue, batch.batch_id],
//     );
//     await conn.query(
//       `UPDATE processes SET process_active = 'Inactive', process_status = ? WHERE batch_id = ?`,
//       [statusValue, batch.batch_id],
//     );

//     await mysqlSyncBatchDeleteRemainingToJobListing(
//       batch.job_psn,
//       Number(batch.batch_quantity || 0),
//       actor,
//     );

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "DELETE",
//       module: "BatchListing",
//       identifier: batch.batch_id,
//       changeSummary: `Batch archived: ${batch.batch_id}`,
//       dataPayload: {
//         source: "mysqlAdminArchiveBatch",
//         batchId: batch.batch_id,
//         psn: batch.job_psn,
//         deleteType: statusValue,
//         deleteRemark: String(deleteRemark).trim(),
//       },
//     });

//     await conn.commit();
//     return { success: true, deleteType: statusValue };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlAdminArchiveBatch] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlApplySequenceEdits(conn, batch, existingProcesses, newSequence) {
//   if (!Array.isArray(newSequence)) return;

//   const keepIds = [];
//   const batchQty = Number(batch.batch_quantity || 0);
//   const batchListingId = await mysqlResolveBatchListingId(conn, batch);

//   if (!batchListingId) {
//     throw new Error(`Unable to resolve batchlisting_id for batch ${batch.batch_id}`);
//   }

//   for (let i = 0; i < newSequence.length; i++) {
//     const step = newSequence[i];
//     const processOrder = i + 1;
//     const expectedDate = mysqlNormalizeProcessDateInput(step.expDate);

//     if (step.baseCol !== null && step.baseCol !== undefined) {
//       const originalOrder = mysqlBaseColToProcessOrder(step.baseCol);
//       const existing = existingProcesses.find(
//         (proc) => Number(proc.process_order) === originalOrder,
//       );
//       if (existing) {
//         keepIds.push(existing.process_id);
//         await conn.query(
//           `UPDATE processes SET process_order = ?, process_name = ?, process_expected_date = ? WHERE process_id = ?`,
//           [processOrder, step.name, expectedDate, existing.process_id],
//         );
//         continue;
//       }
//     }

//     const [insertResult] = await conn.query(
//       `INSERT INTO processes (
//         batch_id,
//         batchlisting_id,
//         process_order,
//         process_name,
//         process_expected_date,
//         process_end_date,
//         process_duration,
//         process_detail,
//         process_status,
//         process_delay_remark,
//         process_in_progress_remark,
//         process_revert_remark,
//         process_complete,
//         current_qty,
//         max_qty,
//         process_active
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,'Active')`,
//       [
//         batch.batch_id,
//         batchListingId,
//         processOrder,
//         step.name,
//         expectedDate,
//         null,
//         0,
//         step.detail || null,
//         "",
//         "",
//         "",
//         "",
//         0,
//         0,
//         batchQty,
//       ],
//     );
//     keepIds.push(insertResult.insertId);
//   }

//   const removedProcessIds = existingProcesses
//     .filter((proc) => !keepIds.includes(proc.process_id))
//     .map((proc) => proc.process_id);

//   if (removedProcessIds.length) {
//     await conn.query(
//       `UPDATE processes SET process_active = 'Inactive' WHERE process_id IN (?)`,
//       [removedProcessIds],
//     );
//   }
// }

// async function mysqlAdminBatchEdit(rowIdentifier, changes = {}, actor = null) {
//   const batchData = await mysqlFetchBatchWithProcesses(rowIdentifier);
//   if (!batchData) throw new Error(`Batch not found: ${rowIdentifier}`);

//   const batch = batchData.batch;
//   const processes = batchData.processes;
//   const conn = db.promise();
//   await conn.beginTransaction();

//   const batchQty = Number(batch.batch_quantity || 0);
//   const targetQty = Number(batchQty + (Number(changes.orderQtyDelta || 0) || 0));
//   const changedFields = [];

//   try {
//     if (changes.orderQtyDelta && changes.orderQtyDelta !== 0) {
//       await conn.query(
//         `UPDATE batchlisting SET batch_quantity = ? WHERE batch_id = ? AND COALESCE(batch_active, 'Active') = 'Active'`,
//         [targetQty, batch.batch_id],
//       );

//       for (const proc of processes) {
//         const currentQty = Number(proc.current_qty || 0);
//         const oldMax = Number(proc.max_qty || batchQty || 0);
//         const newMax = changes.orderQtyDelta < 0 ? Math.min(oldMax, targetQty) : Math.max(oldMax, targetQty);
//         const newCurrent = changes.orderQtyDelta < 0 && currentQty > targetQty ? targetQty : currentQty;

//         if (newCurrent !== currentQty || newMax !== oldMax) {
//           await conn.query(
//             `UPDATE processes SET current_qty = ?, max_qty = ? WHERE process_id = ?`,
//             [newCurrent, newMax, proc.process_id],
//           );
//         }
//       }

//       if (changes.orderQtyDelta > 0) {
//         const activeProcesses = processes.filter(
//           (proc) => String(proc.process_active || "Active") === "Active",
//         );
//         const isFullyCompleted =
//           activeProcesses.length > 0 &&
//           activeProcesses.every((proc) => Number(proc.process_complete) === 1);

//         for (const proc of activeProcesses) {
//           if (Number(proc.process_complete) !== 1) continue;

//           await conn.query(
//             `UPDATE processes SET process_complete = 0 WHERE process_id = ?`,
//             [proc.process_id],
//           );

//           changedFields.push({
//             field: `Reset completed tick ${proc.process_name}`,
//             oldValue: 1,
//             newValue: 0,
//           });
//         }

//         if (isFullyCompleted) {
//           await conn.query(
//             `UPDATE batchlisting SET completion_status = 0, completion_date = NULL WHERE batch_id = ?`,
//             [batch.batch_id],
//           );

//           changedFields.push({
//             field: "Batch completion status",
//             oldValue: Number(batch.completion_status || 0),
//             newValue: 0,
//           });
//           changedFields.push({
//             field: "Batch completion date",
//             oldValue: batch.completion_date,
//             newValue: null,
//           });
//         }
//       }

//       changedFields.push({
//         field: "Batch Quantity",
//         oldValue: batchQty,
//         newValue: targetQty,
//       });
//     }

//     if (changes.inProgressQtyEdits) {
//       for (const [baseCol, newVal] of Object.entries(changes.inProgressQtyEdits)) {
//         const processOrder = mysqlBaseColToProcessOrder(Number(baseCol));
//         if (processOrder === null) continue;
//         const proc = processes.find((p) => Number(p.process_order) === processOrder);
//         if (!proc) continue;
//         const validatedQty = Number(newVal || 0);
//         if (validatedQty > targetQty) {
//           throw new Error(`Qty for process ${proc.process_name} exceeds allowed batch qty of ${targetQty}.`);
//         }
//         await conn.query(
//           `UPDATE processes SET current_qty = ? WHERE process_id = ?`,
//           [validatedQty, proc.process_id],
//         );
//         changedFields.push({
//           field: `Qty ${proc.process_name}`,
//           oldValue: Number(proc.current_qty || 0),
//           newValue: validatedQty,
//         });
//       }
//     }

//     if (changes.delayRemarkEdits) {
//       for (const [baseCol, newRemark] of Object.entries(changes.delayRemarkEdits)) {
//         const processOrder = mysqlBaseColToProcessOrder(Number(baseCol));
//         if (processOrder === null) continue;
//         const proc = processes.find((p) => Number(p.process_order) === processOrder);
//         if (!proc) continue;
//         await conn.query(
//           `UPDATE processes SET process_delay_remark = ? WHERE process_id = ?`,
//           [String(newRemark || "").trim(), proc.process_id],
//         );
//         changedFields.push({ field: `Delay remark ${proc.process_name}`, oldValue: proc.process_delay_remark, newValue: newRemark });
//       }
//     }

//     if (Array.isArray(changes.undoDelays) && changes.undoDelays.length > 0) {
//       for (const baseCol of changes.undoDelays) {
//         const processOrder = mysqlBaseColToProcessOrder(Number(baseCol));
//         if (processOrder === null) continue;
//         const proc = processes.find((p) => Number(p.process_order) === processOrder);
//         if (!proc) continue;
//         await conn.query(
//           `UPDATE processes SET process_delay_remark = '', process_status = '' WHERE process_id = ?`,
//           [proc.process_id],
//         );
//         changedFields.push({ field: `Undo delay ${proc.process_name}`, oldValue: proc.process_delay_remark, newValue: "" });
//       }
//     }

//     if (changes.finishDateEdits) {
//       for (const [baseCol, newDate] of Object.entries(changes.finishDateEdits)) {
//         const processOrder = mysqlBaseColToProcessOrder(Number(baseCol));
//         if (processOrder === null) continue;
//         const proc = processes.find((p) => Number(p.process_order) === processOrder);
//         if (!proc) continue;
//         const normalizedDate = mysqlNormalizeProcessDateInput(newDate);
//         await conn.query(
//           `UPDATE processes SET process_end_date = ? WHERE process_id = ?`,
//           [normalizedDate, proc.process_id],
//         );
//         changedFields.push({ field: `Finish date ${proc.process_name}`, oldValue: proc.process_end_date, newValue: normalizedDate });
//       }
//     }

//     if (changes.machineDetailEdits) {
//       for (const [baseCol, newMachine] of Object.entries(changes.machineDetailEdits)) {
//         const processOrder = mysqlBaseColToProcessOrder(Number(baseCol));
//         if (processOrder === null) continue;
//         const proc = processes.find((p) => Number(p.process_order) === processOrder);
//         if (!proc) continue;
//         await conn.query(
//           `UPDATE processes SET process_detail = ? WHERE process_id = ?`,
//           [String(newMachine || "").trim(), proc.process_id],
//         );
//         changedFields.push({ field: `Machine detail ${proc.process_name}`, oldValue: proc.process_detail, newValue: newMachine });
//       }
//     }

//     if (changes.batchRemark !== null && changes.batchRemark !== undefined) {
//       await conn.query(
//         `UPDATE batchlisting SET new_batch_remark = ? WHERE batch_id = ?`,
//         [String(changes.batchRemark || "").trim(), batch.batch_id],
//       );
//       changedFields.push({ field: "Batch remark", oldValue: batch.new_batch_remark, newValue: changes.batchRemark });
//     }

//     if (changes.completedDateEdit !== null && changes.completedDateEdit !== undefined) {
//       const normalizedDate = mysqlNormalizeProcessDateInput(changes.completedDateEdit);
//       await conn.query(
//         `UPDATE batchlisting SET completion_date = ? WHERE batch_id = ?`,
//         [normalizedDate, batch.batch_id],
//       );
//       changedFields.push({ field: "Completed date", oldValue: batch.completion_date, newValue: normalizedDate });
//     }

//     if (changes.sequenceEdited && Array.isArray(changes.newSequence)) {
//       await mysqlApplySequenceEdits(conn, batch, processes, changes.newSequence);
//       changedFields.push({ field: "Process Sequence", oldValue: "Original sequence", newValue: "Updated sequence" });
//     }

//     await conn.commit();

//     if (changedFields.length > 0) {
//       await addAuditLogEntry({
//         timestamp: new Date().toISOString(),
//         account: resolveAuditAccount(actor),
//         action: "UPDATE",
//         module: "BatchListing",
//         identifier: batch.batch_id,
//         changeSummary: `Admin batch changes saved for ${batch.batch_id}`,
//         dataPayload: {
//           source: "mysqlAdminBatchEdit",
//           batchId: batch.batch_id,
//           psn: batch.job_psn,
//           changes,
//           changedFields,
//         },
//       });
//     }

//     return { success: true, batchId: batch.batch_id, changedFieldsCount: changedFields.length };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlAdminBatchEdit] Error:", error.message || error);
//     throw error;
//   }
// }

// async function mysqlCreateSplitBatch(payload) {
//   const {
//     psn,
//     quantity,
//     processDates,
//     splitQtyMap,
//     batchRemark,
//     actor,
//     parentRow,
//     parentBatchId,
//     parentNewQty,
//   } = payload || {};

//   if (!psn || !quantity) {
//     throw new Error("PSN and quantity are required");
//   }

//   const parentIdentifier = parentBatchId || parentRow || psn;
//   const parentData = await mysqlFetchBatchWithProcesses(parentIdentifier);
//   if (!parentData) {
//     throw new Error(`Parent batch not found: ${parentIdentifier}`);
//   }

//   const parentBatch = parentData.batch;
//   const parentProcesses = parentData.processes;
//   const conn = db.promise();
//   await conn.beginTransaction();

//   try {
//     const newBatchId = await mysqlGenerateNewBatchId(parentBatch.batch_id);
//     const [insertResult] = await conn.query(
//       `INSERT INTO batchlisting (
//         batch_id,
//         job_psn,
//         batch_date,
//         batch_quantity,
//         completion_status,
//         completion_date,
//         new_batch_remark,
//         batch_active,
//         batch_status,
//         delete_remark
//       ) VALUES (?, ?, CURDATE(), ?, 0, NULL, ?, 'Active', NULL, NULL)`,
//       [
//         newBatchId,
//         parentBatch.job_psn,
//         Number(quantity),
//         batchRemark || null,
//       ],
//     );

//     const batchListingId = insertResult.insertId;
//     const newBatchQty = Number(quantity);

//     for (const proc of parentProcesses) {
//       const processOrder = Number(proc.process_order || 0);
//       const baseCol = mysqlProcessOrderToBaseCol(processOrder);
//       const currentQty = Number(splitQtyMap?.[baseCol] || 0);
//       const expectedDateCandidate = processDates?.[String(baseCol)] || processDates?.[String(processOrder)] || proc.process_expected_date || null;
//       const expectedDate = mysqlNormalizeProcessDateInput(expectedDateCandidate);
//       const processComplete = currentQty > 0 && Number(proc.process_complete) === 1 ? 1 : 0;
//       const processStatus = processComplete ? String(proc.process_status || "").trim() : "";
//       const processEndDate = processComplete ? proc.process_end_date || null : null;
//       const processDuration = processComplete ? Number(proc.process_duration || 0) : 0;

//       await conn.query(
//         `INSERT INTO processes (
//           batch_id,
//           batchlisting_id,
//           process_order,
//           process_name,
//           process_expected_date,
//           process_end_date,
//           process_duration,
//           process_detail,
//           process_status,
//           process_delay_remark,
//           process_in_progress_remark,
//           process_revert_remark,
//           process_complete,
//           current_qty,
//           max_qty,
//           process_active
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
//         [
//           newBatchId,
//           batchListingId,
//           processOrder,
//           proc.process_name,
//           expectedDate,
//           processEndDate,
//           processDuration,
//           proc.process_detail || null,
//           processStatus,
//           proc.process_delay_remark || null,
//           proc.process_in_progress_remark || null,
//           proc.process_revert_remark || null,
//           processComplete,
//           currentQty,
//           newBatchQty,
//         ],
//       );
//     }

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor),
//       action: "SPLIT",
//       module: "BatchListing",
//       identifier: newBatchId,
//       changeSummary: `Created split batch ${newBatchId} from ${parentBatch.batch_id}`,
//       dataPayload: {
//         source: "mysqlCreateSplitBatch",
//         parentBatchId: parentBatch.batch_id,
//         newBatchId,
//         psn: parentBatch.job_psn,
//         splitQtyMap,
//         batchRemark,
//       },
//     });

//     await conn.commit();
//     return { success: true, newBatchId };
//   } catch (error) {
//     await conn.rollback();
//     console.error("[mysqlCreateSplitBatch] Error:", error.message || error);
//     throw error;
//   }
// }

// //Global unhandled error safety net
// process.on("uncaughtException", (err) => {
//   serverLogger.serverError(err);
//   serverLogger.error("UNCAUGHT_EXCEPTION", { message: err.message, stack: err.stack });
//   process.exit(1);
// });

// //Global unhandled error safety net
// process.on("unhandledRejection", (reason) => {
//   serverLogger.error("UNHANDLED_REJECTION", {
//     message: reason?.message || String(reason),
//     stack: reason?.stack,
//   });
// });

// function isValidEmail(value) {
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
// }

// function isValidPhone(value) {
//   return /^\+?[0-9\s\-().]{7,20}$/.test(String(value || "").trim());
// }

// function isStrongPassword(value) {
//   return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
//     value,
//   );
// }

// // // DATABASE 
// // NEW DATABASE FUNCTION - Main function to generate dashboard data by fetching and processing BatchListing and JobListing tables from the database, creating a structured representation of batches with their associated job info and process steps for frontend consumption
// async function generateDashboardData() {
//   const dashboardQuery = `
//     SELECT
//       j.job_id,
//       j.job_psn,
//       j.job_piNumber,
//       j.job_salesCode,
//       j.job_name,
//       j.job_type,
//       j.job_quantity,
//       j.job_orderDate,
//       j.job_deliveryDate,
//       j.job_item,
//       j.job_priority,
//       j.job_status,
//       j.job_remainingqty,
//       j.job_balanceToDelivery,
//       j.job_partialDelivery,
//       j.job_totalDelivery,
//       j.job_active,
//       b.batch_id,
//       b.batch_date,
//       b.batch_quantity,
//       b.completion_status,
//       b.completion_date,
//       b.new_batch_remark,
//       b.batch_active,
//       p.process_id,
//       p.process_order,
//       p.process_name,
//       p.process_expected_date,
//       p.process_end_date,
//       p.process_duration,
//       p.process_detail,
//       p.process_status,
//       p.process_delay_remark,
//       p.process_in_progress_remark,
//       p.process_revert_remark,
//       p.process_complete,
//       p.current_qty,
//       p.max_qty,
//       p.process_active
//     FROM batchlisting b
//     INNER JOIN joblisting j ON j.job_psn = b.job_psn
//     LEFT JOIN processes p
//       ON p.batch_id = b.batch_id
//       AND COALESCE(p.process_active, 'Active') = 'Active'
//     WHERE COALESCE(j.job_active, 'Active') = 'Active'
//       AND COALESCE(b.batch_active, 'Active') = 'Active'
//     ORDER BY b.batch_date ASC, b.batch_id ASC, p.process_order ASC, p.process_id ASC
//   `;

//   const [rows] = await db.promise().query(dashboardQuery);
//   const batchMap = new Map();
//   const jobPsnSet = new Set();
//   const psnStatusMap = new Map();
//   let nextRowIndex = 0;

//   rows.forEach((row) => {
//     const psn = String(row.job_psn || "").trim();
//     const batchId = String(row.batch_id || "").trim();
//     if (!psn || !batchId) return;

//     jobPsnSet.add(psn);

//     if (!batchMap.has(batchId)) {
//       const psnStatusEntry = psnStatusMap.get(psn) || {
//         totalBatches: 0,
//         completedBatches: 0,
//         deliveryDate: row.job_deliveryDate,
//         fallbackStatus: row.job_status,
//       };
//       psnStatusEntry.totalBatches += 1;
//       if (Number(row.completion_status) === 1) {
//         psnStatusEntry.completedBatches += 1;
//       }
//       psnStatusMap.set(psn, psnStatusEntry);

//       batchMap.set(batchId, {
//         row: nextRowIndex++,
//         psn,
//         batchId,
//         batchDate: displayDate(row.batch_date) || "-",
//         jobName: String(row.job_name || ""),
//         qty: Number(row.batch_quantity || 0),
//         progress: 0,
//         steps: [],
//         activeStepStatus: "",
//         piNumber: row.job_piNumber || "-",
//         salesCode: row.job_salesCode || "-",
//         clientName: row.job_name || "-",
//         jobType: row.job_type || "-",
//         orderDate: displayDate(row.job_orderDate) || "-",
//         priority: row.job_priority || "Normal",
//         deliveryDate: displayDate(row.job_deliveryDate) || "-",
//         status: "",
//         remainingQty: Number(row.job_remainingqty || 0),
//         partialDelivery: Number(row.job_partialDelivery || 0),
//         balanceToDelivery: Number(row.job_balanceToDelivery || 0),
//         totalDelivery: Number(row.job_totalDelivery || 0),
//         Item: row.job_item || "-",
//         splitRemark: row.new_batch_remark ? String(row.new_batch_remark) : "",
//         qtyString: "",
//         maxQtyString: "",
//         _qtyPairs: [],
//         _maxQtyPairs: [],
//         _doneStepCount: 0,
//       });
//     }

//     if (!row.process_id) return;

//     const batch = batchMap.get(batchId);
//     const processOrder = Number(row.process_order || 0);
//     const baseCol = 6 + Math.max(0, processOrder - 1) * 9;
//     const isDone =
//       row.process_complete === 1 ||
//       row.process_complete === true ||
//       String(row.process_complete).toUpperCase() === "TRUE";

//     const step = {
//       name: String(row.process_name || "").trim(),
//       expDate: displayDate(row.process_expected_date) || "-",
//       rawExpDate: row.process_expected_date
//         ? new Date(row.process_expected_date).getTime()
//         : null,
//       endDate: displayDate(row.process_end_date) || "-",
//       duration:
//         row.process_duration === null || row.process_duration === undefined
//           ? 0
//           : Number(row.process_duration || 0),
//       detail: String(row.process_detail || ""),
//       status: String(row.process_status || ""),
//       inProgressRemark: String(row.process_in_progress_remark || ""),
//       remark: String(row.process_delay_remark || ""),
//       revertRemark: String(row.process_revert_remark || ""),
//       isDone,
//       baseCol,
//     };

//     batch.steps.push(step);
//     batch._qtyPairs.push(`${baseCol}:${Number(row.current_qty || 0)}`);
//     batch._maxQtyPairs.push(
//       `${baseCol}:${Number(row.max_qty || row.batch_quantity || 0)}`,
//     );

//     if (isDone) {
//       batch._doneStepCount += 1;
//     } else if (!batch.activeStepStatus) {
//       batch.activeStepStatus = step.status;
//     }
//   });

//   const batches = Array.from(batchMap.values()).map((batch) => {
//     const psnStatusEntry = psnStatusMap.get(batch.psn);
//     const stepCount = Array.isArray(batch.steps) ? batch.steps.length : 0;
//     batch.progress = stepCount > 0 ? batch._doneStepCount / stepCount : 0;
//     batch.qtyString = batch._qtyPairs.length ? batch._qtyPairs.join("|") : "0";
//     batch.maxQtyString = batch._maxQtyPairs.length
//       ? batch._maxQtyPairs.join("|")
//       : "0";
//     batch.status =
//       psnStatusEntry &&
//         psnStatusEntry.totalBatches > 0 &&
//         psnStatusEntry.totalBatches === psnStatusEntry.completedBatches
//         ? "COMPLETED"
//         : calculateDashboardStatus(
//           psnStatusEntry?.deliveryDate,
//           psnStatusEntry?.fallbackStatus,
//         );
//     delete batch._qtyPairs;
//     delete batch._maxQtyPairs;
//     delete batch._doneStepCount;
//     return batch;
//   });

//   const processList = [
//     "Attach Handle",
//     "Baseboard",
//     "Blind Emboss",
//     "Convert",
//     "Die-cut",
//     "Double-Side-Tape",
//     "Efluting",
//     "Emboss",
//     "FlexoSlitting",
//     "Gluing",
//     "Hotstamping",
//     "Lamination",
//     "Packing",
//     "Peeling",
//     "Printing",
//     "Punch Hole",
//     "Rivet",
//     "Sheeting",
//     "Slitting",
//     "Slitting LF",
//     "Spot UV",
//     "Texture",
//     "Tie String",
//     "Trimming",
//     "Varnish",
//     "Waterbase",
//     "Side Glue",
//     "2 Point Glue",
//     "4 Point Glue",
//   ];

//   const processStats = {};
//   processList.forEach((processName) => {
//     processStats[processName] = {
//       name: processName,
//       totalTime: 0,
//       count: 0,
//       activeCount: 0,
//     };
//   });

//   batches.forEach((batch) => {
//     if (!Array.isArray(batch.steps)) return;

//     batch.steps.forEach((step) => {
//       if (!step.isDone || !processStats[step.name]) return;
//       const durationDays = Math.max(1, Math.ceil(Number(step.duration) || 0));
//       processStats[step.name].totalTime += durationDays;
//       processStats[step.name].count += 1;
//     });

//     const currentStep = batch.steps.find((step) => !step.isDone);
//     if (currentStep && processStats[currentStep.name]) {
//       const durationDays = Math.max(
//         1,
//         Math.ceil(Number(currentStep.duration) || 0),
//       );
//       processStats[currentStep.name].totalTime += durationDays;
//       processStats[currentStep.name].count += 1;
//       processStats[currentStep.name].activeCount += 1;
//     }
//   });

//   const averages = Object.values(processStats).map((stat) => ({
//     name: stat.name,
//     avgTime: stat.count > 0 ? Math.ceil(stat.totalTime / stat.count) : 0,
//     activeCount: stat.activeCount,
//   }));

//   const machineCapacityMap = {};
//   batches.forEach((batch) => {
//     if (!Array.isArray(batch.steps)) return;

//     batch.steps.forEach((step) => {
//       if (!step.isDone || !step.endDate || step.endDate === "-") return;

//       const machine = step.detail || "GENERAL";
//       const dateKey = step.endDate;
//       const key = `${dateKey}|${machine}`;

//       if (!machineCapacityMap[key]) {
//         machineCapacityMap[key] = {
//           date: dateKey,
//           machine:
//             machine === "Ijima" || machine.toLowerCase().includes("ijima")
//               ? "IJIMA"
//               : machine === "Hand" || machine.toLowerCase().includes("hand")
//                 ? "HANDSWITCH"
//                 : machine === "Out" || machine.toLowerCase().includes("out")
//                   ? "OUTSOURCED"
//                   : "GENERAL",
//           qty: 0,
//         };
//       }

//       machineCapacityMap[key].qty += Number(batch.qty || 0);
//     });
//   });

//   const rawCapacity = Object.values(machineCapacityMap);
//   const totalJobs = jobPsnSet.size;
//   const totalBatches = batches.length;
//   const totalQuantity = batches.reduce(
//     (acc, batch) => acc + (Number(batch.qty) || 0),
//     0,
//   );
//   const completedBatches = batches.filter((batch) => {
//     const status = String(batch.status || "").toLowerCase();
//     return status === "completed" || status === "done";
//   }).length;

//   const requirementUpdates = [];
//   batches.forEach((batch) => {
//     if (!Array.isArray(batch.steps) || batch.steps.length === 0) return;

//     let currentStepIndex = -1;
//     for (let i = 0; i < batch.steps.length; i++) {
//       if (!batch.steps[i].isDone) {
//         currentStepIndex = i;
//         break;
//       }
//     }
//     if (currentStepIndex === -1) return;

//     const currentStep = batch.steps[currentStepIndex];
//     const expectedDateStr = currentStep.expDate;
//     if (!expectedDateStr || expectedDateStr === "-") return;

//     const [day, month, year] = expectedDateStr.split("/").map(Number);
//     const expectedDate = new Date(year, month - 1, day);
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const diffTime = expectedDate - today;
//     const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//     if (diffDays > 2) return;

//     let duration = "";
//     if (diffDays === 0) {
//       duration = "Due today";
//     } else if (diffDays > 0) {
//       duration = `${diffDays} days left`;
//     } else {
//       duration = `Overdue ${Math.abs(diffDays)} days`;
//     }

//     let lastUpdated = "";
//     let prevDurationTime = "";
//     if (currentStepIndex > 0) {
//       const prevStep = batch.steps[currentStepIndex - 1];
//       const prevDurationStr = prevStep.endDate;
//       if (!prevDurationStr || prevDurationStr === "-") return;

//       const [prevDay, prevMonth, prevYear] = prevDurationStr
//         .split("/")
//         .map(Number);
//       const prevDuration = new Date(prevYear, prevMonth - 1, prevDay);
//       const prevDiffTime = prevDuration - today;
//       const prevDiffDays = Math.ceil(prevDiffTime / (1000 * 60 * 60 * 24));

//       prevDurationTime = `${Math.abs(prevDiffDays)}`;
//       lastUpdated = `${prevStep.name}-${prevStep.endDate}` || "";
//     } else {
//       const batchDateStr = batch.batchDate;
//       if (!batchDateStr || batchDateStr === "-") return;

//       const [batchDay, batchMonth, batchYear] = batchDateStr
//         .split("/")
//         .map(Number);
//       const batchDate = new Date(batchYear, batchMonth - 1, batchDay);
//       const batchDiffTime = today - batchDate;
//       const batchDiffDays = Math.ceil(batchDiffTime / (1000 * 60 * 60 * 24));

//       prevDurationTime = `${batchDiffDays}`;
//       lastUpdated = `Created-${batch.batchDate}`;
//     }

//     requirementUpdates.push({
//       psn: batch.psn,
//       batchId: batch.batchId,
//       jobName: batch.jobName,
//       quantity: batch.qty,
//       currentProcess: currentStep.name,
//       duration,
//       lastUpdated,
//       dueDays: diffDays,
//       isDelayed: diffDays < 0,
//       prevDurationTime,
//     });
//   });

//   return {
//     jobs: batches,
//     jobListing: batches,
//     batchListing: batches,
//     averages,
//     rawCapacity,
//     requirementUpdates,
//     stats: {
//       totalJobs,
//       totalBatches,
//       totalQuantity,
//       completedBatches,
//       pendingBatches: totalBatches - completedBatches,
//     },
//   };
// }

// function buildLegacyBatchListingRowObject(batch) {
//   const row = {};
//   row["Product Serial Number"] = batch.psn || "";
//   row["Batch ID"] = batch.batchId || "";
//   row["Batch Date"] = batch.batchDate || "";
//   row["Job Name"] = batch.jobName || "";
//   row["Quantity"] = Number(batch.qty || 0);
//   row["Batch Active"] = batch.status || "";

//   const stepByBaseCol = new Map();
//   (batch.steps || []).forEach((step) => {
//     stepByBaseCol.set(Number(step.baseCol), step);
//   });

//   const START_COL = 6;
//   const BLOCK_SIZE = 9;
//   for (let i = 0; i < 12; i++) {
//     const baseCol = START_COL + i * BLOCK_SIZE;
//     const step = stepByBaseCol.get(baseCol);
//     row[`Process ${i + 1} Name`] = step?.name || "";
//     row[`Process ${i + 1} Expected Date`] = step?.expDate || "";
//     row[`Process ${i + 1} End Date`] = step?.endDate || "";
//     row[`Process ${i + 1} Duration`] =
//       step?.duration === undefined || step?.duration === null
//         ? ""
//         : step.duration;
//     row[`Process ${i + 1} Detail`] = step?.detail || "";
//     row[`Process ${i + 1} Status`] = step?.status || "";
//     row[`Process ${i + 1} Remark`] = step
//       ? `${step.inProgressRemark || ""}|${step.remark || ""}`
//       : "";
//     row[`Process ${i + 1} Revert Remark`] = step?.revertRemark || "";
//     row[`Process ${i + 1} Done`] = step?.isDone ? "TRUE" : "FALSE";
//   }

//   row["Completion Status"] = batch.steps?.length
//     ? batch.steps.every((step) => step.isDone)
//       ? "TRUE"
//       : "FALSE"
//     : "FALSE";
//   const lastCompletedStep = [...(batch.steps || [])]
//     .filter((step) => step.isDone && step.endDate && step.endDate !== "-")
//     .pop();
//   row["Completion Date"] = lastCompletedStep?.endDate || "";
//   row["Reserved 116"] = "";
//   row["Reserved 117"] = "";
//   row["Split Remark"] = batch.splitRemark || "";
//   row["Qty String"] = batch.qtyString || "0";
//   row["Max Qty String"] = batch.maxQtyString || "0";

//   row.psn = batch.psn || "";
//   row.batchId = batch.batchId || "";
//   row.batchDate = batch.batchDate || "";
//   row.jobName = batch.jobName || "";
//   row.qty = Number(batch.qty || 0);
//   row.status = batch.status || "";
//   row.splitRemark = batch.splitRemark || "";
//   row.qtyString = batch.qtyString || "0";
//   row.maxQtyString = batch.maxQtyString || "0";

//   return row;
// }

// async function getBatchListingDataFromMySQL() {
//   const dashboardData = await generateDashboardData();
//   return (dashboardData.jobs || []).map((batch) =>
//     buildLegacyBatchListingRowObject(batch),
//   );
// }

// // API route to check PSN status (Active/Inactive/Not Found)
// app.get("/api/checkPSNStatus", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     const psn = req.query.psn ? req.query.psn.trim() : "";

//     if (!psn) {
//       return res.status(400).json({ success: false, error: "PSN is required" });
//     }

//     console.log("[API] GET /api/checkPSNStatus - checking PSN:", psn);

//     const [rows] = await db.promise().query(
//       'SELECT job_psn, job_active FROM joblisting WHERE job_psn = ?',
//       [psn]
//     );

//     if (rows.length === 0) {
//       // PSN does not exist - can create new job
//       console.log("[API] PSN not found - can create new job");
//       serverLogger.apiSuccess(req, 200, { status: "not_found" });
//       return res.json({ success: true, status: "not_found", message: "PSN is available - you can create a new job" });
//     }

//     const jobStatus = rows[0].job_active;

//     if (jobStatus === 'Active' || jobStatus === 'ACTIVE') {
//       // PSN exists and is ACTIVE - cannot create
//       console.log("[API] PSN exists and is ACTIVE - cannot create duplicate");
//       serverLogger.apiSuccess(req, 409, { status: "active" });
//       return res.status(409).json({ success: false, status: "active", error: "PSN already exists and is active. Cannot create duplicate." });
//     } else {
//       // PSN exists but is INACTIVE - can create new job
//       console.log("[API] PSN exists but is INACTIVE - can create new job");
//       serverLogger.apiSuccess(req, 200, { status: "inactive" });
//       return res.json({ success: true, status: "inactive", message: "PSN previously deleted. You can create a new job with this PSN." });
//     }
//   } catch (error) {
//     console.error("[API] GET /api/checkPSNStatus - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to check PSN status" });
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/batchListing ============
// app.get("/api/batchListing", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] GET /api/batchListing (MySQL)");
//     const data = await getBatchListingDataFromMySQL();
//     serverLogger.dataRead("batchlisting", data.length);
//     serverLogger.apiSuccess(req, 200, { rowCount: data.length });
//     res.json(data);
//   } catch (error) {
//     console.error("[API] GET /api/batchListing (MySQL) - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ error: "Failed to load BatchListing" });
//   }
// });

// // NEW DATABASE FUNCTION FOR ARCHIVE
// app.get("/api/archiveJobListing", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] GET /api/archiveJobListing - Database");
//     const [rows] = await db.promise().query(
//       `SELECT *
//        FROM joblisting
//        WHERE job_active = 'Inactive'
//        ORDER BY job_id DESC`
//     );
//     serverLogger.dataRead("joblisting (archived)", rows.length);
//     serverLogger.apiSuccess(req, 200, { rowCount: rows.length });
//     res.json(rows);
//   } catch (error) {
//     console.error("[API] GET /api/archiveJobListing - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ error: "Failed to load archived jobs" });
//   }
// });

// // NEW DATABASE FUNCTION FOR ARCHIVE
// app.get("/api/archiveBatchListing", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] GET /api/archiveBatchListing - Database");
//     const [rows] = await db.promise().query(
//       `SELECT
//          b.*,
//          (
//            SELECT j.job_name
//            FROM joblisting j
//            WHERE j.job_psn = b.job_psn
//            ORDER BY CASE WHEN COALESCE(j.job_active, 'Active') = 'Active' THEN 0 ELSE 1 END, j.job_id DESC
//            LIMIT 1
//          ) AS archived_job_name
//        FROM batchlisting b
//        WHERE b.batch_active = 'Inactive'
//        ORDER BY b.batch_date DESC, b.batch_id DESC`
//     );
//     serverLogger.dataRead("batchlisting (archived)", rows.length);
//     serverLogger.apiSuccess(req, 200, { rowCount: rows.length });
//     res.json(rows);
//   } catch (error) {
//     console.error("[API] GET /api/archiveBatchListing - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ error: "Failed to load archived batches" });
//   }
// });

// // // NEW DATABASE CODE FOR MIGRATION
// app.post("/api/register", async (req, res) => {
//   console.log("HI am here");
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/register - request received");
//     const { email, password, confirmPassword, phone, user_name, job_title } = req.body;

//     if (!email || !password || !confirmPassword || !phone || !user_name) {
//       return res
//         .status(400)
//         .json({ success: false, error: "Please complete all fields." });
//     }
//     if (!isValidEmail(email)) {
//       return res
//         .status(400)
//         .json({ success: false, error: "Please enter a valid email address." });
//     }
//     if (!isValidPhone(phone)) {
//       return res
//         .status(400)
//         .json({ success: false, error: "Please enter a valid phone number." });
//     }
//     if (password !== confirmPassword) {
//       return res
//         .status(400)
//         .json({ success: false, error: "Passwords do not match." });
//     }
//     if (!isStrongPassword(password)) {
//       return res.status(400).json({
//         success: false,
//         error:
//           "Password must be at least 8 characters long and include uppercase, lowercase, number, and symbol.",
//       });
//     }

//     const normalizedEmail = String(email).trim().toLowerCase();
//     const [rows] = await db.promise().query('SELECT COUNT(*) as count FROM `user` WHERE user_email = ? AND user_active = ?', [normalizedEmail, 'Active']);
//     if (rows[0].count > 0) {
//       return res
//         .status(409)
//         .json({ success: false, error: "This email is already registered." });
//     }

//     // Get next user_id
//     const [idRows] = await db.promise().query('SELECT MAX(user_id) as maxId FROM `user`');
//     const nextId = (idRows[0].maxId || 0) + 1;
//     const hashedPassword = await bcrypt.hash(password, 10);
//     await db.promise().query(
//       'INSERT INTO `user` (user_id, user_email, user_name, user_jobtitle, user_password, user_phone, user_role, user_created_date, user_active) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
//       [nextId, email.trim(), user_name.trim(), (job_title || '').trim(), hashedPassword, phone.trim(), 'User', 'Active']
//     );

//     res.json({ success: true, message: "Registration successful." });
//   } catch (error) {
//     console.error("[API] POST /api/register - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Registration failed." });
//   }
// });

// // // NEW DATABASE CODE FOR MIGRATION
// app.post("/api/updateUser", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/updateUser - request received");
//     const { user_id, user_name, job_title, password, actor } = req.body;

//     if (!user_id) {
//       return res
//         .status(400)
//         .json({ success: false, error: "User ID is required." });
//     }

//     // Get user from database
//     const [rows] = await db.promise().query('SELECT * FROM `user` WHERE user_id = ?', [user_id]);
//     if (rows.length === 0) {
//       return res.status(404).json({ success: false, error: "User not found." });
//     }
//     const user = rows[0];

//     const passwordChanged = !!password;

//     // Prepare updates
//     const updates = {};
//     if (user_name !== undefined) updates.user_name = user_name;
//     if (job_title !== undefined) updates.user_jobtitle = job_title;
//     if (passwordChanged) {
//       updates.user_password = await bcrypt.hash(password, 10);
//     }

//     // Build after-user object for diff (exclude password from diff)
//     const afterUser = { ...user };
//     if (user_name !== undefined) afterUser.user_name = user_name;
//     if (job_title !== undefined) afterUser.user_jobtitle = job_title;

//     // Update database
//     let query = 'UPDATE `user` SET ';
//     const params = [];
//     const setParts = [];
//     if (updates.user_name !== undefined) {
//       setParts.push('user_name = ?');
//       params.push(updates.user_name);
//     }
//     if (updates.user_jobtitle !== undefined) {
//       setParts.push('user_jobtitle = ?');
//       params.push(updates.user_jobtitle);
//     }
//     if (updates.user_password !== undefined) {
//       setParts.push('user_password = ?');
//       params.push(updates.user_password);
//     }
//     if (setParts.length === 0) {
//       return res.status(400).json({ success: false, error: "No fields to update." });
//     }
//     query += setParts.join(', ') + ' WHERE user_id = ?';
//     params.push(user_id);
//     await db.promise().query(query, params);

//     // -- Audit log --------------------------------------------------------------
//     const auditDiff = buildUserAuditDiff(user, afterUser, passwordChanged);

//     // Build change summary
//     const profileFields = auditDiff.changedFields.filter(
//       (f) => f.field !== "Password",
//     );
//     const summaryParts = [];
//     if (profileFields.length > 0)
//       summaryParts.push(profileFields.map((f) => f.display).join("; "));
//     if (passwordChanged) summaryParts.push("Password changed");
//     const changeSummary = summaryParts.join("; ") || "No changes";

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor) || String(user.user_email || user_id),
//       action: "UPDATE",
//       module: "Accounts",
//       identifier: String(user_id),
//       changeSummary,
//       dataPayload: {
//         source: "updateUser",
//         userId: user_id,
//         changedFields: auditDiff.changedFields,
//         passwordChanged,
//         old_data: {
//           user_name: user.user_name || "",
//           user_jobtitle: user.user_jobtitle || "",
//           user_email: user.user_email || "",
//         },
//         new_data: {
//           user_name: afterUser.user_name || "",
//           user_jobtitle: afterUser.user_jobtitle || "",
//           user_email: afterUser.user_email || "",
//         },
//       },
//     });
//     // --------------------------------------------------------------------------

//     res.json({ success: true, message: "User updated successfully." });
//   } catch (error) {
//     console.error("[API] POST /api/updateUser - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to update user." });
//   }
// });

// // NEW DATABASE CODE FOR MIGRATION
// app.post("/api/login", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/login - request received");
//     const { email, username, password } = req.body;
//     console.log("Received login request for:", email || username);
//     // Accept either email or username
//     const credential = email || username;
//     serverLogger.authAttempt(credential);

//     if (!credential || !password) {
//       return res.status(400).json({
//         success: false,
//         error: "Email/username and password are required.",
//       });
//     }

//     const normalizedCredential = String(credential).trim().toLowerCase();
//     const [rows] = await db.promise().query('SELECT * FROM `user` WHERE (user_email = ? OR user_name = ?) AND user_active = ?', [normalizedCredential, normalizedCredential, 'Active']);
//     if (rows.length === 0) {
//       serverLogger.authFail(credential, "User not found or inactive");
//       logToSeq("warn", {
//         action: "LOGIN_FAILED",
//         module: "Auth",
//         reason: "User not found or inactive",
//         identifier: normalizedCredential,
//       });
//       return res
//         .status(401)
//         .json({ success: false, error: "Invalid email/username or password." });
//     }

//     const user = rows[0];
//     const passwordMatch = await bcrypt.compare(password, user.user_password);
//     if (!passwordMatch) {
//       serverLogger.authFail(credential, "Incorrect password");
//       logToSeq("warn", {
//         action: "LOGIN_FAILED",
//         module: "Auth",
//         reason: "Incorrect password",
//         identifier: normalizedCredential,
//       });
//       return res
//         .status(401)
//         .json({ success: false, error: "Invalid email/username or password." });
//     }

//     const publicUser = {
//       user_id: user.user_id,
//       user_email: user.user_email,
//       user_phone: user.user_phone,
//       user_name: user.user_name || "",
//       job_title: user.user_jobtitle || "",
//       role: user.user_role || "User",
//       active: user.user_active || "Active",
//     };

//     try {
//       await db.promise().query('UPDATE `user` SET user_last_login = NOW() WHERE user_id = ?', [user.user_id]);
//     } catch (updateError) {
//       console.error(
//         "[API] Login succeeded but failed to update last_login:",
//         updateError,
//       );
//     }

//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account:
//         publicUser.user_email || publicUser.user_name || normalizedCredential,
//       action: "LOGIN",
//       module: "Auth",
//       identifier: publicUser.user_id || normalizedCredential,
//       changeSummary: `User logged in: ${publicUser.user_email || publicUser.user_name || normalizedCredential}`,
//       dataPayload: {
//         userId: publicUser.user_id || "",
//         email: publicUser.user_email || "",
//         username: publicUser.user_name || "",
//         role: publicUser.role || "User",
//       },
//     });

//     serverLogger.authSuccess(credential, publicUser.role, publicUser.user_id);
//     serverLogger.apiSuccess(req, 200, {
//       userId: publicUser.user_id,
//       role: publicUser.role,
//     });

//     res.json({ success: true, user: publicUser });
//     logToSeq("info", {
//       action: "LOGIN_SUCCESS",
//       module: "Auth",
//       userId: publicUser.user_id,
//       email: publicUser.user_email,
//       username: publicUser.user_name,
//       role: publicUser.role,
//     });
//   } catch (error) {
//     console.log("Hi i am here");
//     console.error("[API] POST /api/login - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Login failed." });
//   }
// });

// // // DATABASE VERSION - COMMENTED OUT
// app.delete("/api/users/:user_id", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] DELETE /api/users/:user_id - request received");
//     const { user_id } = req.params;
//     const { actor } = req.body;

//     if (!user_id) {
//       return res.status(400).json({ success: false, error: "User ID is required." });
//     }

//     // Get user from database
//     const [rows] = await db.promise().query('SELECT * FROM `user` WHERE user_id = ?', [user_id]);
//     if (rows.length === 0) {
//       return res.status(404).json({ success: false, error: "User not found." });
//     }
//     const user = rows[0];

//     // Delete from database
//     await db.promise().query('UPDATE `user` SET user_active = ? WHERE user_id = ?', ['Inactive', user_id]);

//     // Audit log
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(actor) || "Admin",
//       action: "DELETE",
//       module: "Accounts",
//       identifier: String(user_id),
//       changeSummary: `User deleted: ${user.user_email || user.user_name || user_id}`,
//       dataPayload: {
//         source: "deleteUser",
//         userId: user_id,
//         deletedUser: {
//           user_id: user.user_id,
//           user_email: user.user_email,
//           user_name: user.user_name,
//           role: user.role
//         }
//       },
//     });

//     serverLogger.apiSuccess(req, 200);
//     res.json({ success: true, message: "User deleted successfully." });
//   } catch (error) {
//     console.error("[API] DELETE /api/users/:user_id - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to delete user." });
//   }
// });

// //NEW DATABASE (MYSQL) CODE FOR GETTING USERS - REPLACES OLD SHAREPOINT CODE
// app.get("/api/users", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] GET /api/users - request received");
//     const connection = db.promise();
//     const [rows] = await connection.query(
//       `SELECT user_id, user_email, user_phone, user_name, user_jobtitle, user_role, user_created_date, user_last_login, user_active AS active
//        FROM \`user\`
//        WHERE user_active = 'Active'`
//     );

//     serverLogger.dataRead("user", rows.length);
//     serverLogger.apiSuccess(req, 200, { rowCount: rows.length });
//     res.json({ success: true, users: rows });
//   } catch (error) {
//     console.error("[API] GET /api/users - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to fetch users." });
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/dashboard ============
// app.get("/api/dashboard", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] GET /api/dashboard (MySQL) - request received");
//     serverLogger.dashboardStart();
//     const data = await generateDashboardData();
//     console.log("[API] GET /api/dashboard (MySQL) - sending response");
//     serverLogger.dashboardSuccess(
//       data.batchListing?.length,
//       data.jobListing?.length,
//     );
//     serverLogger.apiSuccess(req, 200, {
//       batchCount: data.batchListing?.length,
//     });
//     res.json(data);
//   } catch (error) {
//     console.error("[API] GET /api/dashboard (MySQL) - error:", error);
//     serverLogger.dashboardFail(error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ error: "Failed to load dashboard data" });
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/submitData ============
// app.post("/api/submitData", async (req, res) => {
//   serverLogger.apiRequest(req, { psn: req.body?.psn });
//   let connection = null;

//   try {
//     console.log("?? API HIT: /api/submitData (MySQL Version)");

//     const data = req.body;
//     console.log("?? Incoming data:", JSON.stringify(data, null, 2));

//     // ============ STEP 1: Validate input ============
//     if (!data || !data.psn || !data.batches) {
//       console.error("? Validation failed:", data);
//       return res.status(400).json({ success: false, error: "Invalid submit payload" });
//     }
//     if (!Array.isArray(data.batches)) {
//       console.error("? batches is not an array:", data.batches);
//       return res.status(400).json({ success: false, error: "batches must be an array" });
//     }
//     console.log("? Step 1: Validation passed");

//     // ============ STEP 2: Check for duplicate PSN ============
//     console.log("? Checking for duplicate PSN...");
//     const [existingJobs] = await db.promise().query(
//       'SELECT job_psn FROM joblisting WHERE job_psn = ? AND job_active = ?',
//       [data.psn.trim(), 'Active']
//     );

//     if (existingJobs.length > 0) {
//       console.error("? Duplicate PSN found:", data.psn);
//       return res.status(409).json({ success: false, error: "Duplicate PSN already exists" });
//     }
//     console.log("? Step 2: No duplicate PSN found");

//     // ============ STEP 3: Format dates ============
//     console.log("? Formatting dates...");
//     const orderDate = formatDateForExcel(data.orderDate) || new Date().toISOString().split('T')[0];
//     const deliveryDate = formatDateForExcel(data.deliveryDate) || new Date().toISOString().split('T')[0];
//     console.log("?? Formatted dates:", { orderDate, deliveryDate });

//     // ============ STEP 4: Begin transaction ============
//     connection = await db.promise()
//     await connection.beginTransaction();
//     console.log("? Step 4: Transaction started");

//     // ============ STEP 5: Insert into joblisting table ============
//     console.log("? Inserting into joblisting...");
//     const jobInsertQuery = `
//       INSERT INTO joblisting (
//         job_psn,
//         job_piNumber,
//         job_salesCode,
//         job_name,
//         job_type,
//         job_quantity,
//         job_orderDate,
//         job_deliveryDate,
//         job_item,
//         job_priority,
//         job_status,
//         job_remainingqty,
//         job_balanceToDelivery,
//         job_partialDelivery,
//         job_totalDelivery,
//         job_active
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//     `;

//     const jobValues = [
//       data.psn.trim(),
//       data.piNumber || "",
//       data.salesCode || "",
//       data.jobName || "",
//       data.jobType || "",
//       data.quantity || 0,
//       orderDate,
//       deliveryDate,
//       data.item || "",
//       data.priority || "Normal",
//       data.status || "ON SCHEDULE",
//       data.remaining || 0,
//       data.balanceToDelivery || data.quantity || 0,
//       data.partialDelivery || 0,
//       data.totalDelivery || 0,
//       "Active"
//     ];

//     const [jobResult] = await connection.query(jobInsertQuery, jobValues);
//     const jobId = jobResult.insertId;
//     console.log("? Step 5: Job inserted with job_id:", jobId);
//     serverLogger.dataWrite("joblisting", "INSERT", data.psn);

//     // ============ STEP 6: Insert batches and processes ============
//     console.log("? Inserting batches and processes...");
//     const batchDate = new Date().toISOString().split('T')[0];

//     for (let batchIndex = 0; batchIndex < data.batches.length; batchIndex++) {
//       const batch = data.batches[batchIndex];
//       const batchId = `${data.psn}-${batchIndex + 1}`;
//       console.log("?? Processing batch:", batchId);

//       const batchQty = batch.batchQty || 0;

//       // ---- Insert into batchlisting ----
//       const batchInsertQuery = `
//         INSERT INTO batchlisting (
//           batch_id,
//           job_psn,
//           batch_date,
//           batch_quantity,
//           completion_status,
//           batch_active
//         ) VALUES (?, ?, ?, ?, ?, ?)
//       `;

//       const batchValues = [
//         batchId,
//         data.psn.trim(),
//         batchDate,
//         batchQty,
//         0,
//         "Active"
//       ];

//       const [batchResult] = await connection.query(batchInsertQuery, batchValues);
//       const batchRowId = batchResult.insertId;
//       console.log("? Batch inserted:", batchId, "(row id:", batchRowId, ")");
//       serverLogger.dataWrite("batchlisting", "INSERT", batchId);

//       // ---- Insert processes for this batch ----
//       if (batch.steps && Array.isArray(batch.steps)) {
//         for (let stepIndex = 0; stepIndex < batch.steps.length; stepIndex++) {
//           const step = batch.steps[stepIndex];

//           const processInsertQuery = `
//             INSERT INTO processes (
//               batch_id,
//               batchlisting_id,
//               process_order,
//               process_name,
//               process_expected_date,
//               process_end_date,
//               process_duration,
//               process_detail,
//               process_status,
//               process_delay_remark,
//               process_in_progress_remark,
//               process_revert_remark,
//               process_complete,
//               current_qty,
//               max_qty,
//               process_active
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
//           `;

//           const stepExpDate = step.expDate ? formatDateForExcel(step.expDate) : deliveryDate;

//           const processValues = [
//             batchId,
//             batchRowId,
//             stepIndex + 1,
//             step.processName || "",
//             stepExpDate,
//             step.endDate ? formatDateForExcel(step.endDate) : null,
//             step.duration || null,
//             step.detail || null,
//             step.status || null,
//             step.processDelayRemark || null,
//             step.remark || null,
//             step.revertRemark || null,
//             step.isDone ? 1 : 0,
//             0,
//             batchQty,
//             "Active"
//           ];

//           await connection.query(processInsertQuery, processValues);
//           console.log(`? Process inserted: ${batchId} - ${step.processName}`);
//           serverLogger.dataWrite("processes", "INSERT", `${batchId}-${step.processName}`);
//         }
//       }
//     }

//     console.log("? Step 6: All batches and processes inserted");

//     // ============ STEP 7: Commit transaction ============
//     await connection.commit();
//     console.log("? Step 7: Transaction committed");

//     // ============ STEP 8: Add audit log entry ============
//     await addAuditLogEntry({
//       timestamp: new Date().toISOString(),
//       account: resolveAuditAccount(data.actor) || "System",
//       action: "CREATE",
//       module: "Job",
//       identifier: data.psn,
//       changeSummary: `Job created: ${data.jobName} with PSN ${data.psn}, ${data.batches.length} batch(es)`,
//       dataPayload: {
//         source: "submitData",
//         jobId: jobId,
//         psn: data.psn,
//         jobName: data.jobName,
//         quantity: data.quantity,
//         batchCount: data.batches.length,
//         batches: data.batches.map((b, idx) => ({
//           batchId: `${data.psn}-${idx + 1}`,
//           quantity: b.batchQty,
//           processCount: b.steps ? b.steps.length : 0
//         }))
//       },
//     });

//     serverLogger.apiSuccess(req, 200, {
//       psn: data.psn,
//       jobId: jobId,
//       batchCount: data.batches.length,
//     });

//     res.json({
//       success: true,
//       message: `Success! Job recorded and ${data.batches.length} batch(es) created.`,
//       data: {
//         jobId: jobId,
//         psn: data.psn,
//         batchesCreated: data.batches.length
//       }
//     });
//   } catch (error) {
//     // ============ Rollback on error ============
//     if (connection) {
//       try {
//         await connection.rollback();
//         console.log("?? Transaction rolled back due to error");
//       } catch (rollbackError) {
//         console.error("? Rollback failed:", rollbackError);
//       }
//     }

//     console.error("?? ERROR in /api/submitData:", error.message);
//     serverLogger.apiFail(req, 500, error, { psn: req.body?.psn });

//     res.status(500).json({
//       success: false,
//       error: "Failed to submit data",
//       message: error.message,
//     });
//   } finally {
//     // ============ Release connection ============
//     if (connection) {
//       await connection.release();
//     }
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/updateJobListing ============
// app.post("/api/updateJobListing", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/updateJobListing (MySQL) - request received");
//     const {
//       psn,
//       piNumber,
//       jobName,
//       quantity,
//       orderDate,
//       deliveryDate,
//       jobType,
//       item,
//       priority,
//       salesCode,
//     } = req.body;

//     if (!psn) {
//       return res.status(400).json({ success: false, error: "PSN is required" });
//     }

//     const normalizedOrderDate = orderDate
//       ? formatDateForExcel(orderDate)
//       : null;
//     const normalizedDeliveryDate = deliveryDate
//       ? formatDateForExcel(deliveryDate)
//       : null;
//     const normalizedQuantity =
//       quantity === undefined || quantity === null || quantity === ""
//         ? null
//         : Number(quantity);

//     const updateFields = {
//       job_piNumber: piNumber,
//       job_name: jobName,
//       job_quantity: normalizedQuantity,
//       job_orderDate: normalizedOrderDate,
//       job_deliveryDate: normalizedDeliveryDate,
//       job_type: jobType,
//       job_item: item,
//       job_priority: priority,
//       job_salesCode: salesCode,
//     };

//     const setClauses = [];
//     const params = [];
//     Object.entries(updateFields).forEach(([column, value]) => {
//       if (value !== undefined) {
//         setClauses.push(`${column} = ?`);
//         params.push(value);
//       }
//     });

//     if (setClauses.length === 0) {
//       return res.status(400).json({
//         success: false,
//         error: "No fields provided for update",
//       });
//     }

//     params.push(String(psn).trim(), "Active");
//     const [result] = await db.promise().query(
//       `UPDATE joblisting
//        SET ${setClauses.join(", ")}
//        WHERE job_psn = ? AND COALESCE(job_active, 'Active') = ?`,
//       params,
//     );

//     if (!result.affectedRows) {
//       return res
//         .status(404)
//         .json({ success: false, error: "Job not found with the given PSN" });
//     }

//     console.log(`[API] Successfully updated JobListing for PSN: ${psn}`);
//     serverLogger.dataWrite("joblisting", "UPDATE", psn);
//     serverLogger.apiSuccess(req, 200, { affectedRows: result.affectedRows });
//     res.json({ success: true, message: "Job details updated successfully" });
//   } catch (error) {
//     console.error("[API] POST /api/updateJobListing (MySQL) - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res
//       .status(500)
//       .json({ success: false, error: "Failed to update job details" });
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/deleteJobListing ============
// app.post("/api/deleteJobListing", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/deleteJobListing (MySQL) - request received");
//     const { psn, deleteRemark, deleteType } = req.body;
//     const remarkText = String(deleteRemark || "").trim();
//     const statusValue = String(deleteType || "Deleted").trim() || "Deleted";

//     if (!psn) {
//       return res.status(400).json({ success: false, error: "PSN is required" });
//     }
//     if (!remarkText) {
//       return res
//         .status(400)
//         .json({ success: false, error: "Delete remark is required." });
//     }

//     const connection = await db.promise();
//     await connection.beginTransaction();

//     try {
//       const [jobResult] = await connection.query(
//         `UPDATE joblisting
//          SET job_active = ?, delete_remark = ?, job_status = ?
//          WHERE job_psn = ? AND COALESCE(job_active, 'Active') = ?`,
//         ["Inactive", remarkText, statusValue, String(psn).trim(), "Active"],
//       );

//       if (!jobResult.affectedRows) {
//         await connection.rollback();
//         return res.status(404).json({ success: false, error: "Active job not found for this PSN" });
//       }

//       const [batchResult] = await connection.query(
//         `UPDATE batchlisting
//          SET batch_active = ?, delete_remark = ?, batch_status = ?
//          WHERE job_psn = ? AND COALESCE(batch_active, 'Active') = ?`,
//         ["Inactive", remarkText, statusValue, String(psn).trim(), "Active"],
//       );

//       const [processResult] = await connection.query(
//         `UPDATE processes p
//          JOIN batchlisting b ON p.batch_id = b.batch_id
//          SET p.process_active = ?, p.process_status = ?
//          WHERE COALESCE(p.process_active, 'Active') = ?
//            AND b.job_psn = ?`,
//         ["Inactive", statusValue, "Active", String(psn).trim()],
//       );

//       await connection.commit();
//       console.log(
//         `[API] Soft deleted job ${psn}, ${batchResult.affectedRows} related batch row(s), and ${processResult.affectedRows} process row(s)`,
//       );

//       serverLogger.dataWrite("joblisting", "SOFT_DELETE", psn);
//       serverLogger.dataWrite("batchlisting", "SOFT_DELETE", psn);
//       serverLogger.dataWrite("processes", "SOFT_DELETE", psn);
//       serverLogger.apiSuccess(req, 200, {
//         deletedBatchRows: batchResult.affectedRows,
//         deletedProcessRows: processResult.affectedRows,
//       });

//       res.json({
//         success: true,
//         message: `Job and related batch data archived successfully. Updated batches: ${batchResult.affectedRows}`,
//         deletedBatchRows: batchResult.affectedRows,
//         deletedProcessRows: processResult.affectedRows,
//         archivedBatchRows: batchResult.affectedRows,
//         deleteType: statusValue,
//       });
//     } catch (error) {
//       await connection.rollback();
//       throw error;
//     }
//   } catch (error) {
//     console.error("[API] POST /api/deleteJobListing (MySQL) - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to delete job" });
//   }
// });

// // ============ NEW DATABASE (MYSQL) CODE FOR /api/createBatch ============
// app.post("/api/createBatch", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/createBatch (MySQL) - request received");
//     const { psn, quantity, processDates, batchRemark } = req.body;
//     const normalizedPsn = String(psn || "").trim();
//     const newBatchQty = Number(quantity);

//     if (!normalizedPsn || !newBatchQty) {
//       return res
//         .status(400)
//         .json({ success: false, error: "PSN and quantity are required" });
//     }

//     const connection = await db.promise();
//     await connection.beginTransaction();

//     try {
//       const [jobs] = await connection.query(
//         `SELECT *
//          FROM joblisting
//          WHERE job_psn = ? AND COALESCE(job_active, 'Active') = ?
//          LIMIT 1`,
//         [normalizedPsn, "Active"],
//       );

//       if (!jobs.length) {
//         await connection.rollback();
//         return res.status(404).json({
//           success: false,
//           error: "Job not found for this PSN",
//         });
//       }

//       const job = jobs[0];
//       const currentRemaining = Number(job.job_remainingqty || 0);
//       if (newBatchQty > currentRemaining) {
//         await connection.rollback();
//         return res.status(400).json({
//           success: false,
//           error: "Add production quantity cannot exceed remaining production quantity",
//         });
//       }

//       const [latestBatchRows] = await connection.query(
//         `SELECT *
//          FROM batchlisting
//          WHERE job_psn = ? AND COALESCE(batch_active, 'Active') = ?
//          ORDER BY CAST(SUBSTRING_INDEX(batch_id, '-', -1) AS UNSIGNED) DESC, batch_id DESC
//          LIMIT 1`,
//         [normalizedPsn, "Active"],
//       );

//       if (!latestBatchRows.length) {
//         await connection.rollback();
//         return res.status(404).json({
//           success: false,
//           error: "No existing batches found for this PSN",
//         });
//       }

//       const latestBatch = latestBatchRows[0];
//       const [latestProcesses] = await connection.query(
//         `SELECT *
//          FROM processes
//          WHERE batch_id = ?
//            AND COALESCE(process_active, 'Active') = 'Active'
//          ORDER BY process_order ASC, process_id ASC`,
//         [latestBatch.batch_id],
//       );

//       const latestBatchId = String(latestBatch.batch_id || "");
//       const baseId = latestBatchId.split("-")[0];
//       const nextIdNum = Number(latestBatchId.split("-").pop() || 0) + 1;
//       const newBatchId = `${baseId}-${nextIdNum}`;

//       const [batchResult] = await connection.query(
//         `INSERT INTO batchlisting (
//           batch_id,
//           job_psn,
//           batch_date,
//           batch_quantity,
//           completion_status,
//           completion_date,
//           new_batch_remark,
//           batch_active,
//           delete_remark
//         ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?)`,
//         [
//           newBatchId,
//           normalizedPsn,
//           newBatchQty,
//           0,
//           null,
//           batchRemark ? String(batchRemark) : null,
//           "Active",
//           null,
//         ],
//       );

//       const START_COL = 6;
//       const BLOCK_SIZE = 9;
//       const processDateMap = processDates || {};

//       for (let index = 0; index < latestProcesses.length; index++) {
//         const process = latestProcesses[index];
//         const processOrder = Number(process.process_order || index + 1);
//         const baseCol = START_COL + Math.max(0, processOrder - 1) * BLOCK_SIZE;

//         let requestedDate =
//           processDateMap[index] ??
//           processDateMap[String(index)] ??
//           processDateMap[baseCol] ??
//           processDateMap[String(baseCol)] ??
//           process.process_expected_date;

//         requestedDate = requestedDate
//           ? formatDateForExcel(requestedDate)
//           : formatDateForExcel(job.job_deliveryDate);

//         const batchRowId = batchResult.insertId;

//         await connection.query(
//           `INSERT INTO processes (
//             batch_id,
//             batchlisting_id,
//             process_order,
//             process_name,
//             process_expected_date,
//             process_end_date,
//             process_duration,
//             process_detail,
//             process_status,
//             process_delay_remark,
//             process_in_progress_remark,
//             process_revert_remark,
//             process_complete,
//             current_qty,
//             max_qty,
//             process_active
//           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           [
//             newBatchId,
//             batchRowId,
//             processOrder,
//             process.process_name,
//             requestedDate,
//             null,
//             null,
//             null,
//             null,
//             null,
//             null,
//             null,
//             0,
//             0,
//             newBatchQty,
//             "Active",
//           ],
//         );
//       }

//       const updatedRemaining = Math.max(0, currentRemaining - newBatchQty);
//       await connection.query(
//         `UPDATE joblisting
//          SET job_remainingqty = ?
//          WHERE job_psn = ? AND COALESCE(job_active, 'Active') = ?`,
//         [updatedRemaining, normalizedPsn, "Active"],
//       );

//       await connection.commit();
//       console.log(`[API] Successfully created new batch: ${newBatchId}`);
//       serverLogger.dataWrite("batchlisting", "INSERT", newBatchId);
//       serverLogger.apiSuccess(req, 200, {
//         createdBatchId: newBatchId,
//       });

//       res.json({
//         success: true,
//         createdBatchId: newBatchId,
//         message: `Batch ${newBatchId} created successfully`,
//       });
//     } catch (error) {
//       await connection.rollback();
//       throw error;
//     }
//   } catch (error) {
//     console.error("[API] POST /api/createBatch (MySQL) - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ success: false, error: "Failed to create batch" });
//   }
// });

// // API to get processes for a batch (Database version use in archive)
// app.get("/api/getBatchProcesses", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     const { batchId, batchRowId } = req.query;
//     if (!batchId && !batchRowId) {
//       return res.status(400).json({ error: "batchId or batchRowId is required" });
//     }

//     let rows;
//     if (batchRowId) {
//       [rows] = await db.promise().query(
//         "SELECT * FROM processes WHERE batchlisting_id = ? ORDER BY process_order",
//         [batchRowId]
//       );
//     } else {
//       [rows] = await db.promise().query(
//         "SELECT * FROM processes WHERE batch_id = ? ORDER BY process_order",
//         [batchId]
//       );
//     }
//     res.json(rows);
//   } catch (error) {
//     console.error("[API] GET /api/getBatchProcesses - error:", error);
//     serverLogger.apiFail(req, 500, error);
//     res.status(500).json({ error: "Failed to load processes" });
//   }
// });

// app.post("/api/check-user", async (req, res) => {
//   serverLogger.apiRequest(req);
//   try {
//     console.log("[API] POST /api/check-user - request received");

//     const { user_id, email } = req.body;

//     if (!user_id || !email) {
//       return res.status(400).json({
//         success: false,
//         valid: false,
//         error: "User ID and email are required.",
//       });
//     }

//     const normalizedId = String(user_id).trim();
//     const normalizedEmail = String(email).trim().toLowerCase();

//     // MYSQL QUERY
//     const [rows] = await db.promise().query(
//       `
//       SELECT 
//         user_id,
//         user_email,
//         user_phone,
//         user_name,
//         user_jobtitle,
//         user_role,
//         user_active
//       FROM user
//       WHERE user_id = ?
//         AND LOWER(user_email) = ?
//         AND user_active = ?
//       LIMIT 1
//       `,
//       [normalizedId, normalizedEmail, "Active"]
//     );

//     // USER NOT FOUND
//     if (rows.length === 0) {
//       serverLogger.apiFail(
//         req,
//         401,
//         new Error("User not found or inactive")
//       );

//       return res.status(401).json({
//         success: false,
//         valid: false,
//         error: "Invalid or inactive user.",
//       });
//     }

//     const user = rows[0];

//     // PUBLIC USER OBJECT
//     const publicUser = {
//       user_id: user.user_id,
//       user_email: user.user_email,
//       user_phone: user.user_phone,
//       user_name: user.user_name || "",
//       job_title: user.user_jobtitle || "",
//       role: user.user_role || "User",
//       active: user.user_active || "Active",
//     };

//     serverLogger.apiSuccess(req, 200, {
//       userId: publicUser.user_id,
//     });

//     res.json({
//       success: true,
//       valid: true,
//       user: publicUser,
//     });

//   } catch (error) {
//     console.error("[API] POST /api/check-user - error:", error);

//     serverLogger.apiFail(req, 500, error);

//     res.status(500).json({
//       success: false,
//       valid: false,
//       error: "User validation failed.",
//     });
//   }
// });

app.use(quotationBackend.router);

// // ================================================= START SERVER =====================================================================================
async function startServer() {
  try {
    await quotationBackend.initializeQuotationTables();
    console.log("Quotation database tables are ready");

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      serverLogger.serverStart(PORT);
    });
  } catch (error) {
    console.error("Failed to initialize quotation database tables:", error);
    process.exitCode = 1;
  }
}

startServer();


// API route to handle user logout and log it in the AuditLog
app.post("/api/logout", async (req, res) => {
  serverLogger.apiRequest(req);
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const userId = String(req.body?.user_id || "").trim();
    serverLogger.authLogout(email, userId);
    const logoutDeviceInfo = getDeviceInfo(req);
    await addAuditLogEntry({
      timestamp: new Date().toISOString(),
      account: email || "Unknown",
      action: "LOGOUT",
      module: "Auth",
      identifier: userId || email,
      changeSummary: `User logged out: ${email || "Unknown"} via ${logoutDeviceInfo.deviceType} (${logoutDeviceInfo.browser}, ${logoutDeviceInfo.os})`,
      dataPayload: {
        userId,
        email,
        device: logoutDeviceInfo.deviceType,
        browser: logoutDeviceInfo.browser,
        os: logoutDeviceInfo.os,
        userAgent: logoutDeviceInfo.userAgent,
      },
    });
    serverLogger.apiSuccess(req, 200);
    res.json({ success: true });
  } catch (error) {
    serverLogger.apiFail(req, 500, error);
    console.error("[API] POST /api/logout - error:", error);
    res.status(500).json({ success: false, error: "Logout audit failed." });
  }
});

function calculateDashboardStatus(deliveryDate, fallbackStatus = "ON SCHEDULE") {
  const explicitStatus = String(fallbackStatus || "").trim();
  if (explicitStatus) return explicitStatus.toUpperCase();

  const parsedDate = deliveryDate ? new Date(deliveryDate) : null;
  if (!parsedDate || isNaN(parsedDate.getTime())) return "ON SCHEDULE";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsedDate.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((parsedDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "OVERDUE";
  if (diffDays <= 2) return "DUE SOON";
  return "ON SCHEDULE";
}


