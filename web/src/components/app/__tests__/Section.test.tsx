import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Section } from "../Section";

describe("Section", () => {
  it("rend un h2, la description, les actions et le contenu", () => {
    render(
      <Section title="Limites" description="Seuils par méthode" actions={<button>Ajouter</button>}>
        <p>Contenu</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Limites" })).toBeInTheDocument();
    expect(screen.getByText("Seuils par méthode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
    expect(screen.getByText("Contenu")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Limites" })).toBeInTheDocument();
  });

  it("n'exige ni description ni actions", () => {
    render(<Section title="Seul">x</Section>);
    expect(screen.getByRole("heading", { level: 2, name: "Seul" })).toBeInTheDocument();
  });
});
