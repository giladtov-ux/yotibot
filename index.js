import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

console.log("[Ah Sheli] Starting bot application...");

// Check potential locations for the server entry point
const targets = [
  resolve(process.cwd(), "artifacts/api-server/dist/index.js"),
  resolve(process.cwd(), "artifacts/api-server/src/index.ts"),
  resolve(process.cwd(), "src/index.ts"),
  resolve(process.cwd(), "src/index.js")
];

let started = false;

for (const target of targets) {
  if (existsSync(target)) {
    console.log(`[Ah Sheli] Found entry point at: ${target}`);
    const isTs = target.endsWith(".ts");
    const cmd = isTs ? "npx" : "node";
    const args = isTs ? ["tsx", target] : [target];
    
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
    
    child.on("exit", (code) => {
      console.log(`[Ah Sheli] Process exited with code ${code}`);
      process.exit(code ?? 0);
    });
    
    started = true;
    break;
  }
}

if (!started) {
  console.log("[Ah Sheli] Launching directly via pnpm api-server...");
  const child = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], { 
    stdio: "inherit", 
    env: process.env 
  });
  
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

module.exports = { startSystem };


