import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { LabRole } from "@/generated/prisma/enums";
import { recordAudit, type Tx } from "@/server/audit";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import { assertRole, parseLabRole } from "@/server/lab-role";
import { assertPlatformAdmin } from "@/server/platform";
import { lockLaboratory } from "@/server/tx-lock";
import {
  assertEmailShape,
  createPreparedUser,
  isUniqueViolation,
  normalizeEmail,
  prepareUser,
  type SessionUser,
} from "@/server/users";

const TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_TOKEN_LENGTH = 200;

const INVALID_INVITATION = "Invitation invalide ou expirée.";
const ACCOUNT_EXISTS =
  "Un compte existe déjà pour cette adresse : connectez-vous puis rouvrez le lien.";
const WRONG_EMAIL = "Cette invitation est destinée à une autre adresse e-mail.";
const ALREADY_MEMBER = "Vous êtes déjà membre de ce laboratoire.";

/** Empreinte SHA-256 (hex) : seule forme du jeton conservée en base. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreatedInvitation = {
  invitation: { id: string; email: string; role: LabRole; expiresAt: Date };
  /** Jeton en clair : renvoyé une seule fois, jamais stocké ni journalisé. */
  token: string;
};

/** Crée l'invitation dans la transaction de l'appelant ; révoque les invitations en attente du même e-mail. */
async function issue(
  tx: Tx,
  input: { laboratoryId: string; actorId: string; email: string; role: LabRole },
): Promise<CreatedInvitation> {
  const email = normalizeEmail(input.email);
  assertEmailShape(email);
  await lockLaboratory(tx, input.laboratoryId);
  const member = await tx.membership.findFirst({
    where: { laboratoryId: input.laboratoryId, user: { email } },
    select: { id: true },
  });
  if (member) throw new DomainError("Cette personne est déjà membre du laboratoire.");

  const now = new Date();
  const pending = await tx.invitation.findMany({
    where: { laboratoryId: input.laboratoryId, email, usedAt: null, revokedAt: null },
    select: { id: true, role: true },
  });
  for (const p of pending) {
    await tx.invitation.updateMany({
      where: { id: p.id, laboratoryId: input.laboratoryId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "invitation.revoke",
      entityType: "Invitation",
      entityId: p.id,
      before: { email, role: p.role },
      after: { email, role: p.role, revokedAt: now.toISOString() },
      laboratoryId: input.laboratoryId,
    });
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const row = await tx.invitation.create({
    data: {
      laboratoryId: input.laboratoryId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: input.actorId,
      expiresAt,
    },
  });
  await recordAudit(tx, {
    actorId: input.actorId,
    action: "invitation.create",
    entityType: "Invitation",
    entityId: row.id,
    after: { email, role: input.role, expiresAt: expiresAt.toISOString() },
    laboratoryId: input.laboratoryId,
  });
  return { invitation: { id: row.id, email, role: row.role, expiresAt }, token };
}

/** Invite une personne dans le laboratoire du contexte (responsable). */
export async function createInvitation(
  ctx: LabContext,
  input: { email: string; role: string },
): Promise<CreatedInvitation> {
  assertRole(ctx, "lab_admin");
  const role = parseLabRole(input.role);
  return prisma.$transaction((tx) =>
    issue(tx, { laboratoryId: ctx.laboratoryId, actorId: ctx.userId, email: input.email, role }),
  );
}

/** Équipe de la plateforme : invite le premier responsable d'un laboratoire. */
export async function createFirstAdminInvitation(
  admin: SessionUser,
  laboratoryId: string,
  email: string,
): Promise<CreatedInvitation> {
  return prisma.$transaction(async (tx) => {
    await assertPlatformAdmin(tx, admin);
    const lab = await tx.laboratory.findUnique({
      where: { id: laboratoryId },
      select: { id: true },
    });
    if (!lab) throw new DomainError("Laboratoire introuvable.");
    return issue(tx, { laboratoryId: lab.id, actorId: admin.id, email, role: "lab_admin" });
  });
}

/** Invitation valable pour ce jeton (non utilisée, non révoquée, non expirée, laboratoire actif). */
async function findValid(db: Pick<Tx, "invitation">, token: string) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
    return null;
  return db.invitation.findFirst({
    where: {
      tokenHash: hashToken(token),
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      laboratory: { suspendedAt: null },
    },
    include: { laboratory: { select: { slug: true, name: true } } },
  });
}

type ValidInvitation = NonNullable<Awaited<ReturnType<typeof findValid>>>;

export type InvitationPreview =
  | { state: "invalid" }
  | { state: "signup"; labName: string; email: string; role: LabRole }
  | { state: "login-required"; labName: string; role: LabRole }
  | { state: "join"; labName: string; email: string; role: LabRole }
  | { state: "wrong-email"; labName: string }
  | { state: "already-member"; labName: string; labSlug: string };

/** État de la page d'invitation pour le visiteur (connecté ou non). Ne consomme rien. */
export async function previewInvitation(
  token: string,
  viewer: SessionUser | null,
): Promise<InvitationPreview> {
  const inv = await findValid(prisma, token);
  if (!inv) return { state: "invalid" };
  const labName = inv.laboratory.name;
  if (!viewer) {
    const account = await prisma.user.findUnique({
      where: { email: inv.email },
      select: { id: true },
    });
    return account
      ? { state: "login-required", labName, role: inv.role }
      : { state: "signup", labName, email: inv.email, role: inv.role };
  }
  if (normalizeEmail(viewer.email) !== inv.email) return { state: "wrong-email", labName };
  const member = await prisma.membership.findUnique({
    where: { userId_laboratoryId: { userId: viewer.id, laboratoryId: inv.laboratoryId } },
    select: { id: true },
  });
  if (member) return { state: "already-member", labName, labSlug: inv.laboratory.slug };
  return { state: "join", labName, email: inv.email, role: inv.role };
}

/** Usage unique : exactement une transaction obtient la ligne (compte = 1), les autres échouent. */
async function claim(tx: Tx, inv: ValidInvitation): Promise<void> {
  const { count } = await tx.invitation.updateMany({
    where: {
      id: inv.id,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      laboratory: { suspendedAt: null },
    },
    data: { usedAt: new Date() },
  });
  if (count !== 1) throw new DomainError(INVALID_INVITATION);
}

async function finish(tx: Tx, inv: ValidInvitation, userId: string): Promise<void> {
  await tx.membership.create({
    data: { userId, laboratoryId: inv.laboratoryId, role: inv.role },
  });
  await recordAudit(tx, {
    actorId: userId,
    action: "invitation.accept",
    entityType: "Invitation",
    entityId: inv.id,
    after: { email: inv.email, role: inv.role },
    laboratoryId: inv.laboratoryId,
  });
}

export type AcceptInput = { name: string; password: string } | { user: SessionUser };

/**
 * Accepte une invitation : crée le compte (nom et mot de passe) ou rattache l'utilisateur connecté
 * dont l'e-mail correspond. Le jeton n'apparaît dans aucun message d'erreur ni aucun journal.
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInput,
): Promise<{ labSlug: string }> {
  const inv = await findValid(prisma, token);
  if (!inv) throw new DomainError(INVALID_INVITATION);
  const labSlug = inv.laboratory.slug;

  if ("user" in input) {
    const user = input.user;
    if (normalizeEmail(user.email) !== inv.email) throw new DomainError(WRONG_EMAIL);
    const member = await prisma.membership.findUnique({
      where: { userId_laboratoryId: { userId: user.id, laboratoryId: inv.laboratoryId } },
      select: { id: true },
    });
    if (member) throw new DomainError(ALREADY_MEMBER);
    try {
      await prisma.$transaction(async (tx) => {
        await claim(tx, inv);
        await finish(tx, inv, user.id);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError(ALREADY_MEMBER);
      throw e;
    }
    return { labSlug };
  }

  const account = await prisma.user.findUnique({
    where: { email: inv.email },
    select: { id: true },
  });
  if (account) throw new DomainError(ACCOUNT_EXISTS);
  // Validation et hachage avant la transaction : un refus ne consomme pas l'invitation.
  const prepared = await prepareUser({
    email: inv.email,
    name: input.name,
    password: input.password,
  });
  try {
    await prisma.$transaction(async (tx) => {
      await claim(tx, inv);
      const user = await createPreparedUser(tx, prepared);
      await finish(tx, inv, user.id);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError(ACCOUNT_EXISTS);
    throw e;
  }
  return { labSlug };
}
