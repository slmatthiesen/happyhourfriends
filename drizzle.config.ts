import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Ignore PostGIS-managed objects (e.g. spatial_ref_sys) so drizzle-kit never
  // tries to drop them.
  extensionsFilters: ["postgis"],
  verbose: true,
  strict: true,
});
