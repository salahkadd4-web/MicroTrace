import { beforeEach, describe, expect, it, vi } from "vitest";

const runAction = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }));
vi.mock("@/server/run-action", () => ({ runAction: (...a: unknown[]) => runAction(...a) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/imports", () => ({}));

import * as actions from "../actions";

beforeEach(() => runAction.mockClear());

describe("rôle minimal de chaque action", () => {
  const mapping = {} as never;
  const cases: [string, () => Promise<unknown>, string | undefined][] = [
    ["suggestMappingAction", () => actions.suggestMappingAction("l", "s", "t", null), undefined],
    ["readSheetAction", () => actions.readSheetAction("l", "s", "t", "A"), undefined],
    ["checkImportAction", () => actions.checkImportAction("l", "s", { token: "t", sheet: null, mapping }), undefined],
    [
      "saveImportAction",
      () => actions.saveImportAction("l", "s", { token: "t", sheet: null, mapping, acceptWarnings: false }),
      undefined,
    ],
    ["retireImportAction", () => actions.retireImportAction("l", "r", "m"), undefined],
    ["importIssuesAction", () => actions.importIssuesAction("l", "r"), "viewer"],
  ];

  // undefined = rôle par défaut de runAction (chercheur) ; seule la lecture des issues est ouverte aux lecteurs.
  it.each(cases)("%s", async (_name, call, role) => {
    await call();
    const args = runAction.mock.calls[0];
    expect(args[0]).toBe("l");
    expect(args[2]).toBe(role);
  });
});
