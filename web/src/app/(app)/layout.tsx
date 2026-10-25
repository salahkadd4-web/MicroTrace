import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { requireUser } from "@/server/session";
import { logout } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell userName={user.name} signOutAction={logout}>
      {children}
    </AppShell>
  );
}
