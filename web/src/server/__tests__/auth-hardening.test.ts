import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtCallback, SESSION_MAX_AGE_MS } from "@/auth.config";
import { authorize, createUser } from "@/server/users";

// next-auth ne se résout pas sous Vitest (node) : on simule ses classes d'erreur.
const authError = (type: string, msg = "") => Object.assign(new Error(msg), { type });

const signIn = vi.fn();
vi.mock("@/auth", () => ({ signIn: (...a: unknown[]) => signIn(...a) }));

import { login } from "@/app/connexion/actions";

const form = (e = "a@example.org", p = "x") => {
  const f = new FormData();
  f.set("email", e);
  f.set("password", p);
  return f;
};

describe("jwtCallback", () => {
  it("pose loginAt et sub à la connexion", () => {
    const t = jwtCallback({ token: {}, user: { id: "u1" }, trigger: "signIn" }, 1000);
    expect(t).toMatchObject({ sub: "u1", loginAt: 1000 });
  });
  it("garde la session avant 8 h, l'invalide après", () => {
    const token = { sub: "u1", loginAt: 0 };
    expect(jwtCallback({ token }, SESSION_MAX_AGE_MS)).not.toBeNull();
    expect(jwtCallback({ token }, SESSION_MAX_AGE_MS + 1)).toBeNull();
  });
  it("invalide un jeton sans loginAt", () => {
    expect(jwtCallback({ token: { sub: "u1" } }, 5)).toBeNull();
  });
});

describe("action login", () => {
  beforeEach(() => {
    signIn.mockReset();
  });
  it("CredentialsSignin -> identifiants invalides", async () => {
    signIn.mockImplementation(async () => {
      throw authError("CredentialsSignin");
    });
    expect(await login({}, form())).toEqual({ error: "Identifiants invalides." });
  });
  it("une redirection est relancée", async () => {
    signIn.mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(login({}, form())).rejects.toThrow("NEXT_REDIRECT");
  });
  it("autre erreur d'authentification -> message générique sans détail", async () => {
    signIn.mockImplementation(async () => {
      throw authError("CallbackRouteError", "boom secret");
    });
    expect(await login({}, form())).toEqual({
      error: "Connexion impossible pour le moment. Réessayez plus tard.",
    });
  });
});

describe("limites", () => {
  it("refuse un mot de passe de plus de 72 octets", async () => {
    await expect(
      createUser({ email: "a@example.org", name: "A", password: "é".repeat(37) }),
    ).rejects.toThrow("Le mot de passe ne doit pas dépasser 72 octets.");
  });
  it("authorize refuse sans accès base les entrées démesurées", async () => {
    expect(await authorize("a".repeat(250) + "@example.org", "x")).toBeNull();
    expect(await authorize("a@example.org", "x".repeat(1025))).toBeNull();
  });
});
