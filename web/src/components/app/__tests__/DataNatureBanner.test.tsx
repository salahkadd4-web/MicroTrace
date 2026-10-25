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
});
