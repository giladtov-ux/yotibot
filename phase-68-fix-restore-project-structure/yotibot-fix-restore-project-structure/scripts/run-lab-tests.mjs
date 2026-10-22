import { spawnSync } from "node:child_process";
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
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error("Lab test runner could not be started.");
  process.exit(1);
}
process.exit(result.status ?? 1);
