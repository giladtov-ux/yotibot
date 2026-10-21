import { defineConfig } from "@playwright/test";

// Use the existing API preview, never start a bot/server from this suite.
const baseURL = process.env.DEMO_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined);
if (!baseURL) throw new Error("Set DEMO_BASE_URL to the running API preview URL.");

export default defineConfig({
  testDir: ".",
  testMatch: "demo.spec.mjs",
  outputDir: "./results",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
  use: { baseURL, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: process.env.DEMO_CHROMIUM_PATH
          ? { executablePath: process.env.DEMO_CHROMIUM_PATH } : {},
      },
    },
    {
      name: "firefox",
      grep: /keyboard accessibility/,
      use: { browserName: "firefox" },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
