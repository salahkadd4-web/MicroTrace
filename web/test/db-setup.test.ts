import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startTestDb } from "./db-start";

describe("nettoyage du banc d'essai", () => {
  it("arrête l'instance et supprime le répertoire si le démarrage échoue", async () => {
    let dir = "";
    await expect(
      startTestDb({
        onDir: (d) => (dir = d),
        beforeMigrate: () => {
          throw new Error("échec injecté");
        },
      }),
    ).rejects.toThrow("échec injecté");
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(false);
  });
});
