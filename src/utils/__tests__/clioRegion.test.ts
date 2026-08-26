import { describe, it, expect } from "vitest";
import {
  CLIO_REGIONS,
  CLIO_REGION_BASE_URLS,
  InvalidClioRegionError,
  parseClioRegion,
  getClioRegion,
  getClioRegionBaseUrl,
  getClioApiBaseUrl,
  getClioAuthorizeUrl,
  getClioTokenUrl,
} from "../clioRegion.js";

const REGIONS: Array<[string, string]> = [
  ["us", "https://app.clio.com"],
  ["eu", "https://eu.app.clio.com"],
  ["au", "https://au.app.clio.com"],
  ["ca", "https://ca.app.clio.com"],
];

describe("Clio region map", () => {
  it("lists exactly the four Clio data regions", () => {
    expect(CLIO_REGIONS).toEqual(["us", "eu", "au", "ca"]);
    expect(CLIO_REGION_BASE_URLS).toEqual(Object.fromEntries(REGIONS));
  });

  it.each(REGIONS)("resolves %s to %s for API and OAuth URLs", (region, base) => {
    const env = { CLIO_REGION: region };
    expect(getClioRegion(env)).toBe(region);
    expect(getClioRegionBaseUrl(env)).toBe(base);
    expect(getClioApiBaseUrl(env)).toBe(`${base}/api/v4`);
    expect(getClioAuthorizeUrl(env)).toBe(`${base}/oauth/authorize`);
    expect(getClioTokenUrl(env)).toBe(`${base}/oauth/token`);
  });

  it("defaults to us when CLIO_REGION is unset or blank", () => {
    expect(parseClioRegion(undefined)).toBe("us");
    expect(parseClioRegion("")).toBe("us");
    expect(parseClioRegion("   ")).toBe("us");
    expect(getClioApiBaseUrl({})).toBe("https://app.clio.com/api/v4");
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(parseClioRegion("AU")).toBe("au");
    expect(parseClioRegion(" Ca ")).toBe("ca");
    expect(getClioAuthorizeUrl({ CLIO_REGION: "EU" })).toBe("https://eu.app.clio.com/oauth/authorize");
  });

  it.each(["uk", "usa", "europe", "au1", "en"])("throws for unknown value %j instead of falling back to US", (value) => {
    expect(() => parseClioRegion(value)).toThrow(InvalidClioRegionError);
    expect(() => getClioApiBaseUrl({ CLIO_REGION: value })).toThrow(InvalidClioRegionError);
    expect(() => getClioAuthorizeUrl({ CLIO_REGION: value })).toThrow(InvalidClioRegionError);
    expect(() => getClioTokenUrl({ CLIO_REGION: value })).toThrow(InvalidClioRegionError);
  });

  it("names the bad value and lists the valid ones in the error", () => {
    let message = "";
    try { parseClioRegion("uk"); } catch (err: any) { message = err.message; }
    expect(message).toContain('"uk"');
    expect(message).toContain("us, eu, au, ca");
    expect(message).toContain("https://au.app.clio.com");
    expect(message).toContain("https://ca.app.clio.com");
  });

  it("does not accept prototype keys as regions", () => {
    expect(() => parseClioRegion("constructor")).toThrow(InvalidClioRegionError);
    expect(() => parseClioRegion("__proto__")).toThrow(InvalidClioRegionError);
  });
});

describe("explicit URL overrides", () => {
  it("CLIO_API_BASE, CLIO_AUTH_URL and CLIO_TOKEN_URL take precedence over the region", () => {
    const env = {
      CLIO_REGION: "au",
      CLIO_API_BASE: "https://proxy.example.com/api/v4",
      CLIO_AUTH_URL: "https://proxy.example.com/oauth/authorize",
      CLIO_TOKEN_URL: "https://proxy.example.com/oauth/token",
    };
    expect(getClioApiBaseUrl(env)).toBe("https://proxy.example.com/api/v4");
    expect(getClioAuthorizeUrl(env)).toBe("https://proxy.example.com/oauth/authorize");
    expect(getClioTokenUrl(env)).toBe("https://proxy.example.com/oauth/token");
    // Region base itself is untouched by the overrides
    expect(getClioRegionBaseUrl(env)).toBe("https://au.app.clio.com");
  });

  it("treats blank overrides as unset", () => {
    const env = { CLIO_REGION: "ca", CLIO_API_BASE: "", CLIO_AUTH_URL: "  ", CLIO_TOKEN_URL: "" };
    expect(getClioApiBaseUrl(env)).toBe("https://ca.app.clio.com/api/v4");
    expect(getClioAuthorizeUrl(env)).toBe("https://ca.app.clio.com/oauth/authorize");
    expect(getClioTokenUrl(env)).toBe("https://ca.app.clio.com/oauth/token");
  });

  it("still rejects an invalid region at startup even when overrides are set", () => {
    const env = { CLIO_REGION: "mars", CLIO_API_BASE: "https://proxy.example.com/api/v4" };
    expect(() => getClioRegion(env)).toThrow(InvalidClioRegionError);
  });
});
