import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: {
      validateContext: vi.fn(async () => ({})),
      example: vi.fn(),
      exampleLeslie2022: vi.fn(),
      suggestMapping: vi.fn(),
      checkImport: vi.fn(),
      summary: vi.fn(),
      quality: vi.fn(),
      report: vi.fn(),
      dictionary: vi.fn(),
    },
  };
});

import * as auditModule from "@/server/audit";
import * as importsModule from "@/server/imports";
import * as examplesModule from "@/server/examples";
import * as invitationsModule from "@/server/invitations";
import * as membersModule from "@/server/members";
import { prisma } from "@/server/db";
import { engineClient } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import * as projectsModule from "@/server/projects";
import * as qualityModule from "@/server/quality";
import * as reportDownloadModule from "@/server/report-download";
import * as resultsModule from "@/server/results";
import * as studiesModule from "@/server/studies";
import * as settingsModule from "@/server/study-settings";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const { listAuditEvents } = auditModule;
const { createExampleStudy } = examplesModule;
const { createInvitation } = invitationsModule;
const {
  checkStagedImport,
  discardStaging,
  existingKeys,
  getImport,
  listImports,
  readStagedSheet,
  retireImport,
  saveImport,
  suggestStagedMapping,
} = importsModule;
const {
  changeMemberRole,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
} = membersModule;
const { createProject, getProject, listProjects } = projectsModule;
const { getStudyQuality, recordQualityDecision } = qualityModule;
const { getStudyResults, loadActiveResultsInput } = resultsModule;
const { buildDictionaryDownload, buildReportDownload, getReportAvailability } =
  reportDownloadModule;
const {
  archiveStudy,
  buildStudyContext,
  createStudy,
  declarePseudonymisation,
  getStudy,
  getStudyView,
  loadWritable,
  updateStudy,
} = studiesModule;
const {
  addMethod,
  addQcSummary,
  prefillLeslieTable3,
  removeDetectionLimit,
  upsertDetectionLimit,
} = settingsModule;

const SIGNAL_KEY = "a1".padEnd(64, "0");
const FORBIDDEN_WRITE = "Action réservée aux chercheurs du laboratoire.";
const FORBIDDEN_ADMIN = "Action réservée aux responsables du laboratoire.";
const MISSING = "id-inexistant";
const TOKEN = "a".repeat(43);
const MAPPING = {
  mode: "long",
  field_columns: {},
  split_aliquot_suffix: false,
} as const;

type Ids = {
  project: string;
  study: string;
  method: string;
  limit: string;
  member: string;
  invitation: string;
  importRun: string;
};

type Outcome = { throws: string } | { returns: (r: unknown, ids: Ids) => void };
type Case = {
  run: (ctx: LabContext, ids: Ids) => Promise<unknown>;
  outcome: Outcome;
};

const STUDY_INPUT = {
  title: "X",
  nature: "laboratory",
  blankCorrected: "unknown",
} as const;
const LIMIT_INPUT = {
  polymer: "PET",
  lod: 0.1,
  loq: 0.3,
  unitCode: "ug/mL",
  source: "s",
};
const QC_INPUT = {
  polymer: "PET",
  kind: "procedural_blank",
  n: 3,
  mean: 1,
  sd: 0.1,
  unitCode: "ug/mL",
  source: "s",
};

/**
 * Une entrée par fonction exportée des services : le test d'énumération échoue si un service
 * ajoute une fonction exportée qui n'est ni ici ni dans NOT_TENANT_FUNCTIONS.
 */
const CASES: Record<string, Record<string, Case>> = {
  projects: {
    createProject: {
      run: (ctx) => createProject(ctx, { title: "Nouveau" }),
      outcome: {
        returns: (r) => expect(r).toMatchObject({ title: "Nouveau" }),
      },
    },
    listProjects: {
      run: (ctx) => listProjects(ctx),
      outcome: {
        returns: (r, ids) =>
          expect((r as { id: string }[]).map((p) => p.id)).not.toContain(
            ids.project,
          ),
      },
    },
    getProject: {
      run: (ctx, ids) => getProject(ctx, ids.project),
      outcome: { returns: (r) => expect(r).toBeNull() },
    },
  },
  studies: {
    buildStudyContext: {
      run: (ctx, ids) => buildStudyContext(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
    createStudy: {
      run: (ctx, ids) => createStudy(ctx, ids.project, STUDY_INPUT),
      outcome: { throws: "Projet introuvable." },
    },
    loadWritable: {
      run: (ctx, ids) =>
        prisma.$transaction((tx) => loadWritable(tx, ctx, ids.study)),
      outcome: { throws: "Étude introuvable." },
    },
    updateStudy: {
      run: (ctx, ids) => updateStudy(ctx, ids.study, { title: "Piraté" }),
      outcome: { throws: "Étude introuvable." },
    },
    declarePseudonymisation: {
      run: (ctx, ids) => declarePseudonymisation(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
    archiveStudy: {
      run: (ctx, ids) => archiveStudy(ctx, ids.study, "motif"),
      outcome: { throws: "Étude introuvable." },
    },
    getStudy: {
      run: (ctx, ids) => getStudy(ctx, ids.study),
      outcome: { returns: (r) => expect(r).toBeNull() },
    },
    getStudyView: {
      run: (ctx, ids) => getStudyView(ctx, ids.study),
      outcome: { returns: (r) => expect(r).toBeNull() },
    },
  },
  "study-settings": {
    addMethod: {
      run: (ctx, ids) =>
        addMethod(ctx, ids.study, { name: "Piraté", technique: "py_gc_ms" }),
      outcome: { throws: "Étude introuvable." },
    },
    upsertDetectionLimit: {
      run: (ctx, ids) =>
        upsertDetectionLimit(ctx, ids.study, {
          methodId: ids.method,
          ...LIMIT_INPUT,
        }),
      outcome: { throws: "Étude introuvable." },
    },
    removeDetectionLimit: {
      run: (ctx, ids) => removeDetectionLimit(ctx, ids.limit),
      outcome: { throws: "Limite introuvable." },
    },
    addQcSummary: {
      run: (ctx, ids) => addQcSummary(ctx, ids.study, QC_INPUT),
      outcome: { throws: "Étude introuvable." },
    },
    prefillLeslieTable3: {
      run: (ctx, ids) => prefillLeslieTable3(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
  },
  audit: {
    listAuditEvents: {
      run: (ctx, ids) => listAuditEvents(ctx, ids.study),
      outcome: { returns: (r) => expect(r).toEqual([]) },
    },
  },
  imports: {
    existingKeys: {
      run: (ctx, ids) => existingKeys(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
    suggestStagedMapping: {
      run: (ctx, ids) => suggestStagedMapping(ctx, ids.study, TOKEN),
      outcome: { throws: "Étude introuvable." },
    },
    readStagedSheet: {
      run: (ctx, ids) => readStagedSheet(ctx, ids.study, TOKEN, "A"),
      outcome: { throws: "Étude introuvable." },
    },
    discardStaging: {
      run: (ctx, ids) => discardStaging(ctx, ids.study, TOKEN),
      outcome: { throws: "Étude introuvable." },
    },
    checkStagedImport: {
      run: (ctx, ids) =>
        checkStagedImport(ctx, ids.study, { token: TOKEN, mapping: MAPPING }),
      outcome: { throws: "Étude introuvable." },
    },
    saveImport: {
      run: (ctx, ids) =>
        saveImport(ctx, ids.study, {
          token: TOKEN,
          mapping: MAPPING,
          acceptWarnings: true,
        }),
      outcome: { throws: "Étude introuvable." },
    },
    retireImport: {
      run: (ctx, ids) => retireImport(ctx, ids.importRun, "motif"),
      outcome: { throws: "Import introuvable." },
    },
    listImports: {
      run: (ctx, ids) => listImports(ctx, ids.study),
      outcome: { returns: (r) => expect(r).toEqual([]) },
    },
    getImport: {
      run: (ctx, ids) => getImport(ctx, ids.importRun),
      outcome: { returns: (r) => expect(r).toBeNull() },
    },
  },
  results: {
    getStudyResults: {
      run: (ctx, ids) => getStudyResults(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
    loadActiveResultsInput: {
      run: (ctx, ids) => loadActiveResultsInput(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
  },
  quality: {
    getStudyQuality: {
      run: (ctx, ids) => getStudyQuality(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
    recordQualityDecision: {
      run: (ctx, ids) =>
        recordQualityDecision(ctx, ids.study, { signalKey: SIGNAL_KEY, decision: "to_check" }),
      outcome: { throws: "Étude introuvable." },
    },
  },
  "report-download": {
    buildReportDownload: {
      run: (ctx, ids) => buildReportDownload(ctx, ids.study, "md"),
      outcome: { throws: "Étude introuvable." },
    },
    buildDictionaryDownload: {
      run: (ctx, ids) => buildDictionaryDownload(ctx, ids.study, "csv"),
      outcome: { throws: "Étude introuvable." },
    },
    getReportAvailability: {
      run: (ctx, ids) => getReportAvailability(ctx, ids.study),
      outcome: { throws: "Étude introuvable." },
    },
  },
  examples: {
    createExampleStudy: {
      run: (ctx) => createExampleStudy(ctx, "fictif"),
      outcome: { returns: (r) => expect(r).toHaveProperty("importRunId") },
    },
  },
  members: {
    listMembers: {
      run: (ctx) => listMembers(ctx),
      outcome: {
        returns: (r, ids) =>
          expect((r as { id: string }[]).map((m) => m.id)).not.toContain(ids.member),
      },
    },
    listPendingInvitations: {
      run: (ctx) => listPendingInvitations(ctx),
      outcome: {
        returns: (r, ids) =>
          expect((r as { id: string }[]).map((i) => i.id)).not.toContain(ids.invitation),
      },
    },
    revokeInvitation: {
      run: (ctx, ids) => revokeInvitation(ctx, ids.invitation),
      outcome: { throws: "Invitation introuvable." },
    },
    changeMemberRole: {
      run: (ctx, ids) => changeMemberRole(ctx, ids.member, "viewer"),
      outcome: { throws: "Membre introuvable." },
    },
    removeMember: {
      run: (ctx, ids) => removeMember(ctx, ids.member),
      outcome: { throws: "Membre introuvable." },
    },
  },
  invitations: {
    createInvitation: {
      run: (ctx) => createInvitation(ctx, { email: "invite@example.org", role: "viewer" }),
      outcome: {
        returns: (r) => expect(r).toMatchObject({ invitation: { email: "invite@example.org" } }),
      },
    },
  },
};

/**
 * Exclusion justifiée : `server/file-store.ts` n'est pas un service de laboratoire (aucun LabContext).
 * Chaque dépôt est lié à (userId, laboratoryId, studyId) et `readStaging` refuse toute autre
 * combinaison ; ce comportement est couvert par `file-store.test.ts`.
 */

/** Exports qui ne portent pas de donnée de laboratoire, avec la raison. */
const NOT_TENANT_FUNCTIONS: Record<string, Record<string, string>> = {
  projects: { normalizeTitle: "assistant pur (forme du titre)" },
  studies: {
    ENGINE_TX_OPTIONS: "constante",
    assertWritable: "assistant pur sur une ligne déjà chargée",
    validateOrRefuse: "appel au moteur sur un contexte déjà construit",
  },
  "study-settings": {},
  imports: {
    INSERT_BATCH_SIZE: "constante",
    MAX_IMPORT_RECORDS: "constante",
    MAX_STUDY_ACTIVE_RECORDS: "constante",
    saveTxOptions: "assistant pur (délai de transaction), sans accès à la base",
    measurementRow: "assistant pur (record du moteur -> colonnes), sans accès à la base",
    measurementRecord: "assistant pur (colonnes -> record du moteur), sans accès à la base",
  },
  audit: {
    recordAudit:
      "écrit dans la transaction de l'appelant ; laboratoryId est obligatoire au typage",
  },
  results: {},
  quality: {},
  "report-download": {},
  examples: {},
  members: {},
  invitations: {
    acceptInvitation: "adressée par jeton secret, sans contexte de laboratoire (voir invitations-members)",
    createFirstAdminInvitation: "réservée à l'équipe de la plateforme (voir invitations-members)",
    createLaboratoryWithFirstAdmin: "réservée à l'équipe de la plateforme (voir invitation-hardening)",
    previewInvitation: "lecture par jeton secret, sans contexte de laboratoire",
  },
};

const MODULES: Record<string, Record<string, unknown>> = {
  projects: projectsModule,
  studies: studiesModule,
  "study-settings": settingsModule,
  audit: auditModule,
  imports: importsModule,
  results: resultsModule,
  quality: qualityModule,
  "report-download": reportDownloadModule,
  examples: examplesModule,
  members: membersModule,
  invitations: invitationsModule,
};

/** Écritures d'un chercheur, pour le test du rôle viewer. */
const WRITES: Record<string, (ctx: LabContext, ids: Ids) => Promise<unknown>> =
  {
    createProject: (ctx) => createProject(ctx, { title: "V" }),
    createExampleStudy: (ctx) => createExampleStudy(ctx, "fictif"),
    createStudy: (ctx, ids) => createStudy(ctx, ids.project, STUDY_INPUT),
    updateStudy: (ctx, ids) => updateStudy(ctx, ids.study, { title: "V" }),
    declarePseudonymisation: (ctx, ids) =>
      declarePseudonymisation(ctx, ids.study),
    archiveStudy: (ctx, ids) => archiveStudy(ctx, ids.study, "motif"),
    addMethod: (ctx, ids) =>
      addMethod(ctx, ids.study, { name: "V", technique: "py_gc_ms" }),
    upsertDetectionLimit: (ctx, ids) =>
      upsertDetectionLimit(ctx, ids.study, {
        methodId: ids.method,
        ...LIMIT_INPUT,
      }),
    removeDetectionLimit: (ctx, ids) => removeDetectionLimit(ctx, ids.limit),
    addQcSummary: (ctx, ids) => addQcSummary(ctx, ids.study, QC_INPUT),
    prefillLeslieTable3: (ctx, ids) => prefillLeslieTable3(ctx, ids.study),
    suggestStagedMapping: (ctx, ids) =>
      suggestStagedMapping(ctx, ids.study, TOKEN),
    readStagedSheet: (ctx, ids) => readStagedSheet(ctx, ids.study, TOKEN, "A"),
    discardStaging: (ctx, ids) => discardStaging(ctx, ids.study, TOKEN),
    checkStagedImport: (ctx, ids) =>
      checkStagedImport(ctx, ids.study, { token: TOKEN, mapping: MAPPING }),
    saveImport: (ctx, ids) =>
      saveImport(ctx, ids.study, {
        token: TOKEN,
        mapping: MAPPING,
        acceptWarnings: true,
      }),
    retireImport: (ctx, ids) => retireImport(ctx, ids.importRun, "motif"),
    recordQualityDecision: (ctx, ids) =>
      recordQualityDecision(ctx, ids.study, { signalKey: SIGNAL_KEY, decision: "to_check" }),
  };

/** Écritures réservées aux responsables. */
const ADMIN_WRITES: Record<string, (ctx: LabContext, ids: Ids) => Promise<unknown>> = {
  createInvitation: (ctx) => createInvitation(ctx, { email: "v@example.org", role: "viewer" }),
  revokeInvitation: (ctx, ids) => revokeInvitation(ctx, ids.invitation),
  changeMemberRole: (ctx, ids) => changeMemberRole(ctx, ids.member, "viewer"),
  removeMember: (ctx, ids) => removeMember(ctx, ids.member),
};

let ctxA: LabContext;
let researcherA: LabContext;
let viewerA: LabContext;
let ctxB: LabContext;
let idsA: Ids;
let idsB: Ids;

async function seed(ctx: LabContext, tag: string): Promise<Ids> {
  const project = await createProject(ctx, { title: `Projet ${tag}` });
  const study = await createStudy(ctx, project.id, {
    ...STUDY_INPUT,
    title: `Étude ${tag}`,
  });
  const method = await addMethod(ctx, study.id, {
    name: `M ${tag}`,
    technique: "py_gc_ms",
  });
  const limit = await upsertDetectionLimit(ctx, study.id, {
    methodId: method.id,
    ...LIMIT_INPUT,
  });
  await addQcSummary(ctx, study.id, QC_INPUT);
  // Un événement de suppression de limite, retrouvé par le journal via son `before.studyId`.
  const removed = await upsertDetectionLimit(ctx, study.id, {
    methodId: method.id,
    ...LIMIT_INPUT,
    polymer: "PS",
  });
  await removeDetectionLimit(ctx, removed.id);
  const file = await prisma.dataFile.create({
    data: {
      studyId: study.id,
      originalName: `${tag}.csv`,
      sha256: tag.repeat(64).slice(0, 64),
      sizeBytes: 1,
      mimeType: "text/csv",
      storagePath: "files/x",
      uploadedById: ctx.userId,
    },
  });
  const run = await prisma.importRun.create({
    data: {
      studyId: study.id,
      dataFileId: file.id,
      mapping: {},
      frozenContext: {},
      rulesVersion: "r",
      engineVersion: "e",
      issues: [],
      createdById: ctx.userId,
    },
  });
  const member = await makeMember(
    { id: ctx.laboratoryId, slug: ctx.labSlug, name: ctx.labName },
    "researcher",
    `membre-${tag}@example.org`,
  );
  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId: member.userId },
  });
  const invitation = await createInvitation(ctx, {
    email: `invite-${tag}@example.org`,
    role: "viewer",
  });
  return {
    project: project.id,
    study: study.id,
    method: method.id,
    limit: limit.id,
    member: membership.id,
    invitation: invitation.invitation.id,
    importRun: run.id,
  };
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(engineClient.validateContext).mockResolvedValue({} as never);
  vi.mocked(engineClient.example).mockResolvedValue({
    filename: "exemple.csv",
    csv_base64: Buffer.from("id\nS1\n").toString("base64"),
    mapping: MAPPING,
    context: { data_nature: "laboratory", methods: [], limits: [], blank_corrected: "unknown" },
  } as never);
  vi.mocked(engineClient.checkImport).mockResolvedValue({
    records: [],
    qc_records: [],
    issues: [],
    n_rows: 1,
    rules_version: "r1",
    has_errors: false,
    counts: { error: 0, warning: 0, info: 0 },
    engine_version: "e1",
    sha256: "x",
    sheet: null,
  } as never);
  const labA = await makeLab("Labo A", "labo-a");
  const labB = await makeLab("Labo B", "labo-b");
  ctxA = await makeMember(labA, "lab_admin", "a@example.org");
  researcherA = await makeMember(labA, "researcher", "ra@example.org");
  viewerA = await makeMember(labA, "viewer", "va@example.org");
  ctxB = await makeMember(labB, "lab_admin", "b@example.org");
  idsA = await seed(ctxA, "A");
  idsB = await seed(ctxB, "B");
});

/** Toutes les lignes des tables de laboratoire (hors mots de passe), pour comparer avant/après. */
async function fullSnapshot() {
  return JSON.stringify({
    projects: await prisma.project.findMany({ orderBy: { id: "asc" } }),
    studies: await prisma.study.findMany({ orderBy: { id: "asc" } }),
    methods: await prisma.method.findMany({ orderBy: { id: "asc" } }),
    limits: await prisma.detectionLimit.findMany({ orderBy: { id: "asc" } }),
    qcs: await prisma.qualityControlSummary.findMany({
      orderBy: { id: "asc" },
    }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: "asc" } }),
    memberships: await prisma.membership.findMany({ orderBy: { id: "asc" } }),
    invitations: await prisma.invitation.findMany({ orderBy: { id: "asc" } }),
    dataFiles: await prisma.dataFile.findMany({ orderBy: { id: "asc" } }),
    importRuns: await prisma.importRun.findMany({ orderBy: { id: "asc" } }),
    measurements: await prisma.measurement.findMany({ orderBy: { id: "asc" } }),
    predictions: await prisma.modelPrediction.findMany({ orderBy: { id: "asc" } }),
  });
}

/** Les seules lignes du laboratoire B, comptes et valeurs. */
async function snapshotOfB() {
  const study = { laboratoryId: ctxB.laboratoryId };
  return JSON.stringify({
    projects: await prisma.project.findMany({
      where: study,
      orderBy: { id: "asc" },
    }),
    studies: await prisma.study.findMany({
      where: study,
      orderBy: { id: "asc" },
    }),
    methods: await prisma.method.findMany({
      where: { study },
      orderBy: { id: "asc" },
    }),
    limits: await prisma.detectionLimit.findMany({
      where: { study },
      orderBy: { id: "asc" },
    }),
    qcs: await prisma.qualityControlSummary.findMany({
      where: { study },
      orderBy: { id: "asc" },
    }),
    audits: await prisma.auditEvent.findMany({
      where: { laboratoryId: ctxB.laboratoryId },
      orderBy: { id: "asc" },
    }),
    memberships: await prisma.membership.findMany({
      where: study,
      orderBy: { id: "asc" },
    }),
    invitations: await prisma.invitation.findMany({
      where: study,
      orderBy: { id: "asc" },
    }),
  });
}

describe("couverture : chaque fonction exportée des services est testée", () => {
  for (const [name, mod] of Object.entries(MODULES)) {
    it(`${name} : exports = cas couverts + exclusions justifiées`, () => {
      const covered = Object.keys(CASES[name]);
      const excluded = Object.keys(NOT_TENANT_FUNCTIONS[name]);
      expect(Object.keys(mod).sort()).toEqual([...covered, ...excluded].sort());
    });
  }
});

describe("un membre de A sur les objets de B", () => {
  for (const [moduleName, cases] of Object.entries(CASES)) {
    for (const [fn, c] of Object.entries(cases)) {
      if (fn === "createProject" || fn === "createInvitation" || fn === "createExampleStudy") continue; // pas d'objet de B en entrée : voir « création »
      it(`${moduleName}.${fn} : même réponse que pour un identifiant inexistant, B inchangé`, async () => {
        const missing: Ids = {
          project: MISSING,
          study: MISSING,
          method: MISSING,
          limit: MISSING,
          member: MISSING,
          invitation: MISSING,
          importRun: MISSING,
        };
        const before = await fullSnapshot();
        const attempt = async (ids: Ids) => {
          if ("throws" in c.outcome) {
            // Message strictement identique pour l'objet de B et pour un identifiant inexistant.
            const error = await c.run(ctxA, ids).then(
              () => null,
              (e: unknown) => e,
            );
            expect(error).toBeInstanceOf(DomainError);
            expect((error as Error).message).toBe(c.outcome.throws);
          } else {
            c.outcome.returns(await c.run(ctxA, ids), ids);
          }
        };
        await attempt(idsB);
        await attempt(missing);
        expect(await fullSnapshot()).toBe(before);
      });
    }
  }

  it("la limite de B vue depuis une étude de A : « Méthode introuvable. », rien n'est écrit", async () => {
    const before = await fullSnapshot();
    await expect(
      upsertDetectionLimit(ctxA, idsA.study, {
        methodId: idsB.method,
        ...LIMIT_INPUT,
      }),
    ).rejects.toThrow("Méthode introuvable.");
    await expect(
      upsertDetectionLimit(ctxA, idsA.study, {
        methodId: MISSING,
        ...LIMIT_INPUT,
      }),
    ).rejects.toThrow("Méthode introuvable.");
    expect(await fullSnapshot()).toBe(before);
  });

  it("createStudy sur le projet de B (IDOR) : « Projet introuvable. », aucune étude créée dans B", async () => {
    const studiesInB = () =>
      prisma.study.count({ where: { laboratoryId: ctxB.laboratoryId } });
    const before = await studiesInB();
    await expect(createStudy(ctxA, idsB.project, STUDY_INPUT)).rejects.toThrow(
      "Projet introuvable.",
    );
    expect(await studiesInB()).toBe(before);
    expect(
      await prisma.study.count({ where: { projectId: idsB.project } }),
    ).toBe(1);
  });

  it("le moteur n'est pas sollicité pour un objet d'un autre laboratoire", async () => {
    const validate = vi.mocked(engineClient.validateContext);
    validate.mockClear();
    await expect(createStudy(ctxA, idsB.project, STUDY_INPUT)).rejects.toThrow(
      "Projet introuvable.",
    );
    await expect(buildStudyContext(ctxA, idsB.study)).rejects.toThrow(
      "Étude introuvable.",
    );
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("création et lectures dans son propre laboratoire", () => {
  it("createExampleStudy écrit dans le laboratoire de l'appelant uniquement", async () => {
    const c = CASES.examples.createExampleStudy;
    const out = await c.run(researcherA, idsA);
    if ("returns" in c.outcome) c.outcome.returns(out, idsA);
    const { studyId, projectId } = out as { studyId: string; projectId: string };
    expect(
      (await prisma.study.findUniqueOrThrow({ where: { id: studyId } })).laboratoryId,
    ).toBe(researcherA.laboratoryId);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).laboratoryId,
    ).toBe(researcherA.laboratoryId);
    expect(await prisma.project.count({ where: { laboratoryId: ctxB.laboratoryId } })).toBe(1);
  });

  it("createProject et createStudy écrivent laboratoryId ; B ne change pas ; chaque audit porte A", async () => {
    const before = await snapshotOfB();
    const p = await createProject(ctxA, { title: "Nouveau" });
    const s = await createStudy(ctxA, p.id, STUDY_INPUT);
    expect(p.laboratoryId).toBe(ctxA.laboratoryId);
    expect(s.laboratoryId).toBe(ctxA.laboratoryId);
    expect(await snapshotOfB()).toBe(before);
    const events = await prisma.auditEvent.findMany({
      where: { entityId: { in: [p.id, s.id] } },
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.laboratoryId === ctxA.laboratoryId)).toBe(
      true,
    );
  });

  it("tout événement du jeu de données porte son laboratoire (aucun événement sans laboratoire)", async () => {
    // Seuls les événements de plateforme (création d'utilisateur) n'ont pas de laboratoire.
    expect(
      await prisma.auditEvent.count({
        where: { laboratoryId: null, entityType: { not: "User" } },
      }),
    ).toBe(0);
    for (const ctx of [ctxA, ctxB]) {
      const n = await prisma.auditEvent.count({
        where: { laboratoryId: ctx.laboratoryId },
      });
      expect(n).toBe(8); // projet, étude, méthode, 2 limites (upsert), qc, retrait, invitation
    }
  });

  it("chaque écriture de service journalise le laboratoire de l'acteur", async () => {
    const m = await addMethod(ctxA, idsA.study, {
      name: "Autre",
      technique: "other",
    });
    await updateStudy(ctxA, idsA.study, { title: "Titre 2" });
    await declarePseudonymisation(ctxA, idsA.study);
    vi.mocked(engineClient.example).mockResolvedValueOnce({
      context: {
        data_nature: "laboratory",
        methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
        limits: [],
      },
    } as never);
    await prefillLeslieTable3(ctxA, idsA.study);
    await archiveStudy(ctxA, idsA.study, "fin");
    const events = await prisma.auditEvent.findMany({
      where: { actorId: ctxA.userId, entityType: { not: "User" } },
    });
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => e.laboratoryId === ctxA.laboratoryId)).toBe(
      true,
    );
    expect(m.studyId).toBe(idsA.study);
  });

  it("listProjects ne renvoie que les projets de A ; getProject, getStudy, getStudyView des siens", async () => {
    expect((await listProjects(ctxA)).map((p) => p.id)).toEqual([idsA.project]);
    expect((await listProjects(ctxB)).map((p) => p.id)).toEqual([idsB.project]);
    expect((await getProject(ctxA, idsA.project))?.id).toBe(idsA.project);
    expect((await getStudy(ctxA, idsA.study))?.id).toBe(idsA.study);
    expect((await getStudyView(ctxA, idsA.study))?.id).toBe(idsA.study);
  });
});

describe("journal", () => {
  it("le journal de A ne contient aucun événement de B", async () => {
    const eventsA = await listAuditEvents(ctxA, idsA.study);
    expect(eventsA.length).toBeGreaterThan(0);
    const idsOfB = new Set(
      (
        await prisma.auditEvent.findMany({
          where: { laboratoryId: ctxB.laboratoryId },
        })
      ).map((e) => e.id),
    );
    expect(eventsA.every((e) => !idsOfB.has(e.id))).toBe(true);
    expect(await listAuditEvents(ctxA, idsB.study)).toEqual([]);
  });

  it("un événement forgé avec le laboratoire de B sur une entité de A n'apparaît pas dans le journal de A", async () => {
    const forged = await prisma.auditEvent.create({
      data: {
        action: "study.update",
        entityType: "Study",
        entityId: idsA.study,
        laboratoryId: ctxB.laboratoryId,
      },
    });
    const events = await listAuditEvents(ctxA, idsA.study);
    expect(events.some((e) => e.id === forged.id)).toBe(false);
  });

  it("un événement de retrait au before.studyId d'une étude de A, mais au laboratoire de B, est ignoré", async () => {
    const forged = await prisma.auditEvent.create({
      data: {
        action: "study.limit.remove",
        entityType: "DetectionLimit",
        entityId: "fantome",
        before: { studyId: idsA.study },
        laboratoryId: ctxB.laboratoryId,
      },
    });
    const events = await listAuditEvents(ctxA, idsA.study);
    expect(events.some((e) => e.id === forged.id)).toBe(false);
  });
});

describe("journal des décisions de qualité", () => {
  it("un événement forgé au laboratoire de B qui vise une prédiction de A est ignoré", async () => {
    const prediction = await prisma.modelPrediction.create({
      data: {
        studyId: idsA.study,
        kind: "quality",
        input: { signalKey: SIGNAL_KEY },
        output: {},
        modelName: "quality-rules",
        modelVersion: "q1",
      },
    });
    const own = await prisma.auditEvent.create({
      data: {
        action: "quality.decision",
        entityType: "ModelPrediction",
        entityId: prediction.id,
        laboratoryId: ctxA.laboratoryId,
      },
    });
    const forged = await prisma.auditEvent.create({
      data: {
        action: "quality.decision",
        entityType: "ModelPrediction",
        entityId: prediction.id,
        laboratoryId: ctxB.laboratoryId,
      },
    });
    const ids = (await listAuditEvents(ctxA, idsA.study)).map((e) => e.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(forged.id);
  });
});

describe("un viewer de A", () => {
  for (const [fn, write] of Object.entries(WRITES)) {
    it(`${fn} : refusé sans aucune écriture`, async () => {
      const before = await fullSnapshot();
      await expect(write(viewerA, idsA)).rejects.toThrow(FORBIDDEN_WRITE);
      expect(await fullSnapshot()).toBe(before);
    });
  }

  for (const [fn, write] of Object.entries(ADMIN_WRITES)) {
    it(`${fn} : refusé au lecteur et au chercheur, sans aucune écriture`, async () => {
      const before = await fullSnapshot();
      await expect(write(viewerA, idsA)).rejects.toThrow(FORBIDDEN_ADMIN);
      await expect(write(researcherA, idsA)).rejects.toThrow(FORBIDDEN_ADMIN);
      expect(await fullSnapshot()).toBe(before);
    });
  }

  it("la gestion des membres lui est fermée, même en lecture", async () => {
    await expect(listMembers(viewerA)).rejects.toThrow(FORBIDDEN_ADMIN);
    await expect(listPendingInvitations(researcherA)).rejects.toThrow(FORBIDDEN_ADMIN);
  });

  it("couvre toutes les écritures des services", () => {
    const readers = new Set([
      "listProjects",
      "getProject",
      "buildStudyContext",
      "getStudy",
      "getStudyView",
      "loadWritable",
      "listAuditEvents",
      "listMembers",
      "listPendingInvitations",
      "existingKeys",
      "listImports",
      "getImport",
      "getStudyResults",
      "loadActiveResultsInput",
      "getStudyQuality",
      "buildReportDownload",
      "buildDictionaryDownload",
      "getReportAvailability",
    ]);
    const exported = Object.entries(CASES).flatMap(([, cases]) =>
      Object.keys(cases),
    );
    const writers = exported.filter((f) => !readers.has(f));
    expect([...Object.keys(WRITES), ...Object.keys(ADMIN_WRITES)].sort()).toEqual(
      writers.sort(),
    );
  });

  it("lit tout dans son laboratoire", async () => {
    expect(await listProjects(viewerA)).toHaveLength(1);
    expect((await getProject(viewerA, idsA.project))?.id).toBe(idsA.project);
    expect((await getStudyView(viewerA, idsA.study))?.id).toBe(idsA.study);
    expect((await loadActiveResultsInput(viewerA, idsA.study)).study.id).toBe(idsA.study);
    expect(await getStudyResults(viewerA, idsA.study)).toEqual({ empty: true });
    expect(await getStudyQuality(viewerA, idsA.study)).toEqual({ kind: "empty", disappeared: [] });
    expect(await buildStudyContext(viewerA, idsA.study)).toMatchObject({
      data_nature: "laboratory",
    });
    expect((await listAuditEvents(viewerA, idsA.study)).length).toBeGreaterThan(
      0,
    );
  });
});
