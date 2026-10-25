import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/callback-url";

describe("safeCallbackUrl", () => {
  it("accepte les chemins relatifs", () => {
    expect(safeCallbackUrl("/projets/1?x=2")).toBe("/projets/1?x=2");
  });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "", null, undefined, "projets"])(
    "rejette %s",
    (v) => {
      expect(safeCallbackUrl(v as string | null | undefined)).toBe("/");
    },
  );
});
