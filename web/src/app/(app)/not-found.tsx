import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";

export default function NotFound() {
  return (
    <EmptyState
      title="Page introuvable"
      description="Ce projet ou cette étude n'existe pas, ou a été déplacé."
      action={
        <Link href="/projets" className="underline">
          Retour aux projets
        </Link>
      }
    />
  );
}
