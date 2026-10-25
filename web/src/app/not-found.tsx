import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <EmptyState
        title="Page introuvable"
        description="Cette page n'existe pas ou a été déplacée."
        action={<Link href="/" className="underline">Retour à l&apos;accueil</Link>}
      />
    </main>
  );
}
