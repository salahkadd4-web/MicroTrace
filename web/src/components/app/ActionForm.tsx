"use client";

import { Fragment, useActionState, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { FormError } from "@/components/app/FormError";
import { SubmitButton } from "@/components/app/SubmitButton";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

/**
 * Formulaire branché sur une Server Action (`useActionState`) : champs, erreur générale dans
 * `FormError`, puis bouton d'envoi désactivé pendant l'envoi.
 *
 * L'envoi passe par `onSubmit` (et non par `action={...}`) : React ne vide alors pas le
 * formulaire après une erreur, la saisie est conservée. Les champs ne sont vidés qu'en cas de
 * succès (`ok`), sauf si `resetOnSuccess` est faux (formulaire d'édition).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  submitVariant,
  className,
  resetOnSuccess = true,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  submitLabel: string;
  pendingLabel: string;
  submitVariant?: "default" | "outline" | "secondary";
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [, startTransition] = useTransition();
  // Un succès change la clé des champs : ils sont recréés vides (ou à leurs valeurs initiales).
  const [seen, setSeen] = useState(state);
  const [resetKey, setResetKey] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (state.ok && resetOnSuccess) setResetKey((k) => k + 1);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)}>
      <Fragment key={resetKey}>{children(state)}</Fragment>
      <FormError message={state.error} />
      <SubmitButton pending={pending} pendingLabel={pendingLabel} variant={submitVariant}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
