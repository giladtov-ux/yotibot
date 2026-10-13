import { askAssistant } from "./src/assistant.server.ts";

console.log("Starting Yotibot server...");

// בדיקת תקינות הרצה בסיסית
if (typeof askAssistant === "function") {
  console.log("Yotibot assistant server loaded successfully!");
}
