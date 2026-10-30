import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { login, readState, test } from "./fixtures";

// Opt-in : captures pleine page des pages principales, pour une relecture visuelle.
// Les images contiennent des données d'exemple fictives ; elles ne sont jamais versionnées.
const dir = process.env.E2E_SCREENSHOTS_DIR;
test.skip(!dir, "E2E_SCREENSHOTS_DIR non défini");

const WIDTHS = [1024, 768];

test("captures des pages principales", async ({ page }) => {
  const out = dir as string;
  mkdirSync(out, { recursive: true });
  const { labA } = readState();
  const shoot = async (width: number, name: string) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${width}-${name}.png`), fullPage: true });
  };

  await page.goto("/connexion");
  for (const w of WIDTHS) await shoot(w, "connexion");

  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/projets`);
  await page.getByRole("button", { name: "Créer l'étude d'exemple (fictive)" }).click();
  await page.waitForURL(/\/etudes\/[^/]+\/imports/);
  const studyId = page.url().match(/\/etudes\/([^/]+)\//)![1];

  const pages: [string, string][] = [
    ["projets", `/labo/${labA.labSlug}/projets`],
    ["parametres", `/labo/${labA.labSlug}/etudes/${studyId}/parametres`],
    ["imports", `/labo/${labA.labSlug}/etudes/${studyId}/imports`],
    ["resultats", `/labo/${labA.labSlug}/etudes/${studyId}/resultats`],
    ["qualite", `/labo/${labA.labSlug}/etudes/${studyId}/qualite`],
    ["rapport", `/labo/${labA.labSlug}/etudes/${studyId}/rapport`],
    ["journal", `/labo/${labA.labSlug}/etudes/${studyId}/journal`],
  ];
  for (const [name, url] of pages) {
    await page.setViewportSize({ width: WIDTHS[0], height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    for (const w of WIDTHS) await shoot(w, name);
  }
});
