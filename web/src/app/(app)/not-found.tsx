import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";

export default function NotFound() {
  return (
    <EmptyState
      title="Page introuvable"
      description="Cette page n'existe pas, ou vous n'y avez pas accès."
      action={
        <Link href="/" className="underline">
          Retour à l&apos;accueil
        </Link>
      }
    />
  );
}
