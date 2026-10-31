// Spectre MicroPlastiX SpecDB, Lenz R. et al. (2023), doi:10.22000/1820, CC BY-SA 4.0
// (lu dans datasets/ au moment du test, jamais copié ni versionné).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, login, queryDb, readState, test } from "./fixtures";
import { REPO_DIR } from "./stack";

const FIXTURE_NAME = "VLFR_02-HDPE_nobio_Raman_dc1c0b0b.csv";
const FIXTURE_PATH = path.join(
  REPO_DIR,
  "datasets",
  "Spectres",
  "10.22000-1820",
  "data",
  "dataset",
  FIXTURE_NAME,
);
const FIXTURE_SHA = "36d2f382b66b680d8d204ab900ac0fbb6d8a93ae6bbea6495ba95dc22e57ce19";
const NO_CONSENT = "Consentement non donné : aucun export.";

const noiseCsv = () =>
  Array.from({ length: 1000 }, (_, i) => `${200 + 3 * i},${((i * 7919) % 1000) / 1000}`).join("\n");

test.beforeEach(() => {
  test.skip(
    process.env.E2E_SPECTRAL_MODEL !== "present",
    "Poids du modèle spectral absents (models/c5-spectral-s1.npz) : parcours Spectres ignorés. " +
      "Lancez python -m microtrace_core train-spectral (voir DEMARRAGE.md).",
  );
  test.skip(!existsSync(FIXTURE_PATH), `Spectre d'essai absent : ${FIXTURE_PATH}`);
});

function fixtureBuffer(): Buffer {
  const buf = readFileSync(FIXTURE_PATH);
  expect(createHash("sha256").update(buf).digest("hex")).toBe(FIXTURE_SHA);
  return buf;
}

const spectraUrl = (lab: string, study: string) => `/labo/${lab}/etudes/${study}/spectres`;

/** Dépose un spectre Raman et renvoie l'adresse de la page de l'analyse. */
async function analyze(
  page: Page,
  file: { name: string; buffer: Buffer },
  opts: { nm: boolean; laser: string },
): Promise<string> {
  // Le formulaire doit être hydraté avant de recevoir le fichier.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Fichier du spectre").setInputFiles({ ...file, mimeType: "text/csv" });
  await page.getByRole("radio", { name: "Raman", exact: true }).check();
  if (opts.nm) {
    await page.getByRole("combobox", { name: "Unité de l'axe" }).click();
    await page.getByRole("option", { name: "Longueur d'onde (nm)", exact: true }).click();
  }
  await page.getByLabel("Longueur d'onde du laser (nm)").fill(opts.laser);
  await page.getByRole("button", { name: "Analyser le spectre" }).click();
  await page.waitForURL(/\/spectres\/[^/]+$/);
  return new URL(page.url()).pathname;
}

const statusBadge = (page: Page, text: string): Locator =>
  page.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${text}$`) });

async function decide(
  page: Page,
  decision: string,
  opts: { note?: string; polymer?: string } = {},
): Promise<void> {
  await page.getByRole("radio", { name: decision, exact: true }).check();
  if (opts.polymer) {
    await page.getByRole("combobox", { name: "Polymère retenu" }).click();
    await page.getByRole("option", { name: opts.polymer, exact: true }).click();
  }
  if (opts.note) await page.getByLabel("Note").fill(opts.note);
  await page.getByRole("button", { name: "Enregistrer la décision" }).click();
}

async function exportJson(page: Page, lab: string): Promise<{ rows: Record<string, unknown>[]; text: string }> {
  await page.goto(`/labo/${lab}/membres`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Exporter les données consenties (JSON)", exact: true }).click(),
  ]);
  const text = readFileSync((await download.path()) as string, "utf8");
  return { rows: (JSON.parse(text) as { rows: Record<string, unknown>[] }).rows, text };
}

async function setConsent(page: Page, lab: string, on: boolean): Promise<void> {
  await page.goto(`/labo/${lab}/membres`);
  const label = on ? "Activer le consentement" : "Retirer le consentement";
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
  await expect(statusBadge(page, on ? "Activé" : "Désactivé")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let analysisPath = "";
let analysisId = "";

test("Parcours F — onglet Spectres : analyse, décisions, journal et consentement", async ({ page }) => {
  const { labA } = readState();
  const studyId = labA.exportableStudyId;
  const file = { name: FIXTURE_NAME, buffer: fixtureBuffer() };
  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/etudes/${studyId}/imports`);

  // 1. Onglet et bandeau d'essai.
  await page.getByRole("link", { name: "Spectres", exact: true }).click();
  await page.waitForURL(/\/spectres$/);
  await expect(page.getByRole("link", { name: "Spectres", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(statusBadge(page, "Modèle d'essai")).toHaveCount(1);
  await expect(page.getByRole("paragraph").filter({ hasText: /entraîné sur des données publiques, pas encore sur les vôtres/ })).toHaveCount(1);
  await expect(page.getByText(/n'a pas vu de particules extraites de sang/)).toBeVisible();
  await expect(page.getByText(/pas de classe non plastique dans cette version/)).toBeVisible();
  await expect(
    page.getByText("Utilisation des données validées de ce laboratoire pour améliorer les modèles : désactivée.", {
      exact: true,
    }),
  ).toBeVisible();

  // 2. Dépôt du spectre.
  analysisPath = await analyze(page, file, { nm: true, laser: "532" });
  analysisId = analysisPath.split("/").pop() as string;
  expect(analysisPath).toBe(`${spectraUrl(labA.labSlug, studyId)}/${analysisId}`);

  // 3. Proposition.
  await expect(statusBadge(page, "Identifié \\(proposition\\)")).toHaveCount(1);
  const candidates = page.getByRole("table", { name: "Polymères proposés" });
  const first = candidates.getByRole("row").nth(1).getByRole("cell");
  await expect(first.nth(0)).toHaveText("1");
  await expect(first.nth(1)).toHaveText("Polyéthylène (PE)");
  const refs = page.getByRole("table", { name: "Spectres de référence les plus proches" });
  const ref = refs.getByRole("row").nth(1).getByRole("cell");
  await expect(ref.nth(2)).toHaveText("mpx:VLFR_02-HDPE_nobio_Raman_dc1c0b0b");
  await expect(ref.nth(3)).toHaveText("Polyéthylène (PE)");
  await expect(ref.nth(4)).toHaveText("1,000");
  await expect(ref.nth(5)).toHaveText("CC BY-SA 4.0");
  await expect(ref.nth(6)).toHaveText("affichée");
  await expect(page.getByRole("img").first()).toBeVisible();
  await expect(statusBadge(page, "Non examinée")).toHaveCount(1);

  // 4. Décision « Acceptée », conservée au rechargement.
  await decide(page, "Acceptée");
  await expect(statusBadge(page, "Acceptée")).toHaveCount(1);
  await page.reload();
  await expect(statusBadge(page, "Acceptée")).toHaveCount(1);
  await expect(statusBadge(page, "Non examinée")).toHaveCount(0);

  // 5. Même fichier, mêmes réglages : même analyse.
  await page.getByRole("link", { name: "Toutes les analyses", exact: true }).click();
  await page.waitForURL(/\/spectres$/);
  expect(await analyze(page, file, { nm: true, laser: "532" })).toBe(analysisPath);
  await page.getByRole("link", { name: "Toutes les analyses", exact: true }).click();
  await page.waitForURL(/\/spectres$/);
  const listRows = page.getByRole("table", { name: "Analyses spectrales de l'étude" }).locator("tbody tr");
  await expect(listRows).toHaveCount(1);
  const cells = listRows.first().getByRole("cell");
  await expect(cells.nth(1)).toHaveText(FIXTURE_NAME);
  await expect(cells.nth(2)).toHaveText("Raman");
  await expect(cells.nth(4)).toHaveText("Polyéthylène (PE)");
  await expect(cells.nth(3)).toHaveText("Identifié (proposition)");
  await expect(cells.nth(5)).toHaveText("Acceptée");

  // 6. Bruit déterministe : abstention.
  const noisePath = await analyze(
    page,
    { name: "bruit.csv", buffer: Buffer.from(noiseCsv(), "utf8") },
    { nm: false, laser: "785" },
  );
  expect(noisePath).not.toBe(analysisPath);
  await expect(statusBadge(page, "Non identifié \\(abstention\\)")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Acceptée", exact: true })).toHaveCount(0);
  await decide(page, "Rejetée", { note: "Bruit de test." });
  await expect(statusBadge(page, "Rejetée")).toHaveCount(1);
  await expect(page.getByText("Bruit de test.", { exact: true })).toHaveCount(1);

  // 7. Journal.
  await page.goto(`/labo/${labA.labSlug}/etudes/${studyId}/journal`);
  const analysisRows = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Analyse spectrale enregistrée", exact: true }) });
  const decisionRows = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Décision spectrale enregistrée", exact: true }) });
  await expect(analysisRows).toHaveCount(2);
  await expect(decisionRows).toHaveCount(2);
  // Objet de chaque ligne (le journal affiche, pour une analyse, « technique — proposition » ;
  // pour une décision, le polymère retenu, ou « Analyse spectrale » quand il n'y en a pas).
  await expect(analysisRows.locator("td:nth-child(4)")).toHaveText([
    "Raman — aucune proposition",
    "Raman — Polyéthylène (PE)",
  ]);
  await expect(decisionRows.locator("td:nth-child(4)")).toHaveText([
    "Analyse spectrale",
    "Polyéthylène (PE)",
  ]);

  // 8. Consentement : refusé, activé, export, retiré.
  await page.goto(`/labo/${labA.labSlug}/membres`);
  await expect(statusBadge(page, "Désactivé")).toBeVisible();
  const exportUrl = `/labo/${labA.labSlug}/membres/export-entrainement?format=json`;
  const refused = await page.request.get(exportUrl);
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toBe(NO_CONSENT);

  await setConsent(page, labA.labSlug, true);
  const { rows, text } = await exportJson(page, labA.labSlug);
  expect(rows).toHaveLength(1);
  expect(rows[0].label).toBe("PE");
  expect(rows[0].decision).toBe("accepted");
  expect(rows[0].file_sha256).toBe(FIXTURE_SHA);
  expect(rows[0].analysis_id).toBe(analysisId);
  expect(rows[0].study_id).toBe(studyId);
  expect(rows[0]).not.toHaveProperty("file_name");
  expect(text).not.toContain(FIXTURE_NAME);

  await setConsent(page, labA.labSlug, false);
  const again = await page.request.get(exportUrl);
  expect(again.status()).toBe(403);
});

test("Parcours H — décision corrigée ; seules les études non simulées et pseudonymisées sont exportées", async ({ page }) => {
  const { labA } = readState();
  const file = { name: FIXTURE_NAME, buffer: fixtureBuffer() };
  await login(page, labA.email);

  // Décision « Corrigée » (autre polymère) dans l'étude exportable.
  await page.goto(spectraUrl(labA.labSlug, labA.exportableStudyId));
  const corrected = await analyze(page, file, { nm: true, laser: "785" });
  expect(corrected).not.toBe(analysisPath);
  await decide(page, "Corrigée", { polymer: "Polypropylène (PP)", note: "Correction de test." });
  await expect(statusBadge(page, "Corrigée")).toHaveCount(1);
  await expect(page.getByText("Polymère retenu : Polypropylène (PP)", { exact: true })).toBeVisible();
  await expect(page.getByText("Correction de test.", { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(statusBadge(page, "Corrigée")).toHaveCount(1);
  await expect(page.getByText("Polymère retenu : Polypropylène (PP)", { exact: true })).toBeVisible();

  // Études hors export : simulée (pseudonymisée) et non déclarée pseudonymisée.
  for (const studyId of [labA.simulatedStudyId, labA.studyId]) {
    await page.goto(spectraUrl(labA.labSlug, studyId));
    await analyze(page, file, { nm: true, laser: "532" });
    await decide(page, "Acceptée");
    await expect(statusBadge(page, "Acceptée")).toHaveCount(1);
  }

  const exportUrl = `/labo/${labA.labSlug}/membres/export-entrainement?format=json`;
  expect((await page.request.get(exportUrl)).status()).toBe(403);
  await setConsent(page, labA.labSlug, true);
  const { rows, text } = await exportJson(page, labA.labSlug);
  expect(rows.map((r) => [r.label, r.decision, r.study_id])).toEqual([
    ["PP", "corrected", labA.exportableStudyId],
    ["PE", "accepted", labA.exportableStudyId],
  ]);
  expect(rows.map((r) => r.study_nature)).toEqual(["laboratory", "laboratory"]);
  for (const r of rows) expect(r).not.toHaveProperty("file_name");
  // Aucun texte du fichier brut (ni nom, ni lignes de données).
  const rawLines = fixtureBuffer().toString("utf8").split(/\r?\n/).filter((l) => l.trim().length > 8);
  expect(text).not.toContain(FIXTURE_NAME);
  for (const line of rawLines.slice(0, 20)) expect(text).not.toContain(line.trim());

  await setConsent(page, labA.labSlug, false);
  expect((await page.request.get(exportUrl)).status()).toBe(403);
});

test("Parcours G — l'onglet Spectres d'un autre laboratoire est introuvable", async ({ page }) => {
  const { labA, labB } = readState();
  const [row] = await queryDb<{ id: string }>(
    'select id from "ModelPrediction" where "studyId" = $1 and kind = \'spectral\' limit 1',
    [labA.exportableStudyId],
  );
  expect(row?.id).toBeTruthy();
  await login(page, labB.email);
  for (const url of [
    spectraUrl(labB.labSlug, labA.studyId),
    `${spectraUrl(labA.labSlug, labA.exportableStudyId)}/${row.id}`,
  ]) {
    await page.goto(url);
    await expect(page.getByText("Page introuvable", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Spectres", exact: true })).toHaveCount(0);
    await expect(page.getByText(labA.labSlug)).toHaveCount(0);
  }
  const res = await page.request.get(`/labo/${labA.labSlug}/membres/export-entrainement?format=json`);
  expect(res.status()).toBe(404);
});
