import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Metadata } from "next";
import { Logo } from "@/components/app/Logo";
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
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo variant="full" size={48} wordmarkClassName="text-2xl" />
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-xs">
          <PageHeader title="Connexion" subtitle="Prototype de recherche, pas un dispositif médical" />
          {created ? (
            <Alert variant="info">
              <AlertDescription>Compte créé. Connectez-vous.</AlertDescription>
            </Alert>
          ) : null}
          <LoginForm callbackUrl={safeCallbackUrl(raw)} />
        </div>
      </div>
    </main>
  );
}
