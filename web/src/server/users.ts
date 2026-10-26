import "server-only";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import type { Tx } from "@/server/audit";

const COST = 12;
const MAX_PASSWORD_BYTES = 72; // limite de bcrypt
const MAX_EMAIL_LENGTH = 254;
const MAX_LOGIN_PASSWORD_LENGTH = 1024;
const MIN_PASSWORD_LENGTH = 12;
// Hachage factice (coût 12) comparé quand l'utilisateur est inconnu ou inactif.
const DUMMY_HASH =
  "$2b$12$u6Rl/9QqAuuhzND7yrVdo.w.QrYGCPnACNaAtc3ZqXCDGK8vVUiWC";

export type SessionUser = { id: string; name: string; email: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Forme d'une adresse e-mail (déjà normalisée) ; refus en français. */
export function assertEmailShape(email: string): void {
  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+$/.test(email))
    throw new DomainError("Adresse e-mail invalide.");
}

export type PreparedUser = { email: string; name: string; passwordHash: string };

/** Valide (forme seulement) et hache : à faire avant d'ouvrir une transaction (bcrypt est lent). */
export async function prepareUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<PreparedUser> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  assertEmailShape(email);
  if (!name) throw new DomainError("Le nom est obligatoire.");
  if (input.password.length < MIN_PASSWORD_LENGTH)
    throw new DomainError(
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  if (Buffer.byteLength(input.password, "utf8") > MAX_PASSWORD_BYTES)
    throw new DomainError(
      `Le mot de passe ne doit pas dépasser ${MAX_PASSWORD_BYTES} octets.`,
    );
  return { email, name, passwordHash: await bcrypt.hash(input.password, COST) };
}

/** Crée l'utilisateur et son audit `user.create` dans la transaction de l'appelant. */
export async function createPreparedUser(
  tx: Tx,
  prepared: PreparedUser,
  isPlatformAdmin = false,
) {
  const user = await tx.user.create({ data: { ...prepared, isPlatformAdmin } });
  await tx.auditEvent.create({
    data: {
      actorId: user.id,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      after: {
        email: user.email,
        name: user.name,
        active: user.active,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    },
  });
  return user;
}

export const EMAIL_TAKEN = "Cette adresse e-mail est déjà utilisée.";

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  isPlatformAdmin?: boolean;
}) {
  const prepared = await prepareUser(input);
  try {
    return await prisma.$transaction((tx) =>
      createPreparedUser(tx, prepared, input.isPlatformAdmin ?? false),
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError(EMAIL_TAKEN);
    throw e;
  }
}

/** Vérifie les identifiants ; null si invalides. Écrit user.login en cas de succès. */
export async function authorize(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  if (
    email.length > MAX_EMAIL_LENGTH ||
    password.length > MAX_LOGIN_PASSWORD_LENGTH
  )
    return null;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) return null;
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "user.login",
      entityType: "User",
      entityId: user.id,
    },
  });
  return { id: user.id, name: user.name, email: user.email };
}
