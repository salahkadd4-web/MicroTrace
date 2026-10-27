"use client";

/** Dernier recours (erreur dans la disposition racine) : page minimale en français. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>Une erreur est survenue</h1>
        <p>La page n&apos;a pas pu être affichée. Réessayez dans un instant.</p>
        <button type="button" onClick={reset}>
          Réessayer
        </button>
      </body>
    </html>
  );
}
