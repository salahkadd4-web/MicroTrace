import "server-only";

/** Refus métier : le message (en français) est destiné à l'utilisateur. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
