import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLabTestEnvironment } from "./database-isolation.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: run-lab-tests.mjs <Node test-runner arguments>");
  process.exit(2);
}

let env;
try {
  env = createLabTestEnvironment(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const isolationTests = [
  fileURLToPath(new URL("./database-isolation.test.mjs", import.meta.url)),
  fileURLToPath(new URL("./lab-memory-database.test.mjs", import.meta.url)),
];
const requestedFiles = new Set(
  args.filter(argument => !argument.startsWith("-") && !argument.includes("*"))
    .map(argument => resolve(argument)),
);
const additionalIsolationTests = isolationTests.filter(path => !requestedFiles.has(path));
const result = spawnSync(process.execPath, [...args, ...additionalIsolationTests], {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error("Lab test runner could not be started.");
  process.exit(1);
}
process.exit(result.status ?? 1);
