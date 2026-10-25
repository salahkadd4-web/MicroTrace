import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("fusionne les classes Tailwind en conflit", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
