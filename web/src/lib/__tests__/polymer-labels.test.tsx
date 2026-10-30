import { describe, expect, it } from "vitest";
import { polymerLabel } from "../polymer-labels";

describe("polymerLabel", () => {
  it("traduit les codes spéciaux", () => {
    expect(polymerLabel("PS_SUM")).toBe("PS (somme)");
    expect(polymerLabel("ANY")).toBe("Au moins un polymère");
  });
  it("montre tout autre code tel quel", () => {
    expect(polymerLabel("PET")).toBe("PET");
    expect(polymerLabel("PMMA")).toBe("PMMA");
  });
});
