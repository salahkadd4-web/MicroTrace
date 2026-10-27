"use client";

import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";

const SUSPENDED = "Laboratoire suspendu.";

/**
 * En production, Next masque le message d'une erreur levée côté serveur : on ne reçoit alors que
 * `digest`. Le message exact n'est reconnu qu'en développement ; sinon le texte générique évoque
 * la suspension possible, et « Recharger » relance le layout, qui affiche l'avis dédié.
 */
export default function LaboErrorPage({ error }: { error: Error & { digest?: string } }) {
  const suspended = error.message === SUSPENDED;
  return (
    <EmptyState
      title={suspended ? SUSPENDED : "Une erreur est survenue"}
      description={
        suspended
          ? "L'accès à ce laboratoire est suspendu par l'équipe de la plateforme."
          : "La page n'a pas pu être affichée. Le laboratoire a peut-être été suspendu : rechargez la page pour le vérifier."
      }
      action={
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => window.location.reload()}>Recharger</Button>
          <Link href="/" className="underline">
            Retour à l&apos;accueil
          </Link>
        </div>
      }
    />
  );
}
