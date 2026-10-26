import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", name: "Alice", email: "a@example.org" })),
}));
vi.mock("@/server/labs", () => ({
  listMyLaboratories: vi.fn(),
  isPlatformAdmin: vi.fn(),
}));

import { isPlatformAdmin, listMyLaboratories } from "@/server/labs";
import Home from "../page";

const lab = (slug: string) => ({
  id: slug,
  slug,
  name: slug,
  role: "viewer" as const,
  suspended: false,
});

/** `redirect()` de Next lève une erreur dont le digest porte la destination. */
async function destination(): Promise<string> {
  try {
    await Home();
  } catch (e) {
    return String((e as { digest?: string }).digest).split(";")[2];
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  vi.mocked(isPlatformAdmin).mockResolvedValue(false);
});

describe("page d'accueil /", () => {
  it("mène au premier laboratoire de l'utilisateur", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([lab("alpha"), lab("beta")]);
    expect(await destination()).toBe("/labo/alpha/projets");
  });

  it("sans laboratoire, mène l'administrateur de la plateforme à /admin", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([]);
    vi.mocked(isPlatformAdmin).mockResolvedValue(true);
    expect(await destination()).toBe("/admin");
  });

  it("sans laboratoire ni droit de plateforme, mène à /aucun-laboratoire", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([]);
    expect(await destination()).toBe("/aucun-laboratoire");
  });

  it("saute un laboratoire suspendu et mène au premier laboratoire actif", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([{ ...lab("alpha"), suspended: true }, lab("beta")]);
    expect(await destination()).toBe("/labo/beta/projets");
  });

  it("seul laboratoire suspendu : mène à lui, pour y voir l'avis", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([{ ...lab("alpha"), suspended: true }]);
    expect(await destination()).toBe("/labo/alpha/projets");
  });

  it("un laboratoire passe avant le rôle d'administrateur de la plateforme", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue([lab("alpha")]);
    vi.mocked(isPlatformAdmin).mockResolvedValue(true);
    expect(await destination()).toBe("/labo/alpha/projets");
  });
});
