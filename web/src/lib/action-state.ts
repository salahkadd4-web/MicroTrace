/** État renvoyé par les Server Actions des formulaires (`useActionState`). */
export type ActionState = {
  /** Succès : les formulaires d'ajout se vident. */
  ok?: true;
  /** Erreur générale, affichée dans `FormError`. */
  error?: string;
  /** Erreurs de format par champ, affichées sous le champ. */
  fieldErrors?: Record<string, string>;
  /** Lien d'invitation à usage unique, affiché une seule fois après la création. */
  link?: string;
};
