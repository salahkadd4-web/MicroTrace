import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormError } from "../FormError";

describe("FormError", () => {
  it("n'affiche rien sans message", () => {
    const { container } = render(<FormError message={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("affiche le message avec role=alert", () => {
    render(<FormError message="Échec" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Échec");
  });
});
