"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Bouton d'envoi : désactivé et libellé d'attente pendant l'envoi du formulaire parent. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  pending: pendingProp,
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  /** Envoi en cours quand le formulaire n'est pas soumis par `action` (sinon lu via useFormStatus). */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
