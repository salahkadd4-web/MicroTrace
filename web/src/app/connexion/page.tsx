import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/PageHeader";
import { safeCallbackUrl } from "@/lib/callback-url";
import { LoginForm } from "./LoginForm";

// Le lien d'invitation peut mener ici avec le jeton dans callbackUrl : pas de Referer sortant.
export const metadata: Metadata = { title: "Connexion", referrer: "no-referrer" };

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; compte?: string | string[] }>;
}) {
  const { callbackUrl, compte } = await searchParams;
  // Drapeau posé après la création d'un compte par invitation (jamais l'adresse e-mail dans l'URL).
  const created = (Array.isArray(compte) ? compte[0] : compte) === "cree";
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <PageHeader title="Connexion" subtitle="Prototype de recherche, pas un dispositif médical" />
      {created ? (
        <Alert className="mb-4">
          <AlertDescription>Compte créé. Connectez-vous.</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm callbackUrl={safeCallbackUrl(raw)} />
    </main>
  );
}
