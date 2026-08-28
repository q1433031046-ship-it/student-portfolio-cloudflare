export class RequestBodyError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new RequestBodyError("请求大小无效", 400);
    if (declared > maxBytes) throw new RequestBodyError("请求内容过大", 413);
  }
  if (!request.body) throw new RequestBodyError("请求内容为空", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded");
        throw new RequestBodyError("请求内容过大", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new RequestBodyError("请求内容为空", 400);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RequestBodyError("请求内容不是有效的 JSON", 400);
  }
}

export function isRequestBodyError(error: unknown): error is RequestBodyError {
  return error instanceof RequestBodyError;
}
