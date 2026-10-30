import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <EmptyState
        icon={SearchX}
        title="Page introuvable"
        description="Cette page n'existe pas, ou vous n'y avez pas accès."
        action={
          <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
            Retour à l&apos;accueil
          </Link>
        }
      />
    </div>
  );
}
