import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberFr } from "../NumberFr";

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
});
