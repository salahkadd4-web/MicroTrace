import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParticleOverlay } from "../ParticleOverlay";

const sq = (o: number) => [
  [o, o],
  [o + 10, o],
  [o + 10, o + 10],
  [o, o + 10],
];
const particles = [
  { id: 1, shape: "fibre", contour: sq(0) },
  { id: 2, shape: "fragment", contour: sq(20) },
  { id: 3, shape: "bille", contour: sq(40) },
  { id: 4, shape: "uncertain", contour: sq(60) },
  { id: 5, shape: "fibre", contour: sq(80) },
];

function renderOverlay() {
  return render(<ParticleOverlay src="/x/image" width={1024} height={720} particles={particles} />);
}

describe("ParticleOverlay", () => {
  it("image du magasin, svg au repère de l'image, 5 polygones, libellé accessible", () => {
    const { container } = renderOverlay();
    expect(container.querySelector("img")).toHaveAttribute("src", "/x/image");
    const svg = screen.getByRole("img", {
      name: "Image analysée : 5 particules candidates délimitées",
    });
    expect(svg).toHaveAttribute("viewBox", "0 0 1024 720");
    expect(container.querySelectorAll("polygon")).toHaveLength(5);
    expect(container.querySelectorAll("text")).toHaveLength(5);
  });

  it("traits par jeton ; forme incertaine neutre et pointillée", () => {
    const { container } = renderOverlay();
    const polys = [...container.querySelectorAll("polygon")];
    expect(polys[0]).toHaveAttribute("stroke", "var(--chart-1)");
    expect(polys[1]).toHaveAttribute("stroke", "var(--chart-2)");
    expect(polys[2]).toHaveAttribute("stroke", "var(--chart-3)");
    expect(polys[3]).toHaveAttribute("stroke", "var(--muted-foreground)");
    expect(polys[3]).toHaveAttribute("stroke-dasharray");
    expect(polys[0]).not.toHaveAttribute("stroke-dasharray");
  });

  it("légende HTML : Fibre, Fragment, Bille, Forme incertaine", () => {
    renderOverlay();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Fibre", "Fragment", "Bille", "Forme incertaine"]);
  });
});
