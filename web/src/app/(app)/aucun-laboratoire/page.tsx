import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { requireUser } from "@/server/session";
import { logout } from "../actions";

export default async function AucunLaboratoirePage() {
  const user = await requireUser();
  return (
    <AppShell userName={user.name} signOutAction={logout}>
      <PageHeader title="Aucun laboratoire" />
      <EmptyState
        title="Vous n'êtes membre d'aucun laboratoire."
        description="Demandez à un responsable de laboratoire de vous inviter."
      />
    </AppShell>
  );
}
