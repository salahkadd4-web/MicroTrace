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

/** Le rapport affiche les mêmes libellés que l'écran : une ligne par polymère, colonne « Quantifiés/échantillons ». */
function expectReportFigures(html: string) {
  const rows = [...html.matchAll(/<tr>(.*?)<[/]tr>/g)].map((m) =>
    [...m[1].matchAll(/<td>(.*?)<[/]td>/g)].map((c) => c[1]),
  );
  for (const [label, ratio] of FIGURES) {
    const row = rows.find((r) => r.length === 3 && r[0] === label);
    expect(row, `rapport : ligne « ${label} »`).toBeTruthy();
    expect(row![2].split(" ")[0], `rapport : ${label}`).toBe(ratio);
  }
  // Les codes bruts ne sont plus la première colonne d'aucun tableau (le texte libre des issues peut les citer).
  expect(rows.filter((r) => ["PS_SUM", "ANY", "au moins un polymère"].includes(r[0]))).toEqual([]);
}

async function createExample(page: Page, button: string) {
  const { labA } = readState();
  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/projets`);
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(/\/etudes\/[^/]+\/imports/);
  return page.url().match(/\/etudes\/([^/]+)\//)![1];
}

for (const [name, ex] of Object.entries(EXAMPLES)) {
  test(`Parcours ${name}`, async ({ page }) => {
    const studyId = await createExample(page, ex.button);

    // Onglet Résultats : les six chiffres, avec les libellés français des codes moteur.
    await page.getByRole("link", { name: "Résultats" }).click();
    await page.waitForURL(/\/resultats/);
    const freq = page.getByRole("table", { name: /^Fréquences de quantification/ });
    for (const [label, ratio] of FIGURES) {
      const row = freq.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });
      await expect(row, label).toHaveCount(1);
      await expect(row.getByRole("cell").nth(2), label).toHaveText(ratio, { useInnerText: true });
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
  });
}
