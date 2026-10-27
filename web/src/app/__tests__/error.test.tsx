import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "../global-error";
import RootError from "../error";

describe("pages d'erreur racine", () => {
  it("error.tsx est en français avec un bouton Réessayer", () => {
    render(<RootError error={new Error("x")} reset={vi.fn()} />);
    expect(screen.getByText("Une erreur est survenue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("global-error.tsx est en français", () => {
    render(<GlobalError error={new Error("x")} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Une erreur est survenue" })).toBeInTheDocument();
  });
});
