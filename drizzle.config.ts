import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect:    "sqlite",
  schema:     "./src/db/schema.ts",
  out:        "./drizzle",           // migration SQL files land here
  dbCredentials: {
    url: process.env["DB_PATH"] ?? "./yieldbot.db",
  },
});
