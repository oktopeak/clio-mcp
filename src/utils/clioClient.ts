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

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function clioFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, init);

    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining !== null && parseInt(remaining) < 5)
      console.error(`[rate-limit] Warning: only ${remaining} requests remaining`);

    if (res.status === 429) {
      if (attempt < RETRY_DELAYS_MS.length) {
        const retryAfter = res.headers.get("Retry-After");
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAYS_MS[attempt];
        console.error(`[rate-limit] 429 received, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error("Clio rate limit exceeded after 3 retries.");
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
