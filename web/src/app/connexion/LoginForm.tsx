"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormError } from "@/components/app/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Connexion…" : "Se connecter"}
    </Button>
  );
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="space-y-2">
        <Label htmlFor="email">Adresse e-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={state.error} />
      <Submit />
    </form>
  );
}
