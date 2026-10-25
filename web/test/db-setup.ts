import { startTestDb } from "./db-start";

/** Instance PostgreSQL embarquée pour les tests (jamais le service local). */
export default async function setup(): Promise<() => Promise<void>> {
  const db = await startTestDb();
  process.env.DATABASE_URL = db.url;
  return db.stop;
}
