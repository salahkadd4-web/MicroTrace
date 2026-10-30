import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatEngineNumberFr, formatPercentFr, NumberFr } from "../NumberFr";

describe("NumberFr", () => {
  it("utilise la virgule décimale", () => {
    const { container } = render(<NumberFr value={2.4} />);
    expect(container).toHaveTextContent("2,4");
  });
  it("affiche un tiret pour null", () => {
    const { container } = render(<NumberFr value={null} />);
    expect(container).toHaveTextContent("—");
  });
  it("respecte le nombre de décimales", () => {
    const { container } = render(<NumberFr value={2.4} digits={2} />);
    expect(container).toHaveTextContent("2,40");
  });

  // Mêmes cas que engine/tests/test_summary_report.py (test_number_display_rules_...).
  it("pourcentages comme le rapport du moteur : arrondi à la paire, une décimale", () => {
    const fr = (x: number) => formatPercentFr(x).replace(/\s/gu, " ");
    expect([1 / 16, 5 / 16, 0.5, 1].map(fr)).toEqual(["6,2 %", "31,2 %", "50 %", "100 %"]);
  });
  it("statistiques comme le rapport du moteur : 6 chiffres significatifs, sans milliers", () => {
    expect([1.8433333, 1234.56789, 1234567, 0.00001234].map(formatEngineNumberFr)).toEqual([
      "1,84333", "1234,57", "1234567", "0,00001234",
    ]);
    const { container } = render(<NumberFr engine value={1234.56789} />);
    expect(container).toHaveTextContent("1234,57");
  });
});
