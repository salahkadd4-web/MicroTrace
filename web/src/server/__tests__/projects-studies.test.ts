import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", async (orig) => {
  const actual = await orig<typeof import("@/server/audit")>();
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { validateContext: vi.fn() } };
});

import * as auditModule from "@/server/audit";
import { prisma } from "@/server/db";
import {
  ENGINE_VALIDATE_TIMEOUT_MS,
  EngineError,
  EngineUnavailableError,
  engineClient,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { createProject, listProjects } from "@/server/projects";
import {
  ENGINE_TX_OPTIONS,
  archiveStudy,
  buildStudyContext,
  createStudy,
  declarePseudonymisation,
  getStudy,
  updateStudy,
} from "@/server/studies";
import type { LabContext } from "@/server/lab-context";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const validate = vi.mocked(engineClient.validateContext);
const DOI_MSG = "Une étude publiée doit indiquer un DOI.";

let ctx: LabContext;
let lab: Awaited<ReturnType<typeof makeLab>>;

beforeEach(async () => {
  await resetDb();
  lab = await makeLab("Labo");
  validate.mockReset();
  validate.mockResolvedValue({} as never);
  ctx = await makeMember(lab, "researcher", "a@example.org", "A");
});

async function audits(action: string) {
  return prisma.auditEvent.findMany({ where: { action } });
}

async function newStudy() {
  const p = await createProject(ctx, { title: "P", description: "" });
  return createStudy(ctx, p.id, {
    title: "E",
    nature: "laboratory",
    blankCorrected: "unknown",
  });
}

describe("projets", () => {
  it("crée un projet avec son AuditEvent, titre rogné, description vide", async () => {
    const p = await createProject(ctx, {
      title: "  Mon projet ",
      description: "  ",
    });
    expect(p.title).toBe("Mon projet");
    expect(p.description).toBe("");
    const ev = await audits("project.create");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actorId: ctx.userId,
      entityType: "Project",
      entityId: p.id,
    });
  });

  it("annule le projet si l'écriture de l'audit échoue", async () => {
    vi.mocked(auditModule.recordAudit).mockRejectedValueOnce(new Error("audit KO"));
    await expect(createProject(ctx, { title: "P" })).rejects.toThrow("audit KO");
    expect(await prisma.project.count()).toBe(0);
  });

  it("refuse un titre vide ou trop long", async () => {
    await expect(createProject(ctx, { title: "  " })).rejects.toThrow(
      "Le titre est obligatoire.",
    );
    await expect(createProject(ctx, { title: "x".repeat(201) })).rejects.toThrow(
      "Le titre ne doit pas dépasser 200 caractères.",
    );
    expect(await prisma.project.count()).toBe(0);
  });

  it("liste du plus récent au plus ancien avec le nombre d'études", async () => {
    const a = await createProject(ctx, { title: "A" });
    const b = await createProject(ctx, { title: "B" });
    await prisma.project.update({
      where: { id: a.id },
      data: { createdAt: new Date("2026-01-01") },
    });
    await prisma.project.update({
      where: { id: b.id },
      data: { createdAt: new Date("2026-02-01") },
    });
    await createStudy(ctx, a.id, {
      title: "E",
      nature: "simulated",
      blankCorrected: "no",
    });
    const list = await listProjects(ctx);
    expect(list.map((p) => p.title)).toEqual(["B", "A"]);
    expect(list.find((p) => p.id === a.id)?._count.studies).toBe(1);
    expect(list.find((p) => p.id === b.id)?._count.studies).toBe(0);
  });
});

describe("createStudy", () => {
  it("crée l'étude et son AuditEvent après validation du contexte", async () => {
    const p = await createProject(ctx, { title: "P" });
    const s = await createStudy(ctx, p.id, {
      title: " Étude ",
      nature: "published",
      referenceDoi: "10.1000/x",
      referenceLicense: "CC-BY-4.0",
      blankCorrected: "yes",
    });
    expect(s.title).toBe("Étude");
    expect(validate).toHaveBeenCalledWith({
      data_nature: "published",
      methods: [],
      limits: [],
      reference_doi: "10.1000/x",
      reference_license: "CC-BY-4.0",
      blank_corrected: "yes",
    });
    const ev = await audits("study.create");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      entityType: "Study",
      entityId: s.id,
      actorId: ctx.userId,
    });
  });

  it("renvoie le message du moteur tel quel et n'écrit rien (422)", async () => {
    validate.mockRejectedValue(new EngineError(422, DOI_MSG));
    const p = await createProject(ctx, { title: "P" });
    await expect(
      createStudy(ctx, p.id, {
        title: "E",
        nature: "published",
        blankCorrected: "unknown",
      }),
    ).rejects.toThrow(new DomainError(DOI_MSG));
    expect(await prisma.study.count()).toBe(0);
    expect(await audits("study.create")).toHaveLength(0);
  });

  it("moteur indisponible : EngineUnavailableError et aucune ligne écrite", async () => {
    validate.mockRejectedValue(new EngineUnavailableError());
    const p = await createProject(ctx, { title: "P" });
    await expect(
      createStudy(ctx, p.id, {
        title: "E",
        nature: "simulated",
        blankCorrected: "no",
      }),
    ).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(await prisma.study.count()).toBe(0);
    expect(await audits("study.create")).toHaveLength(0);
  });

  it("projet introuvable", async () => {
    await expect(
      createStudy(ctx, "inconnu", {
        title: "E",
        nature: "simulated",
        blankCorrected: "no",
      }),
    ).rejects.toThrow("Projet introuvable.");
    expect(validate).not.toHaveBeenCalled();
    expect(await prisma.study.count()).toBe(0);
  });
});

describe("updateStudy", () => {
  it("valide l'état après mise à jour (contexte construit dans la transaction)", async () => {
    const s = await newStudy();
    await updateStudy(ctx, s.id, {
      nature: "published",
      referenceDoi: " 10.1000/new ",
      referenceLicense: "CC-BY-4.0",
    });
    expect(validate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data_nature: "published",
        reference_doi: "10.1000/new",
        reference_license: "CC-BY-4.0",
      }),
    );
  });

  it("annule l'étude si l'écriture de l'audit échoue", async () => {
    const s = await newStudy();
    vi.mocked(auditModule.recordAudit).mockRejectedValueOnce(new Error("audit KO"));
    await expect(updateStudy(ctx, s.id, { title: "Autre" })).rejects.toThrow("audit KO");
    const after = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.title).toBe("E");
  });

  it("transaction moteur : délai strictement supérieur au délai du moteur", () => {
    expect(ENGINE_TX_OPTIONS.timeout).toBeGreaterThan(ENGINE_VALIDATE_TIMEOUT_MS);
    expect(ENGINE_TX_OPTIONS.timeout).toBe(25_000);
    expect(ENGINE_TX_OPTIONS.maxWait).toBeGreaterThan(0);
  });

  it("met à jour et audite uniquement les champs modifiés", async () => {
    const s = await newStudy();
    const u = await updateStudy(ctx, s.id, {
      title: "Nouveau",
      blankCorrected: "unknown",
    });
    expect(u.title).toBe("Nouveau");
    const ev = await audits("study.update");
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toEqual({ title: "E" });
    expect(ev[0].after).toEqual({ title: "Nouveau" });
  });

  it("rejet 422 du moteur : étude inchangée, aucun audit", async () => {
    const s = await newStudy();
    validate.mockRejectedValue(new EngineError(422, DOI_MSG));
    await expect(updateStudy(ctx, s.id, { nature: "published" })).rejects.toThrow(DOI_MSG);
    const after = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nature).toBe("laboratory");
    expect(await audits("study.update")).toHaveLength(0);
  });

  it("refuse sur une étude archivée", async () => {
    const s = await newStudy();
    await archiveStudy(ctx, s.id, "fin");
    await expect(updateStudy(ctx, s.id, { title: "X" })).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
  });
});

describe("pseudonymisation et archivage", () => {
  it("déclare la pseudonymisation une seule fois", async () => {
    const s = await newStudy();
    const d = await declarePseudonymisation(ctx, s.id);
    expect(d.pseudonymDeclaredAt).not.toBeNull();
    expect(d.pseudonymDeclaredById).toBe(ctx.userId);
    expect(await audits("study.pseudonymisation.declare")).toHaveLength(1);
    await expect(declarePseudonymisation(ctx, s.id)).rejects.toThrow(
      "Pseudonymisation déjà déclarée.",
    );
    expect(await audits("study.pseudonymisation.declare")).toHaveLength(1);
  });

  it("archive avec motif (dans l'audit), puis lecture seule", async () => {
    const s = await newStudy();
    const a = await archiveStudy(ctx, s.id, "  Étude terminée ");
    expect(a.archivedAt).not.toBeNull();
    const ev = await audits("study.archive");
    expect(ev).toHaveLength(1);
    expect(ev[0].after).toMatchObject({ reason: "Étude terminée" });
    await expect(declarePseudonymisation(ctx, s.id)).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
    await expect(archiveStudy(ctx, s.id, "encore")).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
  });

  it("refuse un motif vide", async () => {
    const s = await newStudy();
    await expect(archiveStudy(ctx, s.id, "   ")).rejects.toThrow(
      "Le motif d'archivage est obligatoire.",
    );
    const after = await prisma.study.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.archivedAt).toBeNull();
    expect(await audits("study.archive")).toHaveLength(0);
  });
});

describe("buildStudyContext / getStudy", () => {
  it("projette méthodes et limites en snake_case", async () => {
    const p = await createProject(ctx, { title: "P" });
    const s = await createStudy(ctx, p.id, {
      title: "E",
      nature: "published",
      referenceDoi: "10.1000/x",
      referenceLicense: "CC-BY-4.0",
      blankCorrected: "no",
    });
    const m = await prisma.method.create({
      data: {
        studyId: s.id,
        name: "Py-GC/MS",
        nameKey: "py-gc/ms",
        technique: "py_gc_ms",
      },
    });
    await prisma.detectionLimit.create({
      data: {
        studyId: s.id,
        methodId: m.id,
        polymer: "PET",
        lod: 0.5,
        loq: null,
        unitCode: "ug_per_ml",
        source: "Tableau 2",
      },
    });
    expect(await buildStudyContext(ctx, s.id)).toEqual({
      data_nature: "published",
      methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
      limits: [
        {
          method: "Py-GC/MS",
          polymer: "PET",
          lod: 0.5,
          loq: null,
          unit_code: "ug_per_ml",
          source: "Tableau 2",
        },
      ],
      reference_doi: "10.1000/x",
      reference_license: "CC-BY-4.0",
      blank_corrected: "no",
    });
    const full = await getStudy(ctx, s.id);
    expect(full?.project.id).toBe(p.id);
    expect(full?.methods).toHaveLength(1);
    expect(full?.limits).toHaveLength(1);
    expect(await getStudy(ctx, "inconnu")).toBeNull();
  });

  it("étude introuvable", async () => {
    await expect(buildStudyContext(ctx, "inconnu")).rejects.toThrow("Étude introuvable.");
  });
});
