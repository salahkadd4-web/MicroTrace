import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateTimeFr } from "../DateTimeFr";

describe("DateTimeFr", () => {
  it("formate JJ/MM/AAAA HH:MM", () => {
    const { container } = render(<DateTimeFr value="2026-10-25T15:30:00Z" />);
    expect(container).toHaveTextContent("25/10/2026 16:30");
  });
  it("affiche un tiret si la valeur est absente ou invalide", () => {
    const { container } = render(<DateTimeFr value="pas une date" />);
    expect(container).toHaveTextContent("—");
  });
});
