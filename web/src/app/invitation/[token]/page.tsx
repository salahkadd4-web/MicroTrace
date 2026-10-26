import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ROLE_LABELS } from "@/lib/labels";
import { previewInvitation } from "@/server/invitations";
import { getOptionalUser } from "@/server/session";
import { JoinInvitationForm, SignupInvitationForm } from "./forms";

// Le jeton est dans l'adresse de la page : jamais transmis en en-tête Referer, jamais indexé.
export const metadata: Metadata = {
  title: "Invitation",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const viewer = await getOptionalUser();
  const preview = await previewInvitation(token, viewer);

  let body: ReactNode;
  switch (preview.state) {
    case "invalid":
      body = (
        <Alert variant="destructive">
          <AlertDescription>Invitation invalide ou expirée.</AlertDescription>
        </Alert>
      );
      break;
    case "signup":
      body = (
        <>
          <Intro labName={preview.labName} role={preview.role} />
          <SignupInvitationForm token={token} email={preview.email} />
        </>
      );
      break;
    case "login-required":
      body = (
        <>
          <Intro labName={preview.labName} role={preview.role} />
          <Alert>
            <AlertDescription>
              Un compte existe déjà pour cette adresse : connectez-vous puis rouvrez le lien.
            </AlertDescription>
          </Alert>
          <Link
            href={`/connexion?callbackUrl=${encodeURIComponent(`/invitation/${token}`)}`}
            className="underline"
          >
            Se connecter
          </Link>
        </>
      );
      break;
    case "join":
      body = (
        <>
          <Intro labName={preview.labName} role={preview.role} />
          <JoinInvitationForm token={token} />
        </>
      );
      break;
    case "wrong-email":
      body = (
        <Alert variant="destructive">
          <AlertDescription>
            Cette invitation est destinée à une autre adresse e-mail.
          </AlertDescription>
        </Alert>
      );
      break;
    case "already-member":
      body = (
        <>
          <Alert>
            <AlertDescription>Vous êtes déjà membre de ce laboratoire.</AlertDescription>
          </Alert>
          <Link href={`/labo/${preview.labSlug}/projets`} className="underline">
            Ouvrir le laboratoire
          </Link>
        </>
      );
      break;
  }

  return (
    <main className="mx-auto w-full max-w-sm space-y-4 p-6">
      <PageHeader title="Invitation" subtitle="Prototype de recherche, pas un dispositif médical" />
      {body}
    </main>
  );
}

function Intro({ labName, role }: { labName: string; role: keyof typeof ROLE_LABELS }) {
  return (
    <p className="text-sm">
      Vous êtes invité(e) à rejoindre le laboratoire <strong>{labName}</strong> en tant que{" "}
      {ROLE_LABELS[role].toLowerCase()}.
    </p>
  );
}
