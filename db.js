const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

/*
 * Load .env.test only when NODE_ENV=test.
 * Otherwise, load the normal .env file.
 */
const envFile =
  process.env.NODE_ENV === "test"
    ? path.join(__dirname, ".env.test")
    : path.join(__dirname, ".env");

dotenv.config({ path: envFile });

const dbMode = String(process.env.DB_MODE || "aiven")
  .trim()
  .toLowerCase();

let poolConfig;

if (dbMode === "test") {
  if (!process.env.TEST_DB_NAME) {
    throw new Error(
      "TEST_DB_NAME is required when DB_MODE=test.",
    );
  }

  /*
   * Safety check so automated tests cannot accidentally
   * use the normal local database.
   */
  if (process.env.TEST_DB_NAME !== "testingdb") {
    throw new Error(
      `Unsafe test database name: ${process.env.TEST_DB_NAME}. Expected testingdb.`,
    );
  }

  poolConfig = {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 5432),
    database: process.env.TEST_DB_NAME,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
  };
} else if (dbMode === "local") {
  poolConfig = {
    host: process.env.LOCAL_DB_HOST,
    port: Number(process.env.LOCAL_DB_PORT || 5432),
    database: process.env.LOCAL_DB_NAME,
    user: process.env.LOCAL_DB_USER,
    password: process.env.LOCAL_DB_PASSWORD,
  };
} else if (dbMode === "aiven") {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required when DB_MODE=aiven.",
    );
  }

  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else {
  throw new Error(
    `Unsupported DB_MODE: ${dbMode}. Use aiven, local, or test.`,
  );
}

// This service is shared by multiple web processes. Keep each process small so
// deploy overlap, a local instance, and administrative tools cannot exhaust the
// database's finite connection allowance. Set PG_POOL_MAX explicitly only after
// budgeting it across every running process.
const configuredPoolMax = Number(process.env.PG_POOL_MAX || 1);
poolConfig.max =
  Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : 1;
poolConfig.idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT_MS || 10000);
poolConfig.connectionTimeoutMillis = Number(
  process.env.PG_CONNECTION_TIMEOUT_MS || 10000,
);
poolConfig.maxLifetimeSeconds = Number(process.env.PG_MAX_LIFETIME_SECONDS || 300);
poolConfig.application_name =
  process.env.PG_APPLICATION_NAME || "mlm-web-app";

const pool = new Pool(poolConfig);

pool.on("connect", async (client) => {
  try {
    await client.query(
      "SET TIME ZONE 'Asia/Kuala_Lumpur'",
    );
  } catch (error) {
    console.error(
      "Failed to set database timezone:",
      error.message,
    );
  }
});

pool.on("error", (error) => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    error,
  );
});

module.exports = pool;
