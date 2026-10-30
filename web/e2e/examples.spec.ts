import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, login, queryDb, readState, test } from "./fixtures";

const FIGURES: [string, string][] = [
  ["PET", "11/22"],
  ["PS (somme)", "8/22"],
  ["PE", "5/22"],
  ["PMMA", "1/22"],
  ["PP", "0/22"],
  ["Au moins un polymère", "17/22"],
];

type Example = { button: string; simulated: boolean };
const EXAMPLES: Record<string, Example> = {
  "A — étude d'exemple fictive": {
    button: "Créer l'étude d'exemple (fictive)",
    simulated: true,
  },
  "A' — étude réelle Leslie et al. 2022": {
    button: "Créer l'étude d'exemple réelle (Leslie et al. 2022)",
    simulated: false,
  },
};

/** Le rapport nomme les polymères par leur code moteur (PS_SUM) et met « au moins un polymère » en minuscules pour ANY. */
const REPORT_CODES: Record<string, string> = { "PS (somme)": "PS_SUM", "Au moins un polymère": "au moins un polymère" };

function expectReportFigures(html: string) {
  const rows = [...html.matchAll(/<tr>(.*?)<[/]tr>/g)].map((m) =>
    [...m[1].matchAll(/<td>(.*?)<[/]td>/g)].map((c) => c[1]),
  );
  for (const [label, ratio] of FIGURES) {
    const code = REPORT_CODES[label] ?? label;
    const row = rows.find((r) => r.includes(code) && r.some((c) => c.startsWith(ratio + " ")));
    expect(row, `rapport : ${code} ${ratio}`).toBeTruthy();
  }
}

async function createExample(page: Page, button: string) {
  const { labA } = readState();
  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/projets`);
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(/\/etudes\/[^/]+\/imports/);
  await expect(page.getByText("Import enregistré.")).toBeVisible().catch(() => undefined);
  return page.url().match(/\/etudes\/([^/]+)\//)![1];
}

for (const [name, ex] of Object.entries(EXAMPLES)) {
  test(`Parcours ${name}`, async ({ page }) => {
    const { labA } = readState();
    const studyId = await createExample(page, ex.button);

    // Onglet Résultats : les six chiffres, avec les libellés français des codes moteur.
    await page.getByRole("link", { name: "Résultats" }).click();
    await page.waitForURL(/\/resultats/);
    const rows = page.getByRole("row");
    for (const [label, ratio] of FIGURES) {
      await expect(
        rows.filter({ hasText: label }).filter({ hasText: ratio }).first(),
        `${label} ${ratio}`,
      ).toBeVisible();
    }
    await expect(page.getByText("PS_SUM")).toHaveCount(0);
    await expect(page.getByText("Prototype de recherche, pas un dispositif médical").first()).toBeVisible();

    // Données de référence pour le rapport : lues en base, pas écrites en dur.
    const [run] = await queryDb<{ sha256: string; rulesVersion: string }>(
      `SELECT f."sha256", r."rulesVersion" FROM "ImportRun" r
         JOIN "DataFile" f ON f."id" = r."dataFileId"
        WHERE r."studyId" = $1 AND r."status" = 'active'`,
      [studyId],
    );
    const { sha256, rulesVersion } = run;

    // Onglet Rapport : téléchargement du HTML.
    await page.getByRole("link", { name: "Rapport" }).click();
    await page.waitForURL(/\/rapport/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Rapport HTML" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.html$/);
    const path = await download.path();
    const html = readFileSync(path, "utf8");

    expectReportFigures(html);
    expect(html).toContain(sha256);
    expect(html).toContain(rulesVersion);
    if (ex.simulated) {
      expect(html).toContain("SIMULÉ");
    } else {
      expect(html).not.toContain("SIMULÉ");
      expect(html).toContain("10.1016/j.envint.2022.107199");
      expect(html).toContain("CC BY 4.0");
    }
    expect(labA.labSlug).toBeTruthy();
  });
}
