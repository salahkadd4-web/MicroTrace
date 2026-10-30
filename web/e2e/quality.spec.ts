import type { Locator, Page } from "@playwright/test";
import { createExample, expect, login, readState, test } from "./fixtures";

const NOTE = "Valeur confirmée par le second passage (fictif).";
const DECISION = "Examiné — justifié";

/** Cartes de signaux d'une règle de la section « Signaux » (le titre de règle précède un `ul`). */
const rule = (page: Page, title: string): Locator => page.locator(`h3:text-is("${title}") + ul > li`);
/** Une carte, désignée par l'objet de son titre « Échantillon N — polymère ». */
const card = (cards: Locator, subject: string): Locator =>
  cards.filter({
    has: cards.page().getByRole("heading", { level: 4, name: new RegExp(`^${subject} — `) }),
  });
const allCards = (page: Page) => page.locator("h3 + ul > li");
const badge = (c: Locator) =>
  c.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${DECISION}$`) });

test("Parcours D — onglet Qualité sur l'étude d'exemple fictive", async ({ page }) => {
  const studyId = await createExample(page, "Créer l'étude d'exemple (fictive)");
  const { labA } = readState();
  const base = `/labo/${labA.labSlug}/etudes/${studyId}`;

  await page.getByRole("link", { name: "Qualité", exact: true }).click();
  await page.waitForURL(/\/qualite$/);
  await expect(page.getByRole("link", { name: "Qualité", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByText(/Ces signaux sont des propositions calculées par des règles statistiques/),
  ).toBeVisible();
  await expect(page.getByText(/règles de qualité q1\)/)).toBeVisible();

  // 4 cartes, avec les chiffres du §10.
  await expect(allCards(page)).toHaveCount(4);
  const discordance = rule(page, "Discordance entre aliquotes");
  await expect(discordance).toHaveCount(2);
  const d16 = card(discordance, "Échantillon 16");
  const d12 = card(discordance, "Échantillon 12");
  await expect(d16).toHaveCount(1);
  await expect(d12).toHaveCount(1);
  await expect(d16.getByText(/écart relatif 55,9 % \(étendue \/ moyenne\)/)).toHaveCount(1);
  await expect(d12.getByText(/écart relatif 59,5 % \(étendue \/ moyenne\)/)).toHaveCount(1);

  const atypique = rule(page, "Valeur atypique");
  await expect(atypique).toHaveCount(2);
  const a16 = card(atypique, "Échantillon 16");
  const a4 = card(atypique, "Échantillon 4");
  await expect(a16).toHaveCount(1);
  await expect(a4).toHaveCount(1);
  await expect(a16.getByText(/score z modifié 20,57 /)).toHaveCount(1);
  await expect(a4.getByText(/score z modifié 7,42 /)).toHaveCount(1);
  await expect(rule(page, "Valeur proche des blancs")).toHaveCount(0);

  // Règles non appliquées : une ligne chacune.
  const notes = page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: "Règles non appliquées ou sans objet" }),
  });
  const noteItems = notes.getByRole("listitem");
  await expect(noteItems).toHaveCount(5);
  await expect(
    noteItems.filter({ hasText: /^Aucun blanc de procédure résumé n'est enregistré pour l'étude/ }),
  ).toHaveCount(1);
  await expect(
    noteItems.filter({ hasText: /^PMMA, Py-GC\/MS, sang total : 1 échantillon quantifié/ }),
  ).toHaveCount(1);
  await expect(
    noteItems.filter({ hasText: /^PP, Py-GC\/MS, sang total : 0 échantillon quantifié/ }),
  ).toHaveCount(1);
  await expect(noteItems.filter({ hasText: /le lot n'est renseigné pour aucune mesure/ })).toHaveCount(1);

  // Décision sur « Valeur atypique — Échantillon 16 ».
  await a16.getByText("Enregistrer une décision", { exact: true }).click();
  await a16.getByRole("radio", { name: DECISION, exact: true }).check();
  await a16.getByLabel("Note").fill(NOTE);
  await a16.getByRole("button", { name: "Enregistrer la décision" }).click();
  await expect(badge(a16)).toHaveCount(1);
  await expect(a16.getByText(NOTE, { exact: true })).toHaveCount(1);
  await expect(badge(a4)).toHaveCount(0);
  await expect(badge(d16)).toHaveCount(0);

  // Clé stable au rechargement.
  await page.reload();
  await expect(allCards(page)).toHaveCount(4);
  await expect(badge(card(rule(page, "Valeur atypique"), "Échantillon 16"))).toHaveCount(1);
  await expect(badge(allCards(page))).toHaveCount(1);

  // Journal.
  await page.goto(`${base}/journal`);
  const journalRows = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Décision qualité enregistrée", exact: true }) });
  await expect(journalRows).toHaveCount(1);
  await expect(
    journalRows.getByRole("cell", { name: "Valeur atypique — Échantillon 16", exact: true }),
  ).toHaveCount(1);

  // Paramètres : un blanc de procédure PET de 250 ng/mL.
  await page.goto(`${base}/parametres`);
  await page.locator("#qc-polymer").fill("PET");
  await page.locator("#qc-kind").click();
  await page.getByRole("option", { name: "Blanc de procédure", exact: true }).click();
  await page.locator("#qc-n").fill("3");
  await page.locator("#qc-mean").fill("250");
  await page.locator("#qc-unit").click();
  await page.getByRole("option", { name: "ng/mL", exact: true }).click();
  await page.locator("#qc-source").fill("Blancs fictifs");
  await page.getByRole("button", { name: "Ajouter le contrôle" }).click();
  await expect(page.getByRole("cell", { name: "Blancs fictifs", exact: true })).toHaveCount(1);

  // Qualité : 10 cartes, dont 6 « Valeur proche des blancs » ; la décision est conservée.
  await page.goto(`${base}/qualite`);
  await expect(allCards(page)).toHaveCount(10);
  const blanks = rule(page, "Valeur proche des blancs");
  await expect(blanks).toHaveCount(6);
  await expect(blanks.locator("h4")).toHaveText([
    "Échantillon 10, aliquote a — PET",
    "Échantillon 11, aliquote b — PET",
    "Échantillon 4, aliquote a — PET",
    "Échantillon 4, aliquote b — PET",
    "Échantillon 6, aliquote a — PET",
    "Échantillon 7, aliquote a — PET",
  ]);
  await expect(blanks.first().getByText(/soit 1,8 fois la moyenne des blancs de procédure/)).toHaveCount(1);
  const a16After = card(rule(page, "Valeur atypique"), "Échantillon 16");
  await expect(badge(a16After)).toHaveCount(1);
  await expect(a16After.getByText(NOTE, { exact: true })).toHaveCount(1);
  await expect(badge(allCards(page))).toHaveCount(1);

  // Imports : retrait avec motif.
  await page.goto(`${base}/imports`);
  await page.getByRole("button", { name: "Retirer", exact: true }).click();
  await page.getByLabel("Motif").fill("Fin du parcours");
  await page.getByRole("button", { name: "Retirer l'import", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retirer", exact: true })).toHaveCount(0);

  // Qualité : état vide, puis signal disparu.
  await page.goto(`${base}/qualite`);
  await expect(
    page.getByText(
      "Aucune mesure d'échantillon dans les imports actifs : importez un fichier de mesures pour voir les résultats.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Aller aux imports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Signaux disparus" })).toBeVisible();
  const gone = page.getByRole("table", { name: "Décisions dont le signal a disparu" }).locator("tbody tr");
  await expect(gone).toHaveCount(1);
  const cells = gone.getByRole("cell");
  await expect(cells.nth(0)).toHaveText("Valeur atypique");
  await expect(cells.nth(1)).toHaveText("Échantillon 16");
  await expect(cells.nth(2)).toHaveText(DECISION);
  await expect(cells.nth(3)).toHaveText(NOTE);
  await expect(cells.nth(6)).toHaveText("q1");
});

test("Parcours E — l'onglet Qualité d'un autre laboratoire est introuvable", async ({ page }) => {
  const { labA, labB } = readState();
  await login(page, labA.email);
  for (const url of [
    `/labo/${labB.labSlug}/etudes/${labB.studyId}/qualite`,
    `/labo/${labA.labSlug}/etudes/${labB.studyId}/qualite`,
  ]) {
    await page.goto(url);
    await expect(page.getByText("Page introuvable", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Qualité", exact: true })).toHaveCount(0);
    await expect(page.getByText(labB.labSlug)).toHaveCount(0);
  }
});
