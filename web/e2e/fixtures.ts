import { readFileSync } from "node:fs";
import { Client } from "pg";
import { test as base, expect, type Page } from "@playwright/test";

export type LabSeed = { labSlug: string; email: string; studyId: string };
export type E2eState = { labA: LabSeed; labB: LabSeed };

export function readState(): E2eState {
  return JSON.parse(readFileSync(process.env.E2E_STATE_FILE as string, "utf8")) as E2eState;
}

/**
 * Requête de vérification sur la base du bout en bout (lecture seule). Prisma ne se charge pas
 * sous le chargeur CommonJS de Playwright (le client généré utilise import.meta) : `pg` direct.
 */
export async function queryDb<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(process.env.E2E_PASSWORD as string);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));
}

export const test = base.extend({
  baseURL: async ({ browserName: _b }, provide) => {
    void _b;
    await provide(process.env.E2E_BASE_URL);
  },
});
export { expect };
