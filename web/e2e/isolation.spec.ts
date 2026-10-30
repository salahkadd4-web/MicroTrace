import { expect, login, readState, test } from "./fixtures";

test("Parcours C — un membre ne voit pas les résultats d'un autre laboratoire", async ({ page }) => {
  const { labA, labB } = readState();
  await login(page, labA.email);

  // Contrôle : le membre ouvre bien les résultats de sa propre étude.
  const own = await page.goto(`/labo/${labA.labSlug}/etudes/${labA.studyId}/resultats`);
  expect(own?.status()).toBe(200);

  // Étude du laboratoire B, dans l'adresse de B puis dans l'adresse de A : introuvable.
  for (const url of [
    `/labo/${labB.labSlug}/etudes/${labB.studyId}/resultats`,
    `/labo/${labA.labSlug}/etudes/${labB.studyId}/resultats`,
  ]) {
    // Le contenu arrive en flux : le statut HTTP de la page peut être 200, c'est le texte qui fait foi.
    await page.goto(url);
    await expect(page.getByText("Page introuvable", { exact: true })).toBeVisible();
    await expect(page.getByText("Cette page n'existe pas, ou vous n'y avez pas accès.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Résultats" })).toHaveCount(0);
    await expect(page.getByText(labB.labSlug)).toHaveCount(0);
  }

  // Le téléchargement du rapport est refusé de la même façon.
  const dl = await page.request.get(
    `/labo/${labB.labSlug}/etudes/${labB.studyId}/rapport/telecharger?format=html`,
  );
  expect(dl.status()).toBe(404);
});
