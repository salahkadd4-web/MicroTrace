import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", async (orig) => {
  const actual = await orig<typeof import("@/server/audit")>();
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { validateContext: vi.fn(), example: vi.fn() } };
});

import * as auditModule from "@/server/audit";
import { prisma } from "@/server/db";
import { EngineError, EngineUnavailableError, engineClient } from "@/server/engine/client";
import { QC_KINDS, TECHNIQUES, UNIT_CODES } from "@/server/engine/enums";
import { createProject } from "@/server/projects";
import {
  addMethod,
  addQcSummary,
  prefillLeslieTable3,
  removeDetectionLimit,
  upsertDetectionLimit,
} from "@/server/study-settings";
import { archiveStudy, createStudy } from "@/server/studies";
import { createUser, type SessionUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab } from "../../../test/labs";

const validate = vi.mocked(engineClient.validateContext);
const example = vi.mocked(engineClient.example);

let actor: SessionUser;
let lab: { id: string };

beforeEach(async () => {
  await resetDb();
  lab = await makeLab("Labo");
  validate.mockReset();
  validate.mockResolvedValue({} as never);
  example.mockReset();
  const u = await createUser({
    email: "a@example.org",
    name: "A",
    password: "mot-de-passe-solide-1",
  });
  actor = { id: u.id, name: u.name, email: u.email };
});

const audits = (action: string) => prisma.auditEvent.findMany({ where: { action } });
const auditCount = () => prisma.auditEvent.count();

async function newStudy(title = "E") {
  const p = await createProject(actor, { laboratoryId: lab.id, title: "P" + title });
  return createStudy(actor, p.id, { title, nature: "laboratory", blankCorrected: "unknown" });
}

async function studyWithMethod() {
  const s = await newStudy();
  const m = await addMethod(actor, s.id, { name: "Py-GC/MS", technique: "py_gc_ms" });
  return { s, m };
}

const LIMIT = {
  polymer: "PET",
  lod: 0.1,
  loq: 0.3,
  unitCode: "ug/mL",
  source: "Tableau 3",
};

function leslieExample() {
  return {
    context: {
      data_nature: "published",
      methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
      limits: ["PET", "PS_SUM", "PE", "PP", "PVC"].map((polymer, i) => ({
        method: "Py-GC/MS",
        polymer,
        lod: 0.1 * (i + 1),
        loq: 0.3 * (i + 1),
        unit_code: "ug/mL",
        source: "Leslie 2022, Tableau 3",
      })),
      reference_doi: "10.1000/x",
      reference_license: "CC-BY-4.0",
      blank_corrected: "no",
    },
  } as never;
}

describe("enums", () => {
  it("couvrent les unions du moteur (le contrôle exact est fait à la compilation)", () => {
    expect(UNIT_CODES).toContain("ug/mL");
    expect(new Set(UNIT_CODES).size).toBe(UNIT_CODES.length);
    expect([...QC_KINDS]).toEqual(["procedural_blank", "field_blank", "spiked"]);
    expect(TECHNIQUES).toHaveLength(5);
  });
});

describe("addMethod", () => {
  it("crée la méthode, nameKey normalisée, audit, revalidation", async () => {
    const s = await newStudy();
    const m = await addMethod(actor, s.id, { name: "  Py-GC/MS  ", technique: "py_gc_ms" });
    expect(m.name).toBe("Py-GC/MS");
    expect(m.nameKey).toBe("py-gc/ms");
    expect(validate).toHaveBeenLastCalledWith(
      expect.objectContaining({ methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }] }),
    );
    const ev = await audits("study.method.add");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entityType: "Method", entityId: m.id, actorId: actor.id });
  });

  it("nameKey : minuscules et espaces internes réduits", async () => {
    const s = await newStudy();
    const m = await addMethod(actor, s.id, { name: "Micro   FTIR \t X", technique: "micro_ftir" });
    expect(m.nameKey).toBe("micro ftir x");
  });

  it("refuse un nom vide", async () => {
    const s = await newStudy();
    await expect(addMethod(actor, s.id, { name: "  ", technique: "other" })).rejects.toThrow(
      "Le nom de la méthode est obligatoire.",
    );
  });

  it("refuse un doublon (casse/espaces) sans nouvelle ligne ni audit", async () => {
    const { s } = await studyWithMethod();
    await expect(
      addMethod(actor, s.id, { name: " py-gc/ms ", technique: "py_gc_ms" }),
    ).rejects.toThrow("Méthode déjà définie.");
    expect(await prisma.method.count()).toBe(1);
    expect(await audits("study.method.add")).toHaveLength(1);
  });

  it("même nom autorisé dans une autre étude", async () => {
    await studyWithMethod();
    const s2 = await newStudy("E2");
    await expect(
      addMethod(actor, s2.id, { name: "Py-GC/MS", technique: "py_gc_ms" }),
    ).resolves.toBeTruthy();
  });

  it("course : une violation unique P2002 devient « Méthode déjà définie. »", async () => {
    const s = await newStudy();
    await addMethod(actor, s.id, { name: "M", technique: "other" });
    // simule la concurrence : le contrôle préalable ne voit pas la méthode existante
    const real = prisma.$transaction.bind(prisma) as (fn: unknown, opts?: unknown) => unknown;
    const bind = (t: object, k: string | symbol) => {
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    };
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      fn: (tx: object) => unknown,
      opts: unknown,
    ) =>
      real((tx: object) => {
        const methodProxy = new Proxy(Reflect.get(tx, "method") as object, {
          get: (m, j) => (j === "findUnique" ? async () => null : bind(m, j)),
        });
        return fn(
          new Proxy(tx, { get: (t, k) => (k === "method" ? methodProxy : bind(t, k)) }),
        );
      }, opts)) as never);
    await expect(addMethod(actor, s.id, { name: "M", technique: "other" })).rejects.toThrow(
      "Méthode déjà définie.",
    );
    spy.mockRestore();
    expect(await prisma.method.count()).toBe(1);
  });

  it("422 du moteur : aucune ligne, aucun audit", async () => {
    const s = await newStudy();
    const before = await auditCount();
    validate.mockRejectedValue(new EngineError(422, "Refusé par le moteur."));
    await expect(addMethod(actor, s.id, { name: "M", technique: "other" })).rejects.toThrow(
      "Refusé par le moteur.",
    );
    expect(await prisma.method.count()).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("étude archivée et étude inconnue", async () => {
    const s = await newStudy();
    await archiveStudy(actor, s.id, "fin");
    await expect(addMethod(actor, s.id, { name: "M", technique: "other" })).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
    await expect(addMethod(actor, "inconnue", { name: "M", technique: "other" })).rejects.toThrow(
      "Étude introuvable.",
    );
  });

  it("annule la méthode si l'audit échoue", async () => {
    const s = await newStudy();
    vi.mocked(auditModule.recordAudit).mockRejectedValueOnce(new Error("audit KO"));
    await expect(addMethod(actor, s.id, { name: "M", technique: "other" })).rejects.toThrow(
      "audit KO",
    );
    expect(await prisma.method.count()).toBe(0);
  });
});

describe("upsertDetectionLimit", () => {
  it("crée puis met à jour avec before/after, revalide avec la limite", async () => {
    const { s, m } = await studyWithMethod();
    const l1 = await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    expect(validate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limits: [
          expect.objectContaining({ method: "Py-GC/MS", polymer: "PET", lod: 0.1, loq: 0.3 }),
        ],
      }),
    );
    const l2 = await upsertDetectionLimit(actor, s.id, {
      methodId: m.id,
      ...LIMIT,
      polymer: " PET ",
      lod: 0.2,
      loq: null,
    });
    expect(l2.id).toBe(l1.id);
    expect(await prisma.detectionLimit.count()).toBe(1);
    const ev = await prisma.auditEvent.findMany({
      where: { action: "study.limit.upsert" },
      orderBy: { createdAt: "asc" },
    });
    expect(ev).toHaveLength(2);
    expect(ev[0].before).toBeNull();
    expect(ev[0].after).toMatchObject({ polymer: "PET", lod: 0.1 });
    expect(ev[1].before).toMatchObject({ lod: 0.1, loq: 0.3 });
    expect(ev[1].after).toMatchObject({ lod: 0.2, loq: null });
    expect(ev[1]).toMatchObject({ entityType: "DetectionLimit", entityId: l1.id });
  });

  it("méthode d'une autre étude ou inconnue : « Méthode introuvable. »", async () => {
    const { m } = await studyWithMethod();
    const other = await newStudy("E2");
    await expect(
      upsertDetectionLimit(actor, other.id, { methodId: m.id, ...LIMIT }),
    ).rejects.toThrow("Méthode introuvable.");
    await expect(
      upsertDetectionLimit(actor, other.id, { methodId: "x", ...LIMIT }),
    ).rejects.toThrow("Méthode introuvable.");
    expect(await prisma.detectionLimit.count()).toBe(0);
  });

  it("refuse un polymère vide", async () => {
    const { s, m } = await studyWithMethod();
    await expect(
      upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT, polymer: " " }),
    ).rejects.toThrow("Champ obligatoire manquant.");
  });

  it("LOD > LOQ refusé par le moteur : aucune écriture, aucun audit", async () => {
    const { s, m } = await studyWithMethod();
    const before = await auditCount();
    validate.mockRejectedValue(new EngineError(422, "LOD supérieur au LOQ."));
    await expect(
      upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT, lod: 5, loq: 1 }),
    ).rejects.toThrow("LOD supérieur au LOQ.");
    expect(await prisma.detectionLimit.count()).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("422 sur une mise à jour : la limite garde sa valeur", async () => {
    const { s, m } = await studyWithMethod();
    await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    validate.mockRejectedValue(new EngineError(422, "KO"));
    await expect(
      upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT, lod: 9 }),
    ).rejects.toThrow("KO");
    expect((await prisma.detectionLimit.findFirstOrThrow()).lod).toBe(0.1);
  });

  it("étude archivée refusée", async () => {
    const { s, m } = await studyWithMethod();
    await archiveStudy(actor, s.id, "fin");
    await expect(
      upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT }),
    ).rejects.toThrow("Étude archivée : lecture seule.");
  });
});

describe("removeDetectionLimit", () => {
  it("supprime, revalide et trace l'état précédent complet", async () => {
    const { s, m } = await studyWithMethod();
    const l = await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    await removeDetectionLimit(actor, l.id);
    expect(await prisma.detectionLimit.count()).toBe(0);
    expect(validate).toHaveBeenLastCalledWith(expect.objectContaining({ limits: [] }));
    const ev = await audits("study.limit.remove");
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toMatchObject({
      id: l.id,
      studyId: s.id,
      methodId: m.id,
      polymer: "PET",
      lod: 0.1,
      loq: 0.3,
      unitCode: "ug/mL",
      source: "Tableau 3",
    });
    expect(ev[0].after).toBeNull();
  });

  it("limite introuvable", async () => {
    await expect(removeDetectionLimit(actor, "x")).rejects.toThrow("Limite introuvable.");
  });

  it("refusée si un import actif existe dans l'étude", async () => {
    const { s, m } = await studyWithMethod();
    const l = await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    const file = await prisma.dataFile.create({
      data: {
        studyId: s.id,
        originalName: "a.csv",
        sha256: "abc",
        sizeBytes: 1,
        mimeType: "text/csv",
        storagePath: "x",
        uploadedById: actor.id,
      },
    });
    const run = await prisma.importRun.create({
      data: {
        studyId: s.id,
        dataFileId: file.id,
        mapping: {},
        frozenContext: {},
        rulesVersion: "1",
        engineVersion: "1",
        issues: [],
        createdById: actor.id,
      },
    });
    const before = await auditCount();
    await expect(removeDetectionLimit(actor, l.id)).rejects.toThrow(
      "Paramètre utilisé par un import actif.",
    );
    expect(await prisma.detectionLimit.count()).toBe(1);
    expect(await auditCount()).toBe(before);

    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: "retired", retiredAt: new Date(), retiredReason: "t" },
    });
    await removeDetectionLimit(actor, l.id);
    expect(await prisma.detectionLimit.count()).toBe(0);
  });

  it("étude archivée refusée", async () => {
    const { s, m } = await studyWithMethod();
    const l = await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    await archiveStudy(actor, s.id, "fin");
    await expect(removeDetectionLimit(actor, l.id)).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
    expect(await prisma.detectionLimit.count()).toBe(1);
  });

  it("422 du moteur : la limite est conservée", async () => {
    const { s, m } = await studyWithMethod();
    const l = await upsertDetectionLimit(actor, s.id, { methodId: m.id, ...LIMIT });
    validate.mockRejectedValue(new EngineError(422, "KO"));
    await expect(removeDetectionLimit(actor, l.id)).rejects.toThrow("KO");
    expect(await prisma.detectionLimit.count()).toBe(1);
    expect(await audits("study.limit.remove")).toHaveLength(0);
  });
});

describe("addQcSummary", () => {
  const QC = {
    polymer: "PET",
    kind: "procedural_blank",
    n: 3,
    mean: 0.05,
    sd: 0.01,
    unitCode: "ug/mL",
    source: "Tableau S2",
  };

  it("crée avec audit, sans appeler le moteur", async () => {
    const s = await newStudy();
    validate.mockClear();
    const q = await addQcSummary(actor, s.id, { ...QC, polymer: " PET ", source: " T " });
    expect(q).toMatchObject({ polymer: "PET", source: "T", kind: "procedural_blank", n: 3 });
    expect(validate).not.toHaveBeenCalled();
    const ev = await audits("study.qc.add");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entityType: "QualityControlSummary", entityId: q.id });
  });

  it("accepte mean/sd nuls", async () => {
    const s = await newStudy();
    await expect(addQcSummary(actor, s.id, { ...QC, mean: null, sd: null })).resolves.toBeTruthy();
  });

  const bad: [string, Partial<typeof QC>, string][] = [
    ["kind sample", { kind: "sample" }, "Type de contrôle inconnu."],
    ["kind farfelu", { kind: "zzz" }, "Type de contrôle inconnu."],
    ["unité inconnue", { unitCode: "ug_per_ml" }, "Unité inconnue."],
    ["n = 0", { n: 0 }, "Effectif invalide."],
    ["n décimal", { n: 1.5 }, "Effectif invalide."],
    ["n NaN", { n: NaN }, "Effectif invalide."],
    ["mean infinie", { mean: Infinity }, "Valeur invalide."],
    ["mean NaN", { mean: NaN }, "Valeur invalide."],
    ["sd négatif", { sd: -0.1 }, "Valeur invalide."],
    ["sd infini", { sd: Infinity }, "Valeur invalide."],
    ["polymère vide", { polymer: "  " }, "Champ obligatoire manquant."],
    ["source vide", { source: "" }, "Champ obligatoire manquant."],
  ];
  it.each(bad)("refuse : %s", async (_n, patch, msg) => {
    const s = await newStudy();
    await expect(addQcSummary(actor, s.id, { ...QC, ...patch })).rejects.toThrow(msg);
    expect(await prisma.qualityControlSummary.count()).toBe(0);
    expect(await audits("study.qc.add")).toHaveLength(0);
  });

  it("étude archivée refusée", async () => {
    const s = await newStudy();
    await archiveStudy(actor, s.id, "fin");
    await expect(addQcSummary(actor, s.id, QC)).rejects.toThrow("Étude archivée : lecture seule.");
  });
});

describe("prefillLeslieTable3", () => {
  it("crée 1 méthode et 5 limites, puis 0 au second appel (sans audit)", async () => {
    example.mockResolvedValue(leslieExample());
    const s = await newStudy();
    const r1 = await prefillLeslieTable3(actor, s.id);
    expect(r1).toEqual({ methodsCreated: 1, limitsCreated: 5 });
    expect(await prisma.method.count()).toBe(1);
    expect(await prisma.detectionLimit.count()).toBe(5);
    const ev = await audits("study.prefill.leslie3");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ entityType: "Study", entityId: s.id });
    expect(ev[0].after).toMatchObject({ methodsCreated: 1, limitsCreated: 5 });
    const last = validate.mock.calls.at(-1)?.[0];
    expect(last?.limits).toHaveLength(5);
    const r2 = await prefillLeslieTable3(actor, s.id);
    expect(r2).toEqual({ methodsCreated: 0, limitsCreated: 0 });
    expect(await audits("study.prefill.leslie3")).toHaveLength(1);
  });

  it("n'écrase pas l'existant (méthode et limite déjà présentes)", async () => {
    example.mockResolvedValue(leslieExample());
    const s = await newStudy();
    const m = await addMethod(actor, s.id, { name: "py-gc/ms", technique: "other" });
    await upsertDetectionLimit(actor, s.id, {
      methodId: m.id,
      polymer: "PET",
      lod: 9,
      loq: 9,
      unitCode: "ng/mL",
      source: "perso",
    });
    const r = await prefillLeslieTable3(actor, s.id);
    expect(r).toEqual({ methodsCreated: 0, limitsCreated: 4 });
    const pet = await prisma.detectionLimit.findFirstOrThrow({ where: { polymer: "PET" } });
    expect(pet).toMatchObject({ lod: 9, unitCode: "ng/mL", source: "perso" });
    expect((await prisma.method.findFirstOrThrow()).technique).toBe("other");
  });

  it("moteur indisponible : rien n'est écrit", async () => {
    example.mockRejectedValue(new EngineUnavailableError());
    const s = await newStudy();
    const before = await auditCount();
    await expect(prefillLeslieTable3(actor, s.id)).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(await prisma.method.count()).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("422 de validation : tout est annulé", async () => {
    example.mockResolvedValue(leslieExample());
    const s = await newStudy();
    const before = await auditCount();
    validate.mockRejectedValue(new EngineError(422, "KO"));
    await expect(prefillLeslieTable3(actor, s.id)).rejects.toThrow("KO");
    expect(await prisma.method.count()).toBe(0);
    expect(await prisma.detectionLimit.count()).toBe(0);
    expect(await auditCount()).toBe(before);
  });

  it("étude archivée refusée", async () => {
    example.mockResolvedValue(leslieExample());
    const s = await newStudy();
    await archiveStudy(actor, s.id, "fin");
    await expect(prefillLeslieTable3(actor, s.id)).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
  });
});
