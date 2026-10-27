import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Service = {
  image?: string;
  build?: unknown;
  ports?: string[];
  environment?: Record<string, string>;
  networks?: string[];
  volumes?: string[];
};
const compose = parse(readFileSync(join(__dirname, "..", "..", "docker-compose.yml"), "utf8")) as {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean }>;
  volumes: Record<string, unknown>;
};
const services = Object.entries(compose.services);

describe("docker-compose.yml", () => {
  it("publie uniquement sur 127.0.0.1", () => {
    for (const [, s] of services)
      for (const p of s.ports ?? []) expect(String(p)).toMatch(/^127\.0\.0\.1:/);
    expect(compose.services.web.ports).toEqual(["127.0.0.1:3000:3000"]);
  });

  it("ne publie aucun port pour db et engine, sur un réseau interne", () => {
    for (const name of ["db", "engine"]) {
      expect(compose.services[name].ports ?? []).toEqual([]);
      expect(compose.services[name].networks).toEqual(["internal"]);
    }
    expect(compose.networks.internal.internal).toBe(true);
  });

  it("épingle les images (jamais latest, tag exact)", () => {
    for (const [, s] of services) {
      if (!s.image || s.build) continue;
      expect(s.image).toMatch(/:\d+\.\d+/);
      expect(s.image).not.toMatch(/latest/);
    }
  });

  it("lit les secrets depuis l'environnement, sans valeur littérale", () => {
    const secretKeys = /SECRET|PASSWORD/;
    for (const [, s] of services)
      for (const [k, v] of Object.entries(s.environment ?? {}))
        if (secretKeys.test(k)) expect(String(v)).toMatch(/^\$\{[A-Z_]+(:\?[^}]*)?\}$/);
    const dbUrl = compose.services.web.environment?.DATABASE_URL ?? "";
    expect(dbUrl).toContain("${POSTGRES_PASSWORD}");
  });

  it("volume nommé files-data monté sur /app/var dans web, dossier créé par le Dockerfile", () => {
    expect(compose.services.web.volumes).toEqual(["files-data:/app/var"]);
    expect(Object.keys(compose.volumes)).toContain("files-data");
    const dockerfile = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/mkdir -p \/app\/var && chown web:web \/app\/var/);
  });
});
