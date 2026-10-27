import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // `next build` importe les modules sans se connecter : aucune base n'est requise à ce moment.
  const building = process.env.NEXT_PHASE === "phase-production-build";
  const connectionString =
    process.env.DATABASE_URL ?? (building ? "postgresql://build:build@localhost:5432/build" : undefined);
  if (!connectionString)
    throw new Error(
      "La variable d'environnement DATABASE_URL est absente : renseignez-la dans web/.env.local.",
    );
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
