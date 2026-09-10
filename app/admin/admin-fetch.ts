"use client";

import { userFacingError } from "../lib/user-facing-error";

/** Keep a broken provider or suspended connection from leaving the admin UI spinning forever. */
export const ADMIN_REQUEST_TIMEOUT_MS = 20_000;

export async function fetchAdmin(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = ADMIN_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : ADMIN_REQUEST_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const abortUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortUpstream();
    else upstreamSignal.addEventListener("abort", abortUpstream, { once: true });
  }

  const fetchPromise = Promise.resolve().then(() => fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    cache: init.cache ?? "no-store",
    signal: controller.signal,
  }));
  // A timed-out request may reject after the bounded caller has moved on.
  fetchPromise.catch(() => undefined);

  try {
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(userFacingError("后台响应超时，请稍后重试"));
        }, boundedTimeout);
      }),
    ]);
  } catch (error) {
    if (timedOut) throw error;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (upstreamSignal) upstreamSignal.removeEventListener("abort", abortUpstream);
  }
}
