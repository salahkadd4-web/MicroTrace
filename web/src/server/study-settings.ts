import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Technique } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { engineClient } from "@/server/engine/client";
import { QC_KINDS, UNIT_CODES } from "@/server/engine/enums";
import { DomainError } from "@/server/errors";
import {
  ENGINE_TX_OPTIONS,
  buildStudyContext,
  loadWritable,
  validateOrRefuse,
} from "@/server/studies";
import type { SessionUser } from "@/server/users";

/** Clé d'unicité d'un nom de méthode : rogné, minuscules, espaces internes réduits. */
function toNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function required(value: string, message = "Champ obligatoire manquant."): string {
  const t = value.trim();
  if (!t) throw new DomainError(message);
  return t;
}

const DUPLICATE_METHOD = "Méthode déjà définie.";

export type NewMethod = { name: string; technique: Technique };

export async function addMethod(actor: SessionUser, studyId: string, input: NewMethod) {
  const name = required(input.name, "Le nom de la méthode est obligatoire.");
  const nameKey = toNameKey(name);
  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, studyId);
    const existing = await tx.method.findUnique({
      where: { studyId_nameKey: { studyId, nameKey } },
    });
    if (existing) throw new DomainError(DUPLICATE_METHOD);

    let method;
    try {
      method = await tx.method.create({
        data: { studyId, name, nameKey, technique: input.technique },
      });
    } catch (e) {
      // Course entre le contrôle et l'insertion : seule la contrainte d'unicité est traduite.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DomainError(DUPLICATE_METHOD);
      }
      throw e;
    }
    await validateOrRefuse(await buildStudyContext(studyId, tx));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.method.add",
      entityType: "Method",
      entityId: method.id,
      after: { studyId, name, nameKey, technique: method.technique },
    });
    return method;
  }, ENGINE_TX_OPTIONS);
}

export type LimitInput = {
  methodId: string;
  polymer: string;
  lod: number | null;
  loq: number | null;
  unitCode: string;
  source: string;
};

function limitSnapshot(l: {
  methodId: string;
  polymer: string;
  lod: number | null;
  loq: number | null;
  unitCode: string;
  source: string;
}) {
  return {
    methodId: l.methodId,
    polymer: l.polymer,
    lod: l.lod,
    loq: l.loq,
    unitCode: l.unitCode,
    source: l.source,
  };
}

export async function upsertDetectionLimit(
  actor: SessionUser,
  studyId: string,
  input: LimitInput,
) {
  const polymer = required(input.polymer);
  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, studyId);
    const method = await tx.method.findFirst({ where: { id: input.methodId, studyId } });
    if (!method) throw new DomainError("Méthode introuvable.");

    const previous = await tx.detectionLimit.findUnique({
      where: { studyId_methodId_polymer: { studyId, methodId: method.id, polymer } },
    });
    const data = {
      lod: input.lod,
      loq: input.loq,
      unitCode: input.unitCode,
      source: input.source,
    };
    const limit = await tx.detectionLimit.upsert({
      where: { studyId_methodId_polymer: { studyId, methodId: method.id, polymer } },
      create: { studyId, methodId: method.id, polymer, ...data },
      update: data,
    });
    await validateOrRefuse(await buildStudyContext(studyId, tx));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.limit.upsert",
      entityType: "DetectionLimit",
      entityId: limit.id,
      before: previous ? limitSnapshot(previous) : undefined,
      after: limitSnapshot(limit),
    });
    return limit;
  }, ENGINE_TX_OPTIONS);
}

export async function removeDetectionLimit(actor: SessionUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.detectionLimit.findUnique({ where: { id } });
    if (!current) throw new DomainError("Limite introuvable.");
    await loadWritable(tx, current.studyId);
    const active = await tx.importRun.count({
      where: { studyId: current.studyId, status: "active" },
    });
    if (active > 0) throw new DomainError("Paramètre utilisé par un import actif.");

    await tx.detectionLimit.delete({ where: { id } });
    await validateOrRefuse(await buildStudyContext(current.studyId, tx));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.limit.remove",
      entityType: "DetectionLimit",
      entityId: id,
      before: { id: current.id, studyId: current.studyId, ...limitSnapshot(current) },
    });
    return current;
  }, ENGINE_TX_OPTIONS);
}

export type QcInput = {
  polymer: string;
  kind: string;
  n: number;
  mean: number | null;
  sd: number | null;
  unitCode: string;
  source: string;
};

const QC_KIND_SET: ReadonlySet<string> = new Set(QC_KINDS);
const UNIT_SET: ReadonlySet<string> = new Set(UNIT_CODES);

/** Contrôles qualité : hors contexte moteur, seules des vérifications de forme (pas de règle scientifique). */
export async function addQcSummary(actor: SessionUser, studyId: string, input: QcInput) {
  if (!QC_KIND_SET.has(input.kind)) throw new DomainError("Type de contrôle inconnu.");
  if (!UNIT_SET.has(input.unitCode)) throw new DomainError("Unité inconnue.");
  if (!Number.isInteger(input.n) || input.n < 1) throw new DomainError("Effectif invalide.");
  const finiteOrNull = (v: number | null) => v === null || Number.isFinite(v);
  if (!finiteOrNull(input.mean) || !finiteOrNull(input.sd) || (input.sd !== null && input.sd < 0)) {
    throw new DomainError("Valeur invalide.");
  }
  const polymer = required(input.polymer);
  const source = required(input.source);

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, studyId);
    const qc = await tx.qualityControlSummary.create({
      data: {
        studyId,
        polymer,
        kind: input.kind,
        n: input.n,
        mean: input.mean,
        sd: input.sd,
        unitCode: input.unitCode,
        source,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.qc.add",
      entityType: "QualityControlSummary",
      entityId: qc.id,
      after: {
        studyId,
        polymer,
        kind: qc.kind,
        n: qc.n,
        mean: qc.mean,
        sd: qc.sd,
        unitCode: qc.unitCode,
        source,
      },
    });
    return qc;
  }, ENGINE_TX_OPTIONS);
}

/** Préremplit méthode et limites du Tableau 3 (Leslie) depuis l'exemple du moteur, sans rien écraser. */
export async function prefillLeslieTable3(actor: SessionUser, studyId: string) {
  // Appel au moteur avant d'ouvrir la transaction : s'il échoue, rien n'est écrit.
  const example = (await engineClient.example()).context;

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, studyId);
    const methodIds = new Map<string, string>(); // nameKey -> id
    for (const m of await tx.method.findMany({ where: { studyId } })) {
      methodIds.set(m.nameKey, m.id);
    }
    const createdMethodIds: string[] = [];
    for (const m of example.methods) {
      const nameKey = toNameKey(m.name);
      if (methodIds.has(nameKey)) continue;
      const created = await tx.method.create({
        data: { studyId, name: m.name.trim(), nameKey, technique: m.technique },
      });
      methodIds.set(nameKey, created.id);
      createdMethodIds.push(created.id);
    }

    const createdLimitIds: string[] = [];
    for (const l of example.limits ?? []) {
      const methodId = methodIds.get(toNameKey(l.method));
      if (!methodId) throw new DomainError("Méthode introuvable.");
      const found = await tx.detectionLimit.findUnique({
        where: { studyId_methodId_polymer: { studyId, methodId, polymer: l.polymer } },
      });
      if (found) continue;
      const created = await tx.detectionLimit.create({
        data: {
          studyId,
          methodId,
          polymer: l.polymer,
          lod: l.lod,
          loq: l.loq,
          unitCode: l.unit_code,
          source: l.source,
        },
      });
      createdLimitIds.push(created.id);
    }

    const result = {
      methodsCreated: createdMethodIds.length,
      limitsCreated: createdLimitIds.length,
    };
    if (result.methodsCreated === 0 && result.limitsCreated === 0) return result;

    await validateOrRefuse(await buildStudyContext(studyId, tx));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.prefill.leslie3",
      entityType: "Study",
      entityId: studyId,
      after: {
        ...result,
        ids: { methods: createdMethodIds, limits: createdLimitIds },
      },
    });
    return result;
  }, ENGINE_TX_OPTIONS);
}
