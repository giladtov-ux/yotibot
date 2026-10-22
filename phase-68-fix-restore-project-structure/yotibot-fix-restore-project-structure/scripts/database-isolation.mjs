const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DENIED_LIVE_IDENTIFIERS = new Set(["helium", "heliumdb"]);
const LIVE_IDENTIFIER_PATTERN = /(?:^|[._-])(?:prod(?:uction)?|live)(?:$|[._-])/iu;

function blocked(reason) {
  return new Error(`Database connection blocked: ${reason}`);
}

function parseDatabaseTarget(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw blocked("the database target cannot be verified.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw blocked("the database target is not PostgreSQL.");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/u, "")).toLowerCase();
  } catch {
    throw blocked("the database name cannot be verified.");
  }
  if (!parsed.hostname || !databaseName) {
    throw blocked("the database host or name is missing.");
  }

  return { parsed, host: parsed.hostname.toLowerCase(), databaseName };
}

export function assertNotKnownProductionTarget(value) {
  const { host, databaseName } = parseDatabaseTarget(value);
  const identifiers = [host, databaseName];
  if (identifiers.some(identifier =>
    DENIED_LIVE_IDENTIFIERS.has(identifier) || LIVE_IDENTIFIER_PATTERN.test(identifier))) {
    throw blocked("the target matches a known Production or live identifier.");
  }
}

export function validateLocalLabDatabaseUrl(value) {
  const { parsed, host, databaseName } = parseDatabaseTarget(value);
  assertNotKnownProductionTarget(value);
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw blocked("Lab database access is restricted to a local host.");
  }
  if (!/^ah_sheli_lab(?:[-_][a-z0-9]+)*$/u.test(databaseName)) {
    throw blocked("the database name must use the dedicated ah_sheli_lab namespace.");
  }

  return value;
}

export function databaseUrlForProcess(env = process.env) {
  const isTestProcess = env.NODE_ENV === "test" || Boolean(env.NODE_TEST_CONTEXT);
  if (isTestProcess) {
    if (env.DATA_ENVIRONMENT !== "lab") {
      throw blocked("test database access requires DATA_ENVIRONMENT=lab.");
    }
    if (env.DATABASE_URL) assertNotKnownProductionTarget(env.DATABASE_URL);
    if (env.LAB_SQL_TESTS_ENABLED !== "1") {
      throw blocked("database-backed tests require explicit Lab SQL opt-in.");
    }
    if (env.REPLIT_ENVIRONMENT === "production") {
      throw blocked("tests cannot access a Production-classified runtime.");
    }
    const labUrl = env.LAB_DATABASE_URL;
    if (!labUrl || env.DATABASE_URL !== labUrl) {
      throw blocked("an explicit, matching LAB_DATABASE_URL is required.");
    }
    return validateLocalLabDatabaseUrl(labUrl);
  }

  if (env.DATA_ENVIRONMENT === "lab") {
    if (!["test", "development"].includes(env.NODE_ENV)) {
      throw blocked("Lab data access requires NODE_ENV=test or development.");
    }
    if (env.REPLIT_ENVIRONMENT === "production") {
      throw blocked("Lab data access is not allowed in a Production runtime.");
    }
    const labUrl = env.LAB_DATABASE_URL;
    if (env.DATABASE_URL) assertNotKnownProductionTarget(env.DATABASE_URL);
    if (!labUrl || env.DATABASE_URL !== labUrl) {
      throw blocked("an explicit, matching LAB_DATABASE_URL is required.");
    }
    return validateLocalLabDatabaseUrl(labUrl);
  }

  if (env.DATA_ENVIRONMENT === "staging") {
    throw blocked("Staging access is disabled until its database target is independently verified.");
  }

  if (env.DATA_ENVIRONMENT === "production") {
    if (env.NODE_ENV !== "production" || env.REPLIT_ENVIRONMENT === "development") {
      throw blocked("Production data access requires a Production runtime.");
    }
    if (!env.DATABASE_URL) {
      throw blocked("DATABASE_URL is missing for the declared Production target.");
    }
    return env.DATABASE_URL;
  }

  throw blocked("DATA_ENVIRONMENT is missing or unsupported.");
}

export function createGuardedPool(env, createPool, options) {
  const connectionString = databaseUrlForProcess(env);
  return createPool({ ...options, connectionString });
}

const SAFE_TEST_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "LANG",
  "LC_ALL",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "TERM",
];

export function createLabTestEnvironment(sourceEnv = process.env) {
  if (sourceEnv.DATABASE_URL) {
    assertNotKnownProductionTarget(sourceEnv.DATABASE_URL);
  }
  if (sourceEnv.LAB_DATABASE_URL) {
    validateLocalLabDatabaseUrl(sourceEnv.LAB_DATABASE_URL);
    throw blocked("the standard test runner is mock-only and will not receive a database URL.");
  }
  if (sourceEnv.LAB_SQL_TESTS_ENABLED === "1") {
    throw blocked("the standard test runner does not permit database-backed tests.");
  }

  const env = {};
  for (const key of SAFE_TEST_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }

  env.NODE_ENV = "test";
  env.DATA_ENVIRONMENT = "lab";

  return env;
}
