import { expect, login, queryDb, readState, test } from "./fixtures";

// Unité inconnue : erreur bloquante au contrôle. Aucune valeur réelle.
const BAD_CSV =
  "sample_id;matrix;polymer;reported_value;unit;method;record_type\n" +
  "S1;sang total;PET;1,5;furlong;Py-GC/MS;sample\n";

test("Parcours B — un fichier en erreur n'est pas importable", async ({ page }) => {
  const { labA } = readState();
  await login(page, labA.email);
  await page.goto(`/labo/${labA.labSlug}/etudes/${labA.studyId}/imports`);

  // Avant l'hydratation de la page, React ignore le fichier : on réessaie jusqu'à ce que l'envoi soit possible.
  const send = page.getByRole("button", { name: "Envoyer le fichier" });
  await expect(async () => {
    await page.getByLabel("Fichier à importer").setInputFiles({
      name: "erreur-unite.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(BAD_CSV, "utf8"),
    });
    await expect(send).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await send.click();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Suivant" }).click();
  await page.getByRole("button", { name: "Lancer le contrôle" }).click();

  // Le contrôle affiche l'erreur ; on ne peut ni passer à l'étape suivante ni enregistrer.
  const unitRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Erreur", exact: true }) })
    .filter({ hasText: "furlong" });
  await expect(unitRow).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Suivant" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enregistrer l'import" })).toHaveCount(0);

  // Aucun import n'a été créé en base pour cette étude.
  const [row] = await queryDb<{ n: string }>(
    'SELECT count(*) AS n FROM "ImportRun" WHERE "studyId" = $1',
    [labA.studyId],
  );
  expect(Number(row.n)).toBe(0);
});
