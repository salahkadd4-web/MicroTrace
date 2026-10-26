import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { LabSuspendedError, requireLab } from "@/server/lab-context";
import { isPlatformAdmin, listMyLaboratories } from "@/server/labs";
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
    const others = (await listMyLaboratories(user.id)).filter(
      (l) => !l.suspended && l.slug !== labSlug,
    );
    // Avis dédié : un message d'erreur levé dans un composant serveur est masqué en production.
    return (
      <AppShell userName={user.name} signOutAction={logout}>
        <PageHeader title="Laboratoire suspendu" />
        <EmptyState
          title="Laboratoire suspendu."
          description="L'accès à ce laboratoire est suspendu par l'équipe de la plateforme."
          action={
            <div className="flex flex-col items-center gap-1">
              {others.map((l) => (
                <Link key={l.slug} href={`/labo/${l.slug}/projets`} className="underline">
                  {l.name}
                </Link>
              ))}
              <Link href="/" className="underline">
                Retour à l&apos;accueil
              </Link>
            </div>
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
      canManageMembers={lab.role === "lab_admin"}
      isPlatformAdmin={await isPlatformAdmin(user.id)}
    >
      {children}
    </AppShell>
  );
}
