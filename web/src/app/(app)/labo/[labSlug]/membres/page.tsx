import { notFound } from "next/navigation";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/labels";
import { requireLab } from "@/server/lab-context";
import { listMembers, listPendingInvitations } from "@/server/members";
import {
  InviteForm,
  RemoveMemberButton,
  RevokeInvitationButton,
  RoleControl,
} from "./controls";

export default async function MembresPage({
  params,
}: {
  params: Promise<{ labSlug: string }>;
}) {
  const { labSlug } = await params;
  const ctx = await requireLab(labSlug);
  // Réservé aux responsables : pour les autres la page n'existe pas.
  if (ctx.role !== "lab_admin") notFound();
  const [members, invitations] = await Promise.all([
    listMembers(ctx),
    listPendingInvitations(ctx),
  ]);
  return (
    <>
      <PageHeader title="Membres" subtitle={ctx.labName} />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Membres du laboratoire</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Adresse e-mail</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Depuis</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell className="min-w-44">
                  <RoleControl
                    labSlug={labSlug}
                    membershipId={m.id}
                    role={m.role}
                    memberName={m.name}
                  />
                </TableCell>
                <TableCell>
                  <DateTimeFr value={m.createdAt} />
                </TableCell>
                <TableCell>
                  <RemoveMemberButton
                    labSlug={labSlug}
                    membershipId={m.id}
                    memberName={m.name}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Invitations en attente</h2>
        {invitations.length === 0 ? (
          <EmptyState title="Aucune invitation en attente." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adresse e-mail</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Expire le</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.email}</TableCell>
                  <TableCell>{ROLE_LABELS[i.role]}</TableCell>
                  <TableCell>
                    <DateTimeFr value={i.expiresAt} />
                  </TableCell>
                  <TableCell>
                    <RevokeInvitationButton
                      labSlug={labSlug}
                      invitationId={i.id}
                      email={i.email}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Inviter une personne</h2>
        <InviteForm labSlug={labSlug} />
      </section>
    </>
  );
}
