import { defineConfig } from "@playwright/test";

// Pile autonome (base, moteur, application) démarrée par global-setup ; l'adresse de
// l'application n'est connue qu'à ce moment-là (E2E_BASE_URL), voir e2e/fixtures.ts.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    locale: "fr-FR",
    acceptDownloads: true,
    // Ni capture ni trace : elles pourraient contenir des valeurs de mesure.
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
