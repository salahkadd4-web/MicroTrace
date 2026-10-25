"use client";

import { useActionState, type ReactNode } from "react";
import { FormError } from "@/components/app/FormError";
import { SubmitButton } from "@/components/app/SubmitButton";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

/**
 * Formulaire branché sur une Server Action (`useActionState`) : champs, erreur générale dans
 * `FormError`, puis bouton d'envoi désactivé pendant l'envoi.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  submitVariant,
  className,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  submitLabel: string;
  pendingLabel: string;
  submitVariant?: "default" | "outline" | "secondary";
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className={cn("space-y-4", className)}>
      {children(state)}
      <FormError message={state.error} />
      <SubmitButton pendingLabel={pendingLabel} variant={submitVariant}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
