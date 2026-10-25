import "server-only";
import type { BlankCorrected, DataNature } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { recordAudit, type Tx } from "@/server/audit";
import { EngineError, engineClient, type StudyContext } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { normalizeTitle } from "@/server/projects";
import type { SessionUser } from "@/server/users";

const ARCHIVED = "Étude archivée : lecture seule.";

/** Refuse toute écriture sur une étude archivée (réutilisé par les services d'import). */
export function assertWritable(study: { archivedAt: Date | null }): void {
  if (study.archivedAt) throw new DomainError(ARCHIVED);
}

type ContextDb = Pick<Tx, "study">;

/** Contexte d'étude au format du moteur, construit depuis la base. */
export async function buildStudyContext(
  studyId: string,
  db: ContextDb = prisma,
): Promise<StudyContext> {
  const study = await db.study.findUnique({
    where: { id: studyId },
    include: {
      methods: { orderBy: { name: "asc" } },
      limits: {
        include: { method: true },
        orderBy: [{ method: { name: "asc" } }, { polymer: "asc" }],
      },
    },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  return {
    data_nature: study.nature,
    methods: study.methods.map((m) => ({
      name: m.name,
      technique: m.technique,
    })),
    limits: study.limits.map((l) => ({
      method: l.method.name,
      polymer: l.polymer,
      lod: l.lod,
      loq: l.loq,
      unit_code: l.unitCode,
      source: l.source,
    })),
    reference_doi: study.referenceDoi,
    reference_license: study.referenceLicense,
    blank_corrected: study.blankCorrected,
  };
}

/** Validation par le moteur ; un 422 devient un refus métier avec le texte du moteur. */
async function validateOrRefuse(context: StudyContext): Promise<void> {
  try {
    await engineClient.validateContext(context);
  } catch (e) {
    if (e instanceof EngineError && e.status === 422) throw new DomainError(e.detail);
    throw e;
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export type NewStudy = {
  title: string;
  nature: DataNature;
  referenceDoi?: string | null;
  referenceLicense?: string | null;
  blankCorrected: BlankCorrected;
};

export async function createStudy(actor: SessionUser, projectId: string, input: NewStudy) {
  const title = normalizeTitle(input.title);
  const referenceDoi = blankToNull(input.referenceDoi);
  const referenceLicense = blankToNull(input.referenceLicense);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new DomainError("Projet introuvable.");

  await validateOrRefuse({
    data_nature: input.nature,
    methods: [],
    limits: [],
    reference_doi: referenceDoi,
    reference_license: referenceLicense,
    blank_corrected: input.blankCorrected,
  });

  return prisma.$transaction(async (tx) => {
    const study = await tx.study.create({
      data: {
        projectId,
        title,
        nature: input.nature,
        referenceDoi,
        referenceLicense,
        blankCorrected: input.blankCorrected,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.create",
      entityType: "Study",
      entityId: study.id,
      after: {
        projectId,
        title,
        nature: study.nature,
        referenceDoi,
        referenceLicense,
        blankCorrected: study.blankCorrected,
      },
    });
    return study;
  });
}

export type StudyPatch = {
  title?: string;
  nature?: DataNature;
  referenceDoi?: string | null;
  referenceLicense?: string | null;
  blankCorrected?: BlankCorrected;
};

async function loadWritable(tx: Tx, studyId: string) {
  const study = await tx.study.findUnique({ where: { id: studyId } });
  if (!study) throw new DomainError("Étude introuvable.");
  assertWritable(study);
  return study;
}

export async function updateStudy(actor: SessionUser, studyId: string, patch: StudyPatch) {
  return prisma.$transaction(async (tx) => {
    const current = await loadWritable(tx, studyId);
    const next: StudyPatch = {};
    if (patch.title !== undefined) next.title = normalizeTitle(patch.title);
    if (patch.nature !== undefined) next.nature = patch.nature;
    if (patch.referenceDoi !== undefined) next.referenceDoi = blankToNull(patch.referenceDoi);
    if (patch.referenceLicense !== undefined)
      next.referenceLicense = blankToNull(patch.referenceLicense);
    if (patch.blankCorrected !== undefined) next.blankCorrected = patch.blankCorrected;

    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    for (const f of Object.keys(next) as (keyof StudyPatch)[]) {
      if (next[f] !== current[f]) {
        before[f] = current[f];
        after[f] = next[f] ?? null;
      }
    }
    if (Object.keys(after).length === 0) return current;

    const updated = await tx.study.update({
      where: { id: studyId },
      data: next,
    });
    await validateOrRefuse(await buildStudyContext(studyId, tx));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.update",
      entityType: "Study",
      entityId: studyId,
      before,
      after,
    });
    return updated;
  });
}

export async function declarePseudonymisation(actor: SessionUser, studyId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await loadWritable(tx, studyId);
    if (current.pseudonymDeclaredAt) throw new DomainError("Pseudonymisation déjà déclarée.");
    const now = new Date();
    const updated = await tx.study.update({
      where: { id: studyId },
      data: { pseudonymDeclaredAt: now, pseudonymDeclaredById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.pseudonymisation.declare",
      entityType: "Study",
      entityId: studyId,
      before: { pseudonymDeclaredAt: null },
      after: { pseudonymDeclaredAt: now.toISOString() },
    });
    return updated;
  });
}

export async function archiveStudy(actor: SessionUser, studyId: string, reason: string) {
  const motif = reason.trim();
  return prisma.$transaction(async (tx) => {
    const current = await loadWritable(tx, studyId);
    if (!motif) throw new DomainError("Le motif d'archivage est obligatoire.");
    const now = new Date();
    const updated = await tx.study.update({
      where: { id: studyId },
      data: { archivedAt: now },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "study.archive",
      entityType: "Study",
      entityId: studyId,
      before: {
        archivedAt: current.archivedAt ? current.archivedAt.toISOString() : null,
      },
      after: { archivedAt: now.toISOString(), reason: motif },
    });
    return updated;
  });
}

export function getStudy(studyId: string) {
  return prisma.study.findUnique({
    where: { id: studyId },
    include: { project: true, methods: true, limits: true, qcSummaries: true },
  });
}
