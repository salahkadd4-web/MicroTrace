import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({
  requireLab: vi.fn(),
  LabSuspendedError: class LabSuspendedError extends Error {},
}));
vi.mock("@/server/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", name: "Alice", email: "a@example.org" })),
}));
vi.mock("@/server/labs", () => ({ listMyLaboratories: vi.fn() }));
vi.mock("../../../actions", () => ({ logout: vi.fn() }));

import { LabSuspendedError, requireLab } from "@/server/lab-context";
import { listMyLaboratories } from "@/server/labs";
import LaboLayout from "../layout";

const mine = (...slugs: string[]) =>
  slugs.map((slug) => ({
    id: slug,
    slug,
    name: `Labo ${slug}`,
    role: "viewer" as const,
    suspended: false,
  }));

const props = { params: Promise.resolve({ labSlug: "alpha" }) };

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue({ labSlug: "alpha", labName: "Labo alpha" } as never);
});

describe("layout /labo/[labSlug]", () => {
  it("affiche le contenu et le nom du laboratoire", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue(mine("alpha"));
    render(await LaboLayout({ ...props, children: <p>page</p> }));
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.getByText("Labo alpha")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Laboratoires" })).not.toBeInTheDocument();
  });

  it("montre le sélecteur avec deux laboratoires", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValue(mine("alpha", "beta"));
    render(await LaboLayout({ ...props, children: <p>page</p> }));
    expect(screen.getByRole("navigation", { name: "Laboratoires" })).toBeInTheDocument();
  });

  it("laboratoire suspendu : avis dédié avec lien de retour, sans le contenu", async () => {
    vi.mocked(requireLab).mockRejectedValue(new LabSuspendedError());
    vi.mocked(listMyLaboratories).mockResolvedValue(mine("alpha"));
    render(await LaboLayout({ ...props, children: <p>page</p> }));
    expect(screen.getByText("Laboratoire suspendu.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("page")).not.toBeInTheDocument();
  });

  it("relance un 404 (non-membre) tel quel", async () => {
    vi.mocked(requireLab).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(LaboLayout({ ...props, children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
