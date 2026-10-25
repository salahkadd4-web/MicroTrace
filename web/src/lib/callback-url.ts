/** N'accepte qu'un chemin relatif du site : jamais d'URL absolue ni « // ». */
export function safeCallbackUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
