const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function blocked(reason) {
  return new Error(`Database connection blocked: ${reason}`);
}

export function validateLocalLabDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw blocked("the Lab database URL is invalid.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw blocked("the Lab database must use PostgreSQL.");
  }
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw blocked("Lab database access is restricted to a local host.");
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw blocked("the Lab database name is missing.");
  }

  return value;
}

export function databaseUrlForProcess(env = process.env) {
  if (env.DATA_ENVIRONMENT === "lab") {
    if (!["test", "development"].includes(env.NODE_ENV)) {
      throw blocked("Lab data access requires NODE_ENV=test or development.");
    }
    if (env.REPLIT_ENVIRONMENT === "production") {
      throw blocked("Lab data access is not allowed in a Production runtime.");
    }
    const labUrl = env.LAB_DATABASE_URL;
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
  const env = {};
  for (const key of SAFE_TEST_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }

  env.NODE_ENV = "test";
  env.DATA_ENVIRONMENT = "lab";

  if (sourceEnv.LAB_DATABASE_URL) {
    const labUrl = validateLocalLabDatabaseUrl(sourceEnv.LAB_DATABASE_URL);
    env.LAB_DATABASE_URL = labUrl;
    env.DATABASE_URL = labUrl;
  }

  return env;
}
