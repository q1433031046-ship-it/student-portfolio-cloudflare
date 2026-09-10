export class PagesError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
