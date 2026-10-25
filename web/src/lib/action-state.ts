/** État renvoyé par les Server Actions des formulaires (`useActionState`). */
export type ActionState = {
  /** Erreur générale, affichée dans `FormError`. */
  error?: string;
  /** Erreurs de format par champ, affichées sous le champ. */
  fieldErrors?: Record<string, string>;
};
