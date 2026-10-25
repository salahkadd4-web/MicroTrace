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
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
