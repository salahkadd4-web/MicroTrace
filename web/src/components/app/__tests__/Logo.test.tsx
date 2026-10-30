import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { Logo } from "../Logo";

const HARDCODED_COLOUR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i;

describe("Logo", () => {
  it("la goutte est décorative et sans couleur codée en dur", () => {
    const { container } = render(<Logo variant="mark" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 120 120");
    expect(svg.outerHTML).not.toMatch(HARDCODED_COLOUR);
    expect(svg.outerHTML).toContain("var(--brand-ink)");
    expect(svg.outerHTML).toContain("var(--brand-coral)");
    expect(svg.outerHTML).toContain("var(--brand-teal)");
    expect(container).toHaveTextContent("");
  });

  it("le ton sombre utilise les jetons clairs", () => {
    const { container } = render(<Logo tone="dark" />);
    const html = container.querySelector("svg")!.outerHTML;
    expect(html).toContain("var(--brand-ground)");
    expect(html).toContain("var(--brand-coral-bright)");
    expect(html).toContain("var(--brand-teal-bright)");
    expect(html).not.toMatch(HARDCODED_COLOUR);
  });

  it("la variante full donne le nom accessible « MicroTrace Studio » à un lien", () => {
    render(
      <Link href="/">
        <Logo variant="full" />
      </Link>,
    );
    expect(screen.getByRole("link", { name: "MicroTrace Studio" })).toBeInTheDocument();
  });

  it("garde trois éclats au-dessus de 24 px et un seul en dessous, avec des traits épaissis", () => {
    const big = render(<Logo size={28} />).container.querySelector("svg")!;
    expect(big.querySelectorAll("polygon")).toHaveLength(3);
    expect(big.querySelector("path")).toHaveAttribute("stroke-width", "6");
    const small = render(<Logo size={16} />).container.querySelector("svg")!;
    expect(small.querySelectorAll("polygon")).toHaveLength(1);
    expect(small.querySelector("path")).toHaveAttribute("stroke-width", "8");
    expect(small.querySelector("polyline")).toHaveAttribute("stroke-width", "6.5");
  });
});
