import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { LabSuspendedError, requireLab } from "@/server/lab-context";
import { listMyLaboratories } from "@/server/labs";
import { requireUser } from "@/server/session";
import { logout } from "../../actions";

export default async function LaboLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ labSlug: string }>;
}) {
  const { labSlug } = await params;
  const user = await requireUser();
  let lab;
  try {
    lab = await requireLab(labSlug);
  } catch (e) {
    if (!(e instanceof LabSuspendedError)) throw e;
    // Avis dédié : un message d'erreur levé dans un composant serveur est masqué en production.
    return (
      <AppShell userName={user.name} signOutAction={logout}>
        <EmptyState
          title="Laboratoire suspendu."
          description="L'accès à ce laboratoire est suspendu par l'équipe de la plateforme."
          action={
            <Link href="/" className="underline">
              Retour à l&apos;accueil
            </Link>
          }
        />
      </AppShell>
    );
  }
  const labs = await listMyLaboratories(user.id);
  return (
    <AppShell
      userName={user.name}
      signOutAction={logout}
      lab={{ slug: lab.labSlug, name: lab.labName }}
      labs={labs.filter((l) => !l.suspended)}
    >
      {children}
    </AppShell>
  );
}
