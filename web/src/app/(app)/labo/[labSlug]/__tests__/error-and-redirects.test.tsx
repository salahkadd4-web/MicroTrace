import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn(async () => ({})) }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import { requireLab } from "@/server/lab-context";
import LaboErrorPage from "../error";
import LaboIndexPage from "../page";
import StudyIndexPage from "../etudes/[studyId]/page";

describe("error.tsx du laboratoire", () => {
  it("suspension reconnue : « Laboratoire suspendu. » et lien de retour", () => {
    render(<LaboErrorPage error={new Error("Laboratoire suspendu.")} />);
    expect(screen.getByText("Laboratoire suspendu.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Recharger" })).toBeInTheDocument();
  });

  it("erreur masquée (production) : texte générique évoquant la suspension, avec « Recharger »", () => {
    render(<LaboErrorPage error={Object.assign(new Error("masqué"), { digest: "123" })} />);
    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    expect(screen.getByText(/peut-être été suspendu/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recharger" })).toBeInTheDocument();
  });
});

describe("pages de redirection", () => {
  it("/labo/<slug> mène aux projets, après vérification du laboratoire", async () => {
    await LaboIndexPage({ params: Promise.resolve({ labSlug: "alpha" }) });
    expect(requireLab).toHaveBeenCalledWith("alpha");
    expect(redirect).toHaveBeenCalledWith("/labo/alpha/projets");
  });

  it("/labo/<slug>/etudes/<id> mène aux paramètres", async () => {
    await StudyIndexPage({ params: Promise.resolve({ labSlug: "alpha", studyId: "s1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/labo/alpha/etudes/s1/parametres");
  });
});
