import { getValidAccessToken } from "../auth/oauth.js";

function getBase() {
  const region = (process.env.CLIO_REGION ?? "us").toLowerCase();
  const clioBase = region === "eu" ? "https://eu.app.clio.com" : "https://app.clio.com";
  return process.env.CLIO_API_BASE ?? `${clioBase}/api/v4`;
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
        const delay = RETRY_DELAYS_MS[attempt];
        console.error(`[rate-limit] 429 received, retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error("Clio rate limit exceeded after 3 retries.");
    }

    if (!res.ok) throw new Error(`Clio API error ${res.status}: ${await res.text()}`);
    return res;
  }
  throw new Error("clioFetch: unexpected loop exit");
}

export async function clioGet(path: string, params?: Record<string, string>): Promise<any> {
  const token = await getValidAccessToken();
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
  const token = await getValidAccessToken();
  const url = new URL(`${getBase()}${path}`);
  const res = await clioFetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
