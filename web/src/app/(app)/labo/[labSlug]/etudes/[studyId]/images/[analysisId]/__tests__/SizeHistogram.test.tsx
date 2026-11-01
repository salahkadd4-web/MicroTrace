import { render, screen, within } from "@testing-library/react";
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
    BarChart: ({ data, children }: { data: { count: number }[]; children?: ReactNode }) => (
      <div data-testid="chart" data-filled={data.filter((d) => d.count > 0).length}>
        {children}
      </div>
    ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Bar: (p: { fill: string }) => <div data-testid="bar" data-fill={p.fill} />,
  };
});

import { SizeHistogram } from "../SizeHistogram";

const LABELS = [
  "moins de 10 µm",
  "10 à 20 µm",
  "20 à 50 µm",
  "50 à 100 µm",
  "100 à 200 µm",
  "200 à 500 µm",
  "500 à 1 000 µm",
  "1 000 à 5 000 µm",
  "5 000 µm et plus",
];
const dist = {
  bins: LABELS.map((label, i) => ({ label, count: i === 1 ? 4 : i === 3 ? 2 : 0 })),
  median_um: 18.5,
  p10_um: 11,
  p90_um: 60,
};

describe("SizeHistogram", () => {
  it("figure : h3, phrase, graphique role=img avec les classes non vides, jeton de couleur", () => {
    render(<SizeHistogram distribution={dist} total={6} />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Diamètre de Feret maximal des particules" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/6 particules au total, médiane 18,5 µm/)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Distribution des tailles : 2 classes non vides" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toHaveAttribute("data-filled", "2");
    expect(screen.getByTestId("bar")).toHaveAttribute("data-fill", "var(--chart-1)");
  });

  it("« Voir les données » liste les 9 classes", () => {
    render(<SizeHistogram distribution={dist} total={6} />);
    expect(screen.getByText("Voir les données")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { hidden: true })).getAllByRole("row", {
      hidden: true,
    });
    expect(rows).toHaveLength(10);
    expect(rows[2]).toHaveTextContent("10 à 20 µm");
  });

  it("sans échelle : phrase d'information, aucun graphique", () => {
    render(<SizeHistogram distribution={null} total={3} />);
    expect(screen.getByText("Échelle inconnue : pas de distribution en µm.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
