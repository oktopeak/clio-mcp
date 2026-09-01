import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../auth/oauth.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

vi.mock("../sessionContext.js", () => ({
  getSessionContext: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../clioRegion.js", () => ({
  getClioApiBaseUrl: vi.fn().mockReturnValue("https://app.clio.com/api/v4"),
}));

import { clioGet, clioGetAllPages, ClioApiError } from "../clioClient.js";

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("clioGetAllPages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows pagination to completion and concatenates data", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 1 }, { id: 2 }],
        meta: { paging: { next: "https://app.clio.com/api/v4/folders.json?page_token=p2" } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 3 }],
        meta: { paging: {} },
      }));

    const result = await clioGetAllPages("/folders.json", { matter_id: "42" });
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl.searchParams.get("page_token")).toBe("p2");
  });

  it("returns an empty array when the first page has no results", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], meta: { paging: {} } }));
    const result = await clioGetAllPages("/folders.json", { matter_id: "42" });
    expect(result).toEqual([]);
  });

  it("throws once maxPages is exceeded instead of looping forever", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({
        data: [{ id: 1 }],
        meta: { paging: { next: "https://app.clio.com/api/v4/folders.json?page_token=next" } },
      }))
    );

    await expect(clioGetAllPages("/folders.json", { matter_id: "42" }, { maxPages: 2 })).rejects.toThrow(/exceeded maxPages/);
  });
});

describe("clioFetch retry/backoff (via clioGet)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("honors Retry-After and succeeds after the retry", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }] }));

    const promise = clioGet("/matters.json", {});
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.data).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors an HTTP-date Retry-After value and succeeds after the retry", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const retryAt = new Date(Date.now() + 2000).toUTCString();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "Retry-After": retryAt } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }] }));

    const promise = clioGet("/matters.json", {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.data).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to jittered backoff when Retry-After is unparseable, instead of throwing immediately", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "Retry-After": "not-a-valid-value" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const promise = clioGet("/matters.json", {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries with a jittered exponential delay when Retry-After is absent", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const promise = clioGet("/matters.json", {});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("eventually throws a rate-limit error after repeated 429s", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } })));

    const promise = clioGet("/matters.json", {});
    const assertion = expect(promise).rejects.toThrow(/rate limit exceeded/);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });

  it("wraps a non-429 error response in ClioApiError with the status code", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Not found" }, { status: 404 }));

    await expect(clioGet("/matters/999.json", {})).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("Not found"),
    });
  });

  it("proactively pauses when X-RateLimit-Remaining is low, before Clio ever returns 429", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }, { headers: { "X-RateLimit-Remaining": "1" } }));

    const promise = clioGet("/matters.json", {});
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
