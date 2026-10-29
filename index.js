import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

console.log("[Ah Sheli] Starting bot application...");

const targetPath = resolve(process.cwd(), "artifacts/api-server/src/index.ts");

if (existsSync(targetPath)) {
  console.log(`[Ah Sheli] Launching API server via tsx from: ${targetPath}`);
  const child = spawn("npx", ["tsx", targetPath], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code) => {
    console.log(`[Ah Sheli] Server process exited with code ${code}`);
    process.exit(code ?? 0);
  });
} else {
  console.log("[Ah Sheli] Fallback: Running pnpm start...");
  const child = spawn("pnpm", ["--filter", "@workspace/api-server", "start"], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

module.exports = { startSystem };


