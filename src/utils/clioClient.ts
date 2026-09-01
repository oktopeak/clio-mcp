import { getValidAccessToken } from "../auth/oauth.js";
import { getSessionContext } from "./sessionContext.js";
import { getClioApiBaseUrl } from "./clioRegion.js";

async function resolveAccessToken(): Promise<string> {
  const ctx = getSessionContext();
  if (ctx) return ctx.getAccessToken();
  return getValidAccessToken();
}

export class ClioApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ClioApiError";
  }
}

/** Clio API base (region-aware, honours CLIO_API_BASE). See utils/clioRegion.ts. */
function getBase() {
  return getClioApiBaseUrl();
}
export function getClioBaseUrl(): string {
  return getBase();
}

const MAX_RETRY_ATTEMPTS = 6;
const BASE_DELAY_MS = 1000;
const MAX_SINGLE_DELAY_MS = 30_000;
const MAX_TOTAL_WAIT_MS = 90_000;
const RATE_LIMIT_THROTTLE_THRESHOLD = 3;

/** Full-jitter exponential backoff (upper-half jitter avoids retry storms across sessions). */
function jitteredDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_SINGLE_DELAY_MS);
  return exp / 2 + Math.random() * (exp / 2);
}

/**
 * Parses a Retry-After header per RFC 7231: either delta-seconds (all digits)
 * or an HTTP-date. Returns null when the value is neither, so the caller can
 * fall back to jittered backoff instead of propagating a NaN delay.
 */
function parseRetryAfterMs(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function clioFetch(url: string, init: RequestInit): Promise<Response> {
  let totalWaited = 0;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(url, init);

    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining !== null) {
      const remainingNum = parseInt(remaining);
      if (remainingNum < 5)
        console.error(`[rate-limit] Warning: only ${remaining} requests remaining`);
      // Proactively slow down before Clio actually 429s us, so a long sequence of
      // tool calls (e.g. bulk folder creation) doesn't burn through the reactive
      // retry budget below.
      if (remainingNum >= 0 && remainingNum <= RATE_LIMIT_THROTTLE_THRESHOLD) {
        const pause = 500 + Math.random() * 500;
        if (totalWaited + pause <= MAX_TOTAL_WAIT_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, pause));
          totalWaited += pause;
        }
      }
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const retryAfterMs = retryAfter ? parseRetryAfterMs(retryAfter) : null;
      const delay = retryAfterMs !== null ? Math.min(retryAfterMs, MAX_SINGLE_DELAY_MS) : jitteredDelay(attempt);
      if (attempt < MAX_RETRY_ATTEMPTS && totalWaited + delay <= MAX_TOTAL_WAIT_MS) {
        console.error(`[rate-limit] 429 received, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        totalWaited += delay;
        continue;
      }
      throw new Error(`Clio rate limit exceeded after ${attempt} retries (${Math.round(totalWaited)}ms total wait).`);
    }

    if (!res.ok) {
      const raw = await res.text();
      let msg = raw;
      try {
        const json = JSON.parse(raw);
        if (typeof json.message === "string") {
          msg = json.message;
        } else if (typeof json.error === "string") {
          msg = json.error;
        } else if (json.error && typeof json.error === "object") {
          msg = json.error.message ?? JSON.stringify(json.error);
        } else if (Array.isArray(json.errors)) {
          msg = json.errors.map((e: any) => (typeof e === "string" ? e : e.message ?? JSON.stringify(e))).join("; ");
        } else {
          msg = JSON.stringify(json);
        }
      } catch { /* use raw text */ }
      throw new ClioApiError(res.status, `Clio API error ${res.status} on ${url}: ${msg}`);
    }
    return res;
  }
  throw new Error("clioFetch: unexpected loop exit");
}

export async function clioGet(path: string, params?: Record<string, string>): Promise<any> {
  const token = await resolveAccessToken();
  const url = new URL(`${getBase()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await clioFetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.json();
}

const DEFAULT_MAX_PAGES = 100;

/**
 * Follows Clio cursor pagination to completion and returns the concatenated `data` array.
 * Use for correctness-critical reads (existence checks, dedup) — not for interactive
 * "browse" tools, where returning a single manual page keeps LLM payloads small.
 */
export async function clioGetAllPages(
  path: string,
  params: Record<string, string>,
  opts?: { maxPages?: number }
): Promise<any[]> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const out: any[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  do {
    const pageParams = pageToken ? { ...params, page_token: pageToken } : params;
    const data = await clioGet(path, pageParams);
    out.push(...(data.data ?? []));
    pageToken = extractNextPageToken(data.meta);
    pages++;
    if (pages >= maxPages && pageToken !== null) {
      throw new Error(
        `clioGetAllPages: exceeded maxPages (${maxPages}) fetching ${path} — refine filters (e.g. add a name/query param) or raise the cap explicitly.`
      );
    }
  } while (pageToken !== null);
  return out;
}

export async function clioPost(path: string, body: unknown): Promise<any> {
  const token = await resolveAccessToken();
  const url = new URL(`${getBase()}${path}`);
  const res = await clioFetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function clioPatch(path: string, body: unknown): Promise<any> {
  const token = await resolveAccessToken();
  const url = new URL(`${getBase()}${path}`);
  const res = await clioFetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : {};
}

export function extractNextPageToken(meta: any): string | null {
  const nextUrl = meta?.paging?.next;
  if (!nextUrl) return null;
  try { return new URL(nextUrl).searchParams.get("page_token"); }
  catch { return null; }
}

export async function clioPut(path: string, body: unknown): Promise<any> {
  const token = await resolveAccessToken();
  const url = new URL(`${getBase()}${path}`);
  const res = await clioFetch(url.toString(), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : {};
}
