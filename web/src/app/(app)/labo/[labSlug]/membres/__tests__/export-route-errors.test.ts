import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/training-consent", () => ({ buildTrainingExport: vi.fn() }));

import { GET } from "../export-entrainement/route";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { requireUser } from "@/server/session";
import { buildTrainingExport } from "@/server/training-consent";
import { resetDb } from "../../../../../../../test/db-reset";
import { makeLab, makeMember } from "../../../../../../../test/labs";

const build = vi.mocked(buildTrainingExport);

const call = () =>
  GET(new Request("http://localhost/labo/labo-a/membres/export-entrainement?format=json"), {
    params: Promise.resolve({ labSlug: "labo-a" }),
  });

afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await resetDb();
  const lab = await makeLab("Labo A", "labo-a");
  const admin = await makeMember(lab, "lab_admin", "ad@example.org");
  vi.mocked(requireUser).mockResolvedValue({ id: admin.userId, name: "a", email: "ad@example.org" });
});

describe("GET membres/export-entrainement : refus du service", () => {
  it("export trop volumineux : 413 avec le message, sans audit", async () => {
    build.mockRejectedValue(
      new DomainError("Export trop volumineux (50 Mo maximum) : contactez l'équipe MicroTrace."),
    );
    const res = await call();
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "Export trop volumineux (50 Mo maximum) : contactez l'équipe MicroTrace.",
    );
    expect(await prisma.auditEvent.count({ where: { action: "lab.training_export" } })).toBe(0);
  });

  it("texte du consentement changé : 403 avec le message", async () => {
    build.mockRejectedValue(
      new DomainError("Le texte du consentement a changé : renouvelez le consentement avant d'exporter."),
    );
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("renouvelez le consentement");
  });
});
