import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let pathname = "/labo/labo/etudes/s1/spectres";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { StudyTabs } from "../StudyTabs";

describe("StudyTabs", () => {
  it("ordre : Paramètres, Imports, Résultats, Qualité, Spectres, Images, Rapport, Journal", () => {
    render(<StudyTabs labSlug="labo" studyId="s1" />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Paramètres",
      "Imports",
      "Résultats",
      "Qualité",
      "Spectres",
      "Images",
      "Rapport",
      "Journal",
    ]);
  });

  it("aria-current sur /images et sur /images/abc", () => {
    for (const p of ["/labo/labo/etudes/s1/images", "/labo/labo/etudes/s1/images/abc"]) {
      pathname = p;
      const { unmount } = render(<StudyTabs labSlug="labo" studyId="s1" />);
      expect(screen.getByRole("link", { name: "Images" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Spectres" })).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("aria-current sur /spectres et sur /spectres/abc", () => {
    for (const p of ["/labo/labo/etudes/s1/spectres", "/labo/labo/etudes/s1/spectres/abc"]) {
      pathname = p;
      const { unmount } = render(<StudyTabs labSlug="labo" studyId="s1" />);
      expect(screen.getByRole("link", { name: "Spectres" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Qualité" })).not.toHaveAttribute("aria-current");
      unmount();
    }
  });
});
