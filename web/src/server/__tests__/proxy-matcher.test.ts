import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: unknown) => Promise.resolve(handler) }),
}));

let re: RegExp;
beforeAll(async () => {
  process.env.AUTH_SECRET = "secret-de-test-pour-le-proxy-0123456789";
  const { config } = await import("@/proxy");
  // Forme compilée par Next (voir .next/server/functions-config-manifest.json) : préfixe de
  // données, motif, suffixes .json/.rsc/.segments, barre finale facultative.
  const m = config.matcher[0];
  const inner = m.slice(2, -1).replace(/\//g, "\/");
  re = new RegExp(
    `^(?:\/(_next\/data\/[^/]{1,}))?(?:\/(${inner}))(\.json|\.rsc|\.segments\/.+\.segment\.rsc)?[\/#\?]?$`,
  );
});

// Équivalent de la compilation du matcher par Next (path-to-regexp) pour ce motif.

describe("matcher du proxy", () => {
  it("exclut la route de dépôt (corps de 50 Mo non mis en tampon par le proxy)", () => {
    expect(re.test("/labo/mon-labo/etudes/abc123/imports/upload")).toBe(false);
  });
  it("exclut la route d'analyse spectrale (authentification propre)", () => {
    expect(re.test("/labo/mon-labo/etudes/abc123/spectres/analyser")).toBe(false);
    expect(re.test("/labo/mon-labo/etudes/abc123/spectres/analyser/x")).toBe(true);
    expect(re.test("/labo/mon-labo/etudes/abc123/spectres")).toBe(true);
  });
  it("exclut la route d'analyse d'images (authentification propre), elle seule", () => {
    expect(re.test("/labo/mon-labo/etudes/abc123/images/analyser")).toBe(false);
    expect(re.test("/labo/mon-labo/etudes/abc123/images/analyser/x")).toBe(true);
    expect(re.test("/labo/mon-labo/etudes/abc123/images")).toBe(true);
    expect(re.test("/labo/mon-labo/etudes/abc123/images/comptages")).toBe(true);
    expect(re.test("/labo/mon-labo/etudes/abc123/images/a1/image")).toBe(true);
  });
  it.each([
    "/labo/mon-labo/etudes/abc123/rapport/telecharger",
    "/labo/mon-labo/etudes/abc123/rapport/dictionnaire",
  ])("exclut la route de téléchargement %s (authentification propre)", (p) => {
    expect(re.test(p)).toBe(false);
  });
  it.each([
    "/labo/mon-labo/etudes/abc123/rapport",
    "/labo/mon-labo/etudes/abc123/rapport/telecharger/x",
    "/labo/mon-labo/etudes/abc123/rapport/autre",
    "/labo/mon-labo/etudes/abc123/imports",
    "/labo/mon-labo/etudes/abc123/imports/upload/autre",
    "/labo/mon-labo/etudes/abc123/imports/upload/",
    "/labo/mon-labo/etudes/abc123/imports/upload.rsc",
    "/LABO/mon-labo/etudes/abc123/imports/upload",
    "/labo/mon-labo/etudes/abc123/imports/upload/x",
    "/labo/mon-labo",
    "/connexion",
    "/",
  ])("garde le proxy sur %s", (p) => {
    expect(re.test(p)).toBe(true);
  });
  it("garde toujours les exclusions de ressources statiques", () => {
    expect(re.test("/_next/static/x.js")).toBe(false);
  });
});
