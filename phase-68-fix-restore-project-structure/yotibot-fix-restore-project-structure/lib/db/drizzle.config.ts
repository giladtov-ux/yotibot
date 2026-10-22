import { defineConfig } from "drizzle-kit";
import path from "path";
import { databaseUrlForProcess } from "../../scripts/database-isolation.mjs";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrlForProcess(process.env),
  },
});
