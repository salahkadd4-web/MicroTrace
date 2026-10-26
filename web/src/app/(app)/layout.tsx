import type { ReactNode } from "react";
import { requireUser } from "@/server/session";

/** Garde de session ; l'en-tête (laboratoire, sélecteur) vit dans /labo/[labSlug]/layout. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}
