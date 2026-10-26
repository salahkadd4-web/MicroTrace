import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

// next-auth ne se résout pas sous Vitest (node) : on le remplace par un faux qui rend le
// gestionnaire de proxy.ts tel quel, appelé sans session (`req.auth` absent).
vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: unknown) => Promise.resolve(handler) }),
}));

let proxy: typeof import("@/proxy").proxy;

beforeAll(async () => {
  process.env.AUTH_SECRET = "secret-de-test-pour-le-proxy-0123456789";
  ({ proxy } = await import("@/proxy"));
});

const ev = { waitUntil() {} } as unknown as NextFetchEvent;
const call = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`), ev);

describe("proxy : routes publiques", () => {
  it("laisse passer /invitation/<jeton> sans session", async () => {
    const res = await call("/invitation/abc_DEF-123");
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.status).toBe(200);
  });

  it("n'ouvre que ce préfixe : le reste exige toujours une session", async () => {
    for (const path of ["/invitationx", "/invitation", "/admin", "/labo/alpha/membres", "/"]) {
      const res = await call(path);
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/connexion");
    }
  });
});
