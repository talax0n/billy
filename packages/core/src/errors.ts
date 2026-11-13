/**
 * A business-rule failure the user can act on. The API maps the kind to an HTTP status:
 * invalid → 422, conflict → 409, not_found → 404, forbidden → 403.
 */
export class DomainError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict" | "not_found" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
