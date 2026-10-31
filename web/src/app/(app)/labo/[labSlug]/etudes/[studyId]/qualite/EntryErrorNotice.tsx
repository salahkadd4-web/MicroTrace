import Link from "next/link";
import { ENTRY_ERROR_NOTICE } from "@/lib/quality";

/** Rappelle que « Erreur de saisie confirmée » ne change rien aux résultats ; lien vers les imports pour qui peut écrire. */
export function EntryErrorNotice({ importsHref }: { importsHref: string | null }) {
  return (
    <p className="text-sm text-muted-foreground">
      {ENTRY_ERROR_NOTICE}
      {importsHref ? (
        <>
          {" "}
          <Link
            href={importsHref}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Aller aux imports
          </Link>
        </>
      ) : null}
    </p>
  );
}
