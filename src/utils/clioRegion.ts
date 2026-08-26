/**
 * Clio data regions.
 *
 * Clio hosts each firm's data in one of four regions, chosen when the Clio
 * account is created. The REST API and the OAuth endpoints both live on the
 * regional hostname, so CLIO_REGION must match the Clio server the firm logs
 * in to. This module is the single place that maps a region code to its base
 * URL; every other module imports from here instead of hardcoding hosts.
 */

export const CLIO_REGION_BASE_URLS = {
  us: "https://app.clio.com",
  eu: "https://eu.app.clio.com",
  au: "https://au.app.clio.com",
  ca: "https://ca.app.clio.com",
} as const;

export type ClioRegion = keyof typeof CLIO_REGION_BASE_URLS;

export const CLIO_REGIONS = Object.keys(CLIO_REGION_BASE_URLS) as ClioRegion[];

export const DEFAULT_CLIO_REGION: ClioRegion = "us";

export class InvalidClioRegionError extends Error {
  constructor(public readonly value: string) {
    super(
      `Invalid CLIO_REGION "${value}". Valid values: ${CLIO_REGIONS.join(", ")} ` +
      `(${CLIO_REGIONS.map((r) => `${r} = ${CLIO_REGION_BASE_URLS[r]}`).join(", ")}). ` +
      `The region is set when the Clio account is created and must match the Clio server your firm logs in to.`
    );
    this.name = "InvalidClioRegionError";
  }
}

export function isClioRegion(value: string): value is ClioRegion {
  return Object.prototype.hasOwnProperty.call(CLIO_REGION_BASE_URLS, value);
}

/**
 * Parse a raw CLIO_REGION value. Unset or blank means the default (us).
 * Anything else must be one of the known region codes; there is no silent
 * fallback to the US endpoint.
 */
export function parseClioRegion(raw: string | undefined): ClioRegion {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return DEFAULT_CLIO_REGION;
  if (isClioRegion(value)) return value;
  throw new InvalidClioRegionError(raw ?? "");
}

export function getClioRegion(env: NodeJS.ProcessEnv = process.env): ClioRegion {
  return parseClioRegion(env.CLIO_REGION);
}

/** Regional host with scheme and no path, e.g. https://eu.app.clio.com */
export function getClioRegionBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return CLIO_REGION_BASE_URLS[getClioRegion(env)];
}

/** Treat blank override values as unset so an empty .env line does not produce a broken URL. */
function explicitOverride(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** API base, e.g. https://eu.app.clio.com/api/v4. CLIO_API_BASE takes precedence over the region. */
export function getClioApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return explicitOverride(env.CLIO_API_BASE) ?? `${getClioRegionBaseUrl(env)}/api/v4`;
}

/** OAuth authorization endpoint. CLIO_AUTH_URL takes precedence over the region. */
export function getClioAuthorizeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return explicitOverride(env.CLIO_AUTH_URL) ?? `${getClioRegionBaseUrl(env)}/oauth/authorize`;
}

/** OAuth token endpoint. CLIO_TOKEN_URL takes precedence over the region. */
export function getClioTokenUrl(env: NodeJS.ProcessEnv = process.env): string {
  return explicitOverride(env.CLIO_TOKEN_URL) ?? `${getClioRegionBaseUrl(env)}/oauth/token`;
}
