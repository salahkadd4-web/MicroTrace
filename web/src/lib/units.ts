/** Libellé affiché d'un code d'unité : « ug » devient « µg » (la valeur du code ne change pas). */
export function unitLabel(code: string): string {
  return code.replace(/\bug\b/g, "µg");
}
