import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Un projet par environnement. La tâche 2 ajoutera un projet « server » (node)
// pour les tests de code serveur, sans toucher au projet « components ».
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        resolve: {
          alias: {
            ...alias,
            "server-only": fileURLToPath(
              new URL("./test/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "server",
          environment: "node",
          include: [
            "src/server/**/*.test.ts",
            "src/app/**/*.test.ts",
            "test/**/*.test.ts",
          ],
          globalSetup: ["./test/db-setup.ts"],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
