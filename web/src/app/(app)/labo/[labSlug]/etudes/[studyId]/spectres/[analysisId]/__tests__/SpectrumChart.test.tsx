import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => {
  const box = (name: string) => {
    const Box = ({ children }: { children?: ReactNode }) => <div data-testid={name}>{children}</div>;
    Box.displayName = name;
    return Box;
  };
  return {
    ResponsiveContainer: box("container"),
    LineChart: box("chart"),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceArea: (p: { x1: number; x2: number; fill: string }) => (
      <div data-testid="area" data-x1={p.x1} data-x2={p.x2} data-fill={p.fill} />
    ),
    Line: (p: { name: string; stroke: string; strokeWidth: number }) => (
      <div data-testid="line" data-name={p.name} data-stroke={p.stroke} data-width={p.strokeWidth} />
    ),
  };
});

import { SpectrumChart } from "../SpectrumChart";

const curve = { x: [400, 500], y: [0, 1] };
const refs = [1, 2, 3, 4, 5].map((i) => ({
  id: `r${i}`,
  name: `Réf ${i}`,
  curve: i <= 2 ? curve : null,
}));

describe("SpectrumChart", () => {
  it("2 courbes autorisées sur 5 : aria-label, une Line déposée + 2 références, fenêtre ombrée", () => {
    render(
      <SpectrumChart query={curve} references={refs} xLabel="Déplacement" yLabel="Intensité" windowMin={600} windowMax={900} />,
    );
    expect(
      screen.getByRole("img", {
        name: "Spectre déposé superposé aux spectres de référence affichables (2)",
      }),
    ).toBeInTheDocument();
    const lines = screen.getAllByTestId("line");
    expect(lines).toHaveLength(3);
    const query = lines.find((l) => l.dataset.name === "Spectre déposé")!;
    expect(query.dataset.stroke).toBe("var(--foreground)");
    expect(query.dataset.width).toBe("2");
    expect(lines.filter((l) => l !== query).map((l) => l.dataset.stroke)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
    ]);
    const area = screen.getByTestId("area");
    expect(area.dataset.x1).toBe("600");
    expect(area.dataset.x2).toBe("900");
    expect(area.dataset.fill).toBe("var(--muted)");
  });

  it("la légende HTML ne liste que les références tracées", () => {
    render(
      <SpectrumChart query={curve} references={refs} xLabel="x" yLabel="y" windowMin={1} windowMax={2} />,
    );
    const legend = screen.getByRole("list", { name: "Légende du graphique" });
    expect(legend).toHaveTextContent("Réf 1");
    expect(legend).toHaveTextContent("Réf 2");
    expect(legend).not.toHaveTextContent("Réf 3");
  });
});
