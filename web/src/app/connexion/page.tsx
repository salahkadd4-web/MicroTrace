import { PageHeader } from "@/components/app/PageHeader";
import { safeCallbackUrl } from "@/lib/callback-url";
import { LoginForm } from "./LoginForm";

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const { callbackUrl } = await searchParams;
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <PageHeader title="Connexion" subtitle="Prototype de recherche, pas un dispositif médical" />
      <LoginForm callbackUrl={safeCallbackUrl(raw)} />
    </main>
  );
}
