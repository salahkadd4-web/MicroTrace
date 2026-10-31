import { History, MailOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { Section } from "@/components/app/Section";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auditActionLabel } from "@/lib/audit-labels";
import { ROLE_LABELS } from "@/lib/labels";
import { TRAINING_CONSENT_DETAILS, TRAINING_CONSENT_LABEL } from "@/lib/training-consent";
import { requireLab } from "@/server/lab-context";
import { listMembers, listPendingInvitations } from "@/server/members";
import { getTrainingConsent } from "@/server/training-consent";
import { ConsentControls } from "./ConsentControls";
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
  const [members, invitations, consent] = await Promise.all([
    listMembers(ctx),
    listPendingInvitations(ctx),
    getTrainingConsent(ctx),
  ]);
  return (
    <>
      <PageHeader title="Membres" subtitle={ctx.labName} />
      <Section title="Membres du laboratoire">
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
      </Section>
      <Section title="Invitations en attente">
        {invitations.length === 0 ? (
          <EmptyState icon={MailOpen} title="Aucune invitation en attente." />
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
      </Section>
      <Section title="Inviter une personne">
        <InviteForm labSlug={labSlug} />
      </Section>
      <Section title="Données et amélioration des modèles">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{TRAINING_CONSENT_LABEL}</p>
            {consent.granted ? (
              <Badge variant="positive">Activé</Badge>
            ) : (
              <Badge variant="neutral">Désactivé</Badge>
            )}
          </div>
          {consent.granted ? (
            <p className="text-sm text-muted-foreground">
              Depuis le <DateTimeFr value={consent.grantedAt} />
              {consent.grantedBy ? `, par ${consent.grantedBy}` : ""}
              {consent.version ? ` (texte ${consent.version})` : ""}.
            </p>
          ) : null}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {TRAINING_CONSENT_DETAILS.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <ConsentControls labSlug={labSlug} granted={consent.granted} />
          {consent.granted ? (
            <ul className="flex flex-wrap gap-4 text-sm">
              <li>
                <a
                  href={`/labo/${labSlug}/membres/export-entrainement?format=json`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Exporter les données consenties (JSON)
                </a>
              </li>
              <li>
                <a
                  href={`/labo/${labSlug}/membres/export-entrainement?format=csv`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Exporter les données consenties (CSV)
                </a>
              </li>
            </ul>
          ) : null}
          {consent.history.length === 0 ? (
            <EmptyState icon={History} title="Aucun événement de consentement ou d'export." />
          ) : (
            <Table>
              <TableCaption className="sr-only">Historique</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consent.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <DateTimeFr value={h.at} />
                    </TableCell>
                    <TableCell>{auditActionLabel(h.action)}</TableCell>
                    <TableCell>{h.by ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Section>
    </>
  );
}
