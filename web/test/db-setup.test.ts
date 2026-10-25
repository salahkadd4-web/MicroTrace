import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import { startTestDb } from "./db-start";

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

describe("nettoyage du banc d'essai", () => {
  it("arrête l'instance et supprime le répertoire si le démarrage échoue", async () => {
    let dir = "";
    let port = 0;
    await expect(
      startTestDb({
        onDir: (d) => (dir = d),
        onPort: (p) => (port = p),
        beforeMigrate: async () => {
          expect(await accepts(port)).toBe(true); // l'instance tourne bien
          throw new Error("échec injecté");
        },
      }),
    ).rejects.toThrow("échec injecté");
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(false);
    expect(await accepts(port)).toBe(false);
  });
});
