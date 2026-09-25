import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../auth/oauth.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

vi.mock("../sessionContext.js", () => ({
  getSessionContext: vi.fn().mockReturnValue(undefined),
  // 2.2.0 made clioClient use the fail-closed variant: null means stdio mode,
  // where reading the shared token file is legitimate.
  requireSessionContext: vi.fn().mockReturnValue(null),
}));

vi.mock("../clioRegion.js", () => ({
  getClioApiBaseUrl: vi.fn().mockReturnValue("https://app.clio.com/api/v4"),
}));

import { clioPatch, clioGet, clioGetAllPages, clioGetWithFieldFallback, ClioApiError } from "../clioClient.js";

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


/**
 * 2.2.0 shipped a `fields` string Clio rejected, and because one string is shared
 * by every matter and contact read it took all of them down at once for five
 * days. These cover the guard that turns that into a degraded response.
 */
describe("clioGetWithFieldFallback", () => {
  const FULL = "id,name,custom_field_values{id,value,picklist_option}";
  const BASE = "id,name";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fieldsOf(call: number): string | null {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    return new URL(fetchMock.mock.calls[call][0] as string).searchParams.get("fields");
  }

  it("returns the first response untouched when Clio accepts the field selection", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 1 } }));

    const result = await clioGetWithFieldFallback("/matters/1.json", { fields: FULL }, BASE);

    expect(result.body).toEqual({ data: { id: 1 } });
    expect(result.fields_warning).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once with the reduced selection when Clio rejects a field", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(
        { message: "custom_field_values{id,value,picklist_option}: picklist_option} is not a valid field" },
        { status: 400 }
      ))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 1 } }));

    const result = await clioGetWithFieldFallback("/matters/1.json", { fields: FULL }, BASE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fieldsOf(0)).toBe(FULL);
    expect(fieldsOf(1)).toBe(BASE);
    expect(result.body).toEqual({ data: { id: 1 } });
    // The warning has to say the missing fields are missing, not empty: a model
    // reading this must not conclude the firm left its custom fields blank.
    expect(result.fields_warning).toMatch(/not necessarily empty/);
    expect(result.fields_warning).toMatch(/is not a valid field/);
  });

  it("keeps every other request parameter on the retry", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "nope is not a valid field" }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await clioGetWithFieldFallback("/matters.json", { fields: FULL, limit: "200", status: "open" }, BASE);

    const retried = new URL((fetchMock.mock.calls[1][0] as string));
    expect(retried.searchParams.get("limit")).toBe("200");
    expect(retried.searchParams.get("status")).toBe("open");
  });

  it("retries at most once, so a fallback that is also rejected still surfaces", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "a is not a valid field" }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ message: "b is not a valid field" }, { status: 400 }));

    await expect(clioGetWithFieldFallback("/matters.json", { fields: FULL }, BASE)).rejects.toThrow(ClioApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 that is not about the field selection", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "invalid page_token" }, { status: 400 }));

    await expect(clioGetWithFieldFallback("/matters.json", { fields: FULL }, BASE)).rejects.toThrow(/invalid page_token/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, 422, 500])("does not retry a %i", async (status) => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "is not a valid field" }, { status }));

    await expect(clioGetWithFieldFallback("/matters.json", { fields: FULL }, BASE)).rejects.toThrow(ClioApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


describe("conditional contact PATCH", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends the exact ETag and supplied partial body", async () => {
    const f=vi.fn().mockResolvedValue(jsonResponse({data:{id:5,etag:'"v2"'}}));
    vi.stubGlobal("fetch",f);
    await clioPatch("/contacts/5.json",{data:{title:"Director"}},{fields:"id,etag"},{ifMatch:'"v1"'});
    expect(f.mock.calls[0][0]).toBe("https://app.clio.com/api/v4/contacts/5.json?fields=id%2Cetag");
    expect(f.mock.calls[0][1]).toMatchObject({method:"PATCH",headers:{"If-Match":'"v1"',Authorization:"Bearer test-token"},body:'{"data":{"title":"Director"}}'});
  });
  it("leaves legacy PATCH requests unconditional", async () => {
    const f=vi.fn().mockResolvedValue(new Response(null,{status:204}));
    vi.stubGlobal("fetch",f);
    expect(await clioPatch("/tasks/5.json",{data:{status:"complete"}})).toEqual({});
    expect(f.mock.calls[0][1].headers).not.toHaveProperty("If-Match");
  });
  it.each([412,500])("does not replay HTTP %s", async status => {
    const f=vi.fn().mockResolvedValue(jsonResponse({error:"rejected"},{status}));
    vi.stubGlobal("fetch",f);
    await expect(clioPatch("/contacts/5.json",{data:{title:"Director"}},undefined,{ifMatch:'"v1"'})).rejects.toMatchObject({statusCode:status});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("does not replay an uncertain network failure", async () => {
    const f=vi.fn().mockRejectedValue(new Error("connection closed"));vi.stubGlobal("fetch",f);
    await expect(clioPatch("/contacts/5.json",{data:{title:"Director"}})).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("preserves typed 429 after the retry budget is exhausted", async () => {
    const f=vi.fn().mockResolvedValue(jsonResponse({}, {status:429,headers:{"Retry-After":"0"}}));vi.stubGlobal("fetch",f);
    await expect(clioPatch("/contacts/5.json",{data:{title:"Director"}})).rejects.toMatchObject({statusCode:429});
    expect(f).toHaveBeenCalledTimes(7);
  });
});
