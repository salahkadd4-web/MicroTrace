import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/images", () => ({ recordImageDecision: vi.fn(async () => ({ id: "d1" })) }));
vi.mock("@/server/run-action", () => ({
  runAction: async (_slug: string, fn: (ctx: unknown) => Promise<unknown>) => {
    try {
      return (await fn({ role: "researcher" })) ?? { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
}));

import { revalidatePath } from "next/cache";
import { recordImageDecision } from "@/server/images";
import { recordImageDecisionAction } from "../actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => vi.mocked(recordImageDecision).mockClear());

describe("recordImageDecisionAction", () => {
  it("Corrigée : exclusions, changements de forme, « Proposée » ignorée, manquées", async () => {
    const r = await recordImageDecisionAction("labo", {}, form({
      studyId: "s1", analysisId: "a1", decision: "corrected", note: "n", missed: "2",
      "particle-1": "excluded", "particle-2": "fibre", "particle-3": "proposed",
    }));
    expect(r).toEqual({ ok: true });
    expect(recordImageDecision).toHaveBeenCalledWith(expect.anything(), "s1", "a1", {
      decision: "corrected", excluded: [1], reshaped: [{ id: 2, shape: "fibre" }], missed: 2, note: "n",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/labo/labo/etudes/s1", "layout");
  });

  it("Acceptée ou Rejetée : aucune correction transmise", async () => {
    await recordImageDecisionAction("labo", {}, form({
      studyId: "s1", analysisId: "a1", decision: "rejected", note: "n", missed: "4", "particle-1": "excluded",
    }));
    expect(recordImageDecision).toHaveBeenCalledWith(expect.anything(), "s1", "a1", {
      decision: "rejected", excluded: [], reshaped: [], missed: 0, note: "n",
    });
  });

  it("valeur hors liste ou identifiant illisible : Corrections invalides, rien d'enregistré", async () => {
    for (const bad of [{ "particle-1": "plastique" }, { "particle-x": "fibre" }] as Record<string, string>[]) {
      const r = await recordImageDecisionAction("labo", {}, form({
        studyId: "s1", analysisId: "a1", decision: "corrected", ...bad,
      }));
      expect(r).toEqual({ error: "Corrections invalides." });
    }
    expect(recordImageDecision).not.toHaveBeenCalled();
  });
});
