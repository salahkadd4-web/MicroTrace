import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Même ordre que les scripts : .env.local puis .env (la première valeur trouvée l'emporte).
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
