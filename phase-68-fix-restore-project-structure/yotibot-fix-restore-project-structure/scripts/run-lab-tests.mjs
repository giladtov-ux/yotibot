import { spawnSync } from "node:child_process";
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

const result = spawnSync(process.execPath, args, {
  input: undefined,
  // These guard and teardown tests always run alongside the package suite.
  // The child receives no database URL, so database-backed fixtures stay skipped.
  args: undefined,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error("Lab test runner could not be started.");
  process.exit(1);
}
process.exit(result.status ?? 1);
