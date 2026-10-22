import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "../..");

function gitValue(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function dirtyFingerprint() {
  const changed = new Set();
  for (const args of [
    ["diff", "HEAD", "--name-only", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ]) {
    const files = gitValue(args);
    for (const file of files.split("\0")) if (file) changed.add(file);
  }
  const files = [...changed].sort();
  if (files.length === 0) return null;
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0");
    try { hash.update(readFileSync(path.resolve(repoRoot, file))); }
    catch { hash.update("<deleted-or-unreadable>"); }
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

function releaseMetadata() {
  const commit = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA
    || gitValue(["rev-parse", "HEAD"])).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("A full Git commit SHA is required to produce release metadata.");
  }
  const releaseTag = gitValue(["describe", "--tags", "--exact-match", commit]) || null;
  const description = gitValue(["describe", "--tags", "--long", "--always", commit])
    || `git-${commit.slice(0, 12)}`;
  const fingerprint = dirtyFingerprint();
  const dirty = fingerprint !== null;
  const buildId = process.env.AH_SHELI_BUILD_ID?.trim()
    || `${description}${dirty ? `-dirty-${fingerprint}` : ""}`;
  return { buildId, commit, releaseTag, dirty };
}

const build = releaseMetadata();

async function buildAll() {
  // The API starts this worker as unbundled JavaScript in production. Esbuild
  // alone cannot detect broken syntax or named imports in that separate graph.
  // Import only the handler, not index.js: no polling, sends or DB writes.
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'const { handleOwnerUpdate } = await import("./src/message-handler.js");'
      + ' if (typeof handleOwnerUpdate !== "function") throw new Error("Invalid Telegram handler export");'
      + ' const { applyMiniAppAction } = await import("./src/mini-app-actions.js");'
      + ' if (typeof applyMiniAppAction !== "function") throw new Error("Invalid Mini App handler export");',
  ], {
    cwd: path.resolve(artifactDir, "../ah-sheli-bot"),
    stdio: "inherit",
  });
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });
  await esbuild({
    entryPoints: {
      "auth-client": path.resolve(artifactDir, "client/auth-entry.tsx"),
      "session-keeper": path.resolve(artifactDir, "client/session-keeper.tsx"),
    },
    bundle: true, platform: "browser", format: "esm",
    outdir: path.resolve(artifactDir, "public"),
    jsx: "automatic", minify: true, logLevel: "info",
    define: {
      "import.meta.env": JSON.stringify({
        BASE_URL: "/",
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "",
        VITE_CLERK_PROXY_URL: process.env.VITE_CLERK_PROXY_URL || "",
        VITE_CLERK_AUTH_MODE: process.env.CLERK_AUTH_MODE || "managed",
      }),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    define: {
      "process.env.AH_SHELI_BUILD_ID": JSON.stringify(build.buildId),
      "process.env.AH_SHELI_COMMIT_SHA": JSON.stringify(build.commit),
      "process.env.AH_SHELI_RELEASE_TAG": JSON.stringify(build.releaseTag),
      "process.env.AH_SHELI_BUILD_DIRTY": JSON.stringify(String(build.dirty)),
    },
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
