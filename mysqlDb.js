const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const useTestDatabase =
  process.env.NODE_ENV === "test" ||
  String(process.env.DB_MODE || "").trim().toLowerCase() === "test";
const prefix = useTestDatabase ? "TEST_MYSQL_DB_" : "DB_";
const setting = (name) => process.env[`${prefix}${name}`];
const requiredSettings = ["HOST", "USER", "PASSWORD", "NAME"];
const missingSettings = requiredSettings.filter((name) => !setting(name));

if (missingSettings.length) {
  throw new Error(
    `Missing MySQL configuration: ${missingSettings
      .map((name) => `${prefix}${name}`)
      .join(", ")}`,
  );
}

const port = Number(setting("PORT") || 3306);
const connectionLimit = Number(setting("CONNECTION_LIMIT") || 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DB_PORT must be an integer between 1 and 65535.");
}

if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
  throw new Error("DB_CONNECTION_LIMIT must be a positive integer.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const host = setting("HOST");
const sslCaPath = setting("SSL_CA_PATH");
const sslCa = setting("SSL_CA")?.replace(/\\n/g, "\n");

if (sslCaPath && sslCa) {
  throw new Error(`Configure either ${prefix}SSL_CA_PATH or ${prefix}SSL_CA, not both.`);
}

const sslCaCertificate = sslCaPath
  ? fs.readFileSync(path.resolve(sslCaPath), "utf8")
  : sslCa;

module.exports = mysql.createPool({
  host,
  port,
  user: setting("USER"),
  password: setting("PASSWORD"),
  database: setting("NAME"),
  connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  ...(localHosts.has(host.toLowerCase())
    ? {}
    : { ssl: sslCaCertificate ? { ca: sslCaCertificate } : {} }),
});
