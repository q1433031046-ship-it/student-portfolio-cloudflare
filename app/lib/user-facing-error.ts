const NATIVE_ERROR_PATTERN = /failed to fetch|fetch failed|networkerror|network request failed|load failed|unexpected token|unexpected end of json|body stream|json parse|syntaxerror/iu;

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function userFacingError(message: string) {
  return new UserFacingError(message);
}

export function userFacingResponseError(body: unknown, fallback: string) {
  const message = responseErrorMessage(body);
  return userFacingError(isAllowedChineseMessage(message) ? message : fallback);
}

export function toUserFacingChineseError(error: unknown, fallback: string) {
  return error instanceof UserFacingError && isAllowedChineseMessage(error.message) ? error.message : fallback;
}

function responseErrorMessage(body: unknown) {
  if (!isRecord(body)) return "";
  if (Array.isArray(body.details) && typeof body.details[0] === "string") return body.details[0].trim();
  return typeof body.error === "string" ? body.error.trim() : "";
}

function isAllowedChineseMessage(message: string) {
  return message.length > 0
    && message.length <= 500
    && /\p{Script=Han}/u.test(message)
    && !NATIVE_ERROR_PATTERN.test(message)
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
