// Image MEB de datasets/Images/dataset3 (licence à confirmer), lue au moment du test,
// jamais copiée ni versionnée.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { expect, login, queryDb, readState, test } from "./fixtures";
import { REPO_DIR } from "./stack";

const FIXTURE_NAME = "Dove_men_acrylates_copolymer_microbeads_new_No0045.tif";
const FIXTURE_PATH = path.join(
  REPO_DIR,
  "datasets",
  "Images",
  "dataset3",
  "bead",
  "original_image_bead",
  FIXTURE_NAME,
);
const SHA_PREFIX = "0fba3362";
const SHA_SUFFIX = "5180";
const NO_CONSENT = "Consentement non donné : aucun export.";
const BLANK_NAME = "Rapport Résultats.png";

test.beforeEach(() => {
  test.skip(
    process.env.E2E_IMAGE_MODEL !== "present",
    "Poids du modèle d'images absents (models/c6-microscopie-i1.npz) : lancez python -m microtrace_core train-image (voir DEMARRAGE.md).",
  );
  test.skip(!existsSync(FIXTURE_PATH), `Image d'essai absente : ${FIXTURE_PATH}`);
});

function fixtureBuffer(): { buffer: Buffer; sha: string } {
  const buffer = readFileSync(FIXTURE_PATH);
  const sha = createHash("sha256").update(buffer).digest("hex");
  expect(sha.startsWith(SHA_PREFIX)).toBe(true);
  expect(sha.endsWith(SHA_SUFFIX)).toBe(true);
  return { buffer, sha };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** PNG uniforme 512 × 384, niveaux de gris 8 bits, valeur 128. */
function uniformPng(): Buffer {
  const w = 512;
  const h = 384;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 128);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Types des blocs d'un PNG, dans l'ordre. */
function pngChunks(buf: Buffer): string[] {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const types: string[] = [];
  let pos = 8;
  while (pos < buf.length) {
    types.push(buf.subarray(pos + 4, pos + 8).toString("latin1"));
    pos += 12 + buf.readUInt32BE(pos);
  }
  expect(pos).toBe(buf.length);
  return types;
}

const imagesUrl = (lab: string, study: string) => `/labo/${lab}/etudes/${study}/images`;

async function analyze(
  page: Page,
  file: { name: string; buffer: Buffer; mimeType: string },
): Promise<string> {
  // Le formulaire doit être hydraté avant de recevoir le fichier.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Image de microscopie").setInputFiles(file);
  await page.getByRole("button", { name: "Analyser l'image" }).click();
  await page.waitForURL(/\/images\/[^/]+$/);
  return new URL(page.url()).pathname;
}

const tiff = (buffer: Buffer) => ({ name: FIXTURE_NAME, buffer, mimeType: "image/tiff" });
const blank = () => ({ name: BLANK_NAME, buffer: uniformPng(), mimeType: "image/png" });

const statusBadge = (page: Page, text: string): Locator =>
  page.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${text}$`) });

const defOf = (page: Page, term: string): Locator =>
  page.locator("dt", { hasText: new RegExp(`^${term}$`) }).locator("xpath=following-sibling::dd[1]");

const num = (s: string) => Number.parseFloat(s.replace(/[\s  ]/g, "").replace(",", "."));

async function decide(page: Page, decision: string, note?: string): Promise<void> {
  await page.getByRole("radio", { name: decision, exact: true }).check();
  if (note) await page.getByLabel("Note").fill(note);
}
const save = (page: Page) => page.getByRole("button", { name: "Enregistrer la décision" }).click();

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path()) as string) };
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

test("Parcours H — onglet Images : analyse, contours, décision corrigée, comptages et journal", async ({
  page,
}) => {
  const { labA } = readState();
  const studyId = labA.studyId;
  const { buffer, sha } = fixtureBuffer();
  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/etudes/${studyId}/imports`);

  // 1. Onglet et bandeau d'essai.
  await page.getByRole("link", { name: "Images", exact: true }).click();
  await page.waitForURL(/\/images$/);
  await expect(page.getByRole("link", { name: "Images", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(statusBadge(page, "Modèle d'essai")).toHaveCount(1);
  await expect(page.getByText(/images MEB seulement/).first()).toBeVisible();
  await expect(page.getByText(/ne dit pas si une particule est un plastique/).first()).toBeVisible();
  await expect(
    page.getByText(
      "Utilisation des données validées de ce laboratoire pour améliorer les modèles : désactivée.",
      { exact: true },
    ),
  ).toBeVisible();

  // 2. Dépôt de l'image (échelle vide : lue dans le TIFF).
  analysisPath = await analyze(page, tiff(buffer));
  expect(analysisPath).toMatch(new RegExp(`^${imagesUrl(labA.labSlug, studyId)}/[^/]+$`));

  // 3. Proposition.
  await expect(statusBadge(page, "Proposition")).toHaveCount(1);
  await expect(defOf(page, "Échelle")).toContainText("0,763");
  await expect(defOf(page, "Échelle")).toContainText("lue dans l'image (MEB Hitachi)");
  await expect(defOf(page, "Bandeau du bas retiré")).toHaveText("60 px");
  const overlay = page.getByRole("img", {
    name: /^Image analysée : [12] particules? candidates? délimitées?$/,
  });
  await expect(overlay).toHaveCount(1);
  const n = Number((await overlay.getAttribute("aria-label"))!.match(/: (\d)/)![1]);
  const table = page.getByRole("table", { name: /^Particules candidates \(tailles en micromètres\)/ });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(n);
  let largest = 0;
  for (let i = 0; i < n; i++) {
    const cells = rows.nth(i).getByRole("cell");
    await expect(cells.nth(0)).toHaveText(String(i + 1));
    largest = Math.max(largest, num((await cells.nth(5).textContent()) ?? ""));
  }
  expect(largest).toBeGreaterThanOrEqual(240);
  expect(largest).toBeLessThanOrEqual(340);
  const body = (await page.locator("body").textContent()) ?? "";
  for (const forbidden of ["Jack", "Jihui", "PC-SEM"]) expect(body).not.toContain(forbidden);

  const served = await page.request.get(`${analysisPath}/image`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("image/png");
  const servedBytes = await served.body();
  pngChunks(servedBytes);
  for (const marker of ["tEXt", "eXIf", "SU5000"]) expect(servedBytes.includes(marker)).toBe(false);

  // 4. Image annotée : PNG sans métadonnées.
  const annotated = await download(page, () =>
    page.getByRole("link", { name: "Télécharger l'image annotée (PNG)", exact: true }).click(),
  );
  expect(annotated.name).toMatch(/^microtrace-image-annotee-\d{4}-\d{2}-\d{2}\.png$/);
  expect([...new Set(pngChunks(annotated.bytes))].sort()).toEqual(["IDAT", "IEND", "IHDR"]);
  expect(annotated.bytes.includes("SU5000")).toBe(false);

  // 5. Décision « Corrigée » : particule 1 en bille, une particule manquée.
  await expect(statusBadge(page, "Non examinée")).toHaveCount(1);
  await decide(page, "Corrigée", "Correction de test.");
  await page.getByRole("combobox", { name: "Forme retenue pour la particule 1" }).click();
  await page.getByRole("option", { name: "Bille", exact: true }).click();
  await page.getByLabel("Particules manquées (sans contour)").fill("1");
  await save(page);
  await expect(statusBadge(page, "Corrigée")).toHaveCount(1);
  await expect(page.getByText(`${n + 1} particules candidates validées`, { exact: true })).toBeVisible();
  await expect(page.getByText(/validées : .*1 ajoutée sans contour\./)).toBeVisible();
  await expect(page.getByText("Correction de test.", { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(statusBadge(page, "Corrigée")).toHaveCount(1);
  await expect(page.getByText(`${n + 1} particules candidates validées`, { exact: true })).toBeVisible();
  // Corriger de nouveau : le formulaire reprend la correction précédente, il ne l'annule pas.
  // La particule 1 est déjà proposée « bille » : la choisir n'est pas une correction, elle reste « Proposée ».
  await page.getByRole("radio", { name: "Corrigée", exact: true }).check();
  await expect(page.getByRole("combobox", { name: "Forme retenue pour la particule 1" })).toHaveText("Proposée : Bille");
  await expect(page.getByLabel("Particules manquées (sans contour)")).toHaveValue("1");

  await page.getByRole("link", { name: "Toutes les analyses", exact: true }).click();
  await page.waitForURL(/\/images$/);
  const counts = page.getByRole("table", {
    name: "Comptages de particules candidates des images validées",
  });
  await expect(counts.locator("tbody tr")).toHaveCount(1);
  const countCells = counts.locator("tbody tr").first().getByRole("cell");
  await expect(countCells.nth(1)).toHaveText("Corrigée");
  await expect(countCells.nth(2)).toHaveText(String(n + 1));
  const csv = await download(page, () =>
    page.getByRole("link", { name: "Télécharger les comptages (CSV)", exact: true }).click(),
  );
  const lines = csv.bytes.toString("utf8").replace(/^﻿/, "").trim().split("\r\n");
  expect(lines).toHaveLength(2);
  const header = lines[0].split(";");
  expect(lines[1].split(";")[header.indexOf("scale_source")]).toBe("metadata");
  expect(lines[1]).not.toContain(FIXTURE_NAME);

  // 6. Même fichier, même échelle vide : même analyse.
  expect(await analyze(page, tiff(buffer))).toBe(analysisPath);

  // 7. Image uniforme : abstention.
  await page.getByRole("link", { name: "Toutes les analyses", exact: true }).click();
  await page.waitForURL(/\/images$/);
  const blankPath = await analyze(page, blank());
  expect(blankPath).not.toBe(analysisPath);
  await expect(statusBadge(page, "Non fiable \\(abstention\\)")).toHaveCount(1);
  await expect(page.getByText("Aucune particule candidate détectée.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Acceptée", exact: true })).toHaveCount(0);
  await decide(page, "Rejetée", "Image vide de test.");
  await save(page);
  await expect(statusBadge(page, "Rejetée")).toHaveCount(1);
  await expect(page.getByText("Image vide de test.", { exact: true })).toHaveCount(1);
  await page.goto(imagesUrl(labA.labSlug, studyId));
  await expect(page.getByRole("link", { name: /Rapport|Résultats/ })).toHaveCount(0);

  // 8. Journal.
  await page.goto(`/labo/${labA.labSlug}/etudes/${studyId}/journal`);
  const auditRows = (label: string) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });
  await expect(auditRows("Analyse d'image enregistrée")).toHaveCount(2);
  await expect(auditRows("Décision sur une image enregistrée")).toHaveCount(2);
  await expect(auditRows("Export des comptages de particules candidates")).toHaveCount(1);

  // 9. Base et magasin.
  const [{ count }] = await queryDb<{ count: string }>(
    `select count(*) from "ModelPrediction" where kind = 'image' and "studyId" = $1`,
    [studyId],
  );
  expect(Number(count)).toBe(4);
  const stored: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else stored.push(e);
    }
  };
  const filesDir = path.join(process.env.E2E_VAR_DIR as string, "files");
  if (existsSync(filesDir)) walk(filesDir);
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.some((f) => f.includes(sha))).toBe(false);
});

test("Parcours I — isolation : un autre laboratoire ne voit ni l'analyse ni l'image", async ({
  page,
}) => {
  const { labA, labB } = readState();
  const [row] = await queryDb<{ id: string }>(
    `select id from "ModelPrediction" where "studyId" = $1 and kind = 'image' and status = 'proposed' limit 1`,
    [labA.studyId],
  );
  expect(row?.id).toBeTruthy();
  await login(page, labB.email);
  for (const url of [
    imagesUrl(labB.labSlug, labA.studyId),
    `${imagesUrl(labA.labSlug, labA.studyId)}/${row.id}`,
  ]) {
    await page.goto(url);
    await expect(page.getByText("Page introuvable", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Images", exact: true })).toHaveCount(0);
  }
  const img = await page.request.get(`${imagesUrl(labA.labSlug, labA.studyId)}/${row.id}/image`);
  expect(img.status()).toBe(404);
});

test("Parcours J — consentement : export des images consenties", async ({ page }) => {
  const { labA } = readState();
  const { buffer, sha } = fixtureBuffer();
  await login(page, labA.email);
  const exportUrl = `/labo/${labA.labSlug}/membres/export-entrainement?format=json&type=images`;

  // Sans consentement : refus.
  const refused = await page.request.get(exportUrl);
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toBe(NO_CONSENT);

  // Étude exportable : image acceptée + image non fiable rejetée ; étude simulée : image acceptée.
  await page.goto(imagesUrl(labA.labSlug, labA.exportableStudyId));
  const exportable = await analyze(page, tiff(buffer));
  const analysisId = exportable.split("/").pop() as string;
  await decide(page, "Acceptée", "Note interne de test.");
  await save(page);
  await expect(statusBadge(page, "Acceptée")).toHaveCount(1);
  await page.goto(imagesUrl(labA.labSlug, labA.exportableStudyId));
  await analyze(page, blank());
  await decide(page, "Rejetée", "Image vide de test.");
  await save(page);
  await expect(statusBadge(page, "Rejetée")).toHaveCount(1);
  await page.goto(imagesUrl(labA.labSlug, labA.simulatedStudyId));
  await analyze(page, tiff(buffer));
  await decide(page, "Acceptée");
  await save(page);
  await expect(statusBadge(page, "Acceptée")).toHaveCount(1);

  // Avec consentement : seule l'analyse de l'étude exportable (laboratoire, pseudonymisée, fiable).
  await setConsent(page, labA.labSlug, true);
  await page.goto(`/labo/${labA.labSlug}/membres`);
  const exported = await download(page, () =>
    page.getByRole("link", { name: "Exporter les images consenties (JSON)", exact: true }).click(),
  );
  const raw = exported.bytes.toString("utf8");
  const json = JSON.parse(raw) as { rows: Record<string, unknown>[] };
  expect(json.rows).toHaveLength(1);
  const r = json.rows[0];
  expect(r.analysis_id).toBe(analysisId);
  expect(r.study_id).toBe(labA.exportableStudyId);
  expect(r.study_nature).toBe("laboratory");
  expect(r.decision).toBe("accepted");
  expect(r.image_sha256).not.toBe(sha);
  expect(r).not.toHaveProperty("file_name");
  const png = Buffer.from(r.display_png_base64 as string, "base64");
  expect(pngChunks(png)).not.toContain("tEXt");
  for (const forbidden of [
    sha,
    FIXTURE_NAME,
    "Dove_men",
    BLANK_NAME,
    "Note interne de test.",
    "Image vide de test.",
  ]) {
    expect(raw).not.toContain(forbidden);
  }

  // Consentement retiré : refus.
  await setConsent(page, labA.labSlug, false);
  expect((await page.request.get(exportUrl)).status()).toBe(403);
});
