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
    ],
  },
});
