import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataNatureBanner } from "../DataNatureBanner";

describe("DataNatureBanner", () => {
  it.each([
    ["published", "Données publiées"],
    ["laboratory", "Données de laboratoire"],
    ["simulated", "SIMULÉ — données fictives"],
  ] as const)("affiche %s", (nature, label) => {
    render(<DataNatureBanner nature={nature} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByText("Prototype de recherche, pas un dispositif médical"),
    ).toBeInTheDocument();
  });

  it("met l'état simulé en évidence avec le jeton warning", () => {
    const { container } = render(<DataNatureBanner nature="simulated" />);
    const banner = container.firstElementChild!;
    expect(banner).toHaveClass("bg-warning", "text-warning-foreground");
  });
  it("n'utilise pas le style warning hors simulation", () => {
    const { container } = render(<DataNatureBanner nature="laboratory" />);
    expect(container.firstElementChild).not.toHaveClass("bg-warning");
  });
});
