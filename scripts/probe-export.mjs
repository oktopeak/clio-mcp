#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Read-only probe for the export command.

Usage:
  npm run build
  node scripts/probe-export.mjs > probe-output.md

Needs a saved login (run "npx @oktopeak/clio-mcp auth" first) and the same
CLIO_* environment variables as the connector. Sends GET requests only, at
0.8 requests per second. Prints status codes, record counts and yes/no flags.
It never prints names, titles, ids or any other record value.`);
  process.exit(0);
}

try {
  require("dotenv").config({ path: path.join(root, ".env") });
} catch {
  /* dotenv is optional for this script */
}

let tokenStorage;
let oauth;
let region;
try {
  tokenStorage = await import(path.join(root, "build/auth/tokenStorage.js"));
  oauth = await import(path.join(root, "build/auth/oauth.js"));
  region = await import(path.join(root, "build/utils/clioRegion.js"));
} catch (err) {
  console.error(`Cannot load the build (${err?.code ?? "error"}). Run "npm run build" first.`);
  process.exit(5);
}

if ((await tokenStorage.loadTokens()) === null) {
  console.error("Not logged in to Clio: run auth first (npx @oktopeak/clio-mcp auth).");
  process.exit(3);
}

const base = region.getClioApiBaseUrl();
const regionCode = region.getClioRegion();
const baseHost = new URL(base).host;
const MIN_INTERVAL_MS = 1250;
let lastRequestAt = 0;
let requestCount = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pace() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function accessToken() {
  try {
    return await oauth.getValidAccessToken();
  } catch {
    console.error("The saved login could not be refreshed: run auth again.");
    process.exit(3);
  }
}

async function api(pathname, params = {}) {
  const url = new URL(base + pathname);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await pace();
    const token = await accessToken();
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    requestCount++;
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5, 30) * 1000);
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      status: res.status,
      json,
      rejectedField: res.status === 400 && /is not a valid field/i.test(text),
      forbiddenWording: res.status >= 400 && /forbidden/i.test(text),
      permissionWording: res.status >= 400 && /permission|scope|not authori[sz]ed/i.test(text),
    };
  }
  return { status: 429, json: null, rejectedField: false, forbiddenWording: false, permissionWording: false };
}

const records = (r) => (typeof r.json?.meta?.records === "number" ? r.json.meta.records : null);
const rows = (r) => (Array.isArray(r.json?.data) ? r.json.data : []);
const hasNext = (r) => typeof r.json?.meta?.paging?.next === "string";
const nextToken = (r) => {
  try {
    return new URL(r.json.meta.paging.next).searchParams.get("page_token");
  } catch {
    return null;
  }
};
const yes = (value) => (value ? "yes" : "no");
const show = (value) => (value === null || value === undefined ? "n/a" : String(value));

const out = [];
const line = (text = "") => out.push(text);

line("## Export probe results");
line();
line(`- Run at: ${new Date().toISOString()}`);
line(`- Region: ${regionCode}`);

const sample = await api("/matters.json", { limit: 1, fields: "id" });
const sampleMatterId = rows(sample)[0]?.id;
const matterCount = records(sample);
line(`- Matters reachable: ${yes(sample.status === 200)} (HTTP ${sample.status}, meta.records ${show(matterCount)})`);
line(`- Sample matter available for scoped probes: ${yes(sampleMatterId !== undefined)}`);

const scoped = (extra = {}) => (sampleMatterId !== undefined ? { matter_id: sampleMatterId, ...extra } : extra);

line();
line("### 1. Account-wide listing (no matter filter)");
line();
line("| Endpoint | HTTP | Accepted | meta.records | next page link |");
line("|---|---|---|---|---|");
const wide = {};
for (const [name, pathname, params] of [
  ["notes type=matter", "/notes.json", { type: "matter" }],
  ["notes type=contact", "/notes.json", { type: "contact" }],
  ["notes no type", "/notes.json", {}],
  ["relationships", "/relationships.json", {}],
  ["documents", "/documents.json", {}],
  ["folders", "/folders.json", {}],
]) {
  const r = await api(pathname, { ...params, limit: 1, fields: "id" });
  wide[name] = { accepted: r.status === 200, records: records(r) };
  line(`| ${name} | ${r.status} | ${yes(r.status === 200)} | ${show(records(r))} | ${yes(hasNext(r))} |`);
}

line();
line("### 2. updated_since support");
line();
line("| Type | baseline HTTP | meta.records | future date HTTP | future records | 1990 records | Verdict |");
line("|---|---|---|---|---|---|---|");

function sinceVerdict(all, future, past) {
  if (all.status !== 200) return `baseline failed (HTTP ${all.status})`;
  if (future.status !== 200) return future.status >= 400 && future.status < 500 ? `rejected (HTTP ${future.status})` : `error (HTTP ${future.status})`;
  const [a, f, p] = [records(all), records(future), records(past)];
  if (a === null || f === null) return "inconclusive (no meta.records)";
  if (a === 0) return "inconclusive (no records)";
  if (f === 0 && p === a) return "honored";
  if (f === a) return "ignored (filter had no effect)";
  return "unexpected counts";
}

const sinceTargets = [
  ["matters", "/matters.json", {}],
  ["contacts", "/contacts.json", {}],
  ["users", "/users.json", {}],
  ["tasks", "/tasks.json", {}],
  ["notes (matter)", "/notes.json", wide["notes type=matter"].accepted ? { type: "matter" } : scoped({ type: "matter" })],
  ["time entries", "/activities.json", { type: "TimeEntry" }],
  ["expenses", "/activities.json", { type: "ExpenseEntry" }],
  ["calendar entries", "/calendar_entries.json", { from: "1990-01-01T00:00:00Z", to: "2035-12-31T23:59:59Z" }],
  ["bills", "/bills.json", {}],
  ["documents", "/documents.json", wide.documents.accepted ? {} : scoped()],
  ["folders", "/folders.json", wide.folders.accepted ? {} : scoped()],
  ["relationships", "/relationships.json", wide.relationships.accepted ? {} : scoped()],
];
const sinceVerdicts = {};
for (const [name, pathname, params] of sinceTargets) {
  const base1 = { ...params, limit: 1, fields: "id" };
  const all = await api(pathname, base1);
  let future = { status: 0, json: null };
  let past = { status: 0, json: null };
  if (all.status === 200) {
    future = await api(pathname, { ...base1, updated_since: "2099-01-01T00:00:00Z" });
    if (future.status === 200) past = await api(pathname, { ...base1, updated_since: "1990-01-01T00:00:00Z" });
  }
  sinceVerdicts[name] = sinceVerdict(all, future, past);
  line(`| ${name} | ${all.status} | ${show(records(all))} | ${future.status || "n/a"} | ${show(records(future))} | ${show(records(past))} | ${sinceVerdicts[name]} |`);
}

line();
line("### 3. Document download and redirect");
line();

async function findDocument() {
  const fields = "id,latest_document_version{uuid}";
  const attempts = wide.documents.accepted ? [{}] : sampleMatterId === undefined ? [] : [scoped()];
  for (const scope of attempts) {
    let r = await api("/documents.json", { ...scope, limit: 1, fields });
    if (r.rejectedField) r = await api("/documents.json", { ...scope, limit: 1, fields: "id" });
    if (r.status === 200 && rows(r).length > 0) return rows(r)[0];
  }
  if (!wide.documents.accepted) {
    const matters = await api("/matters.json", { limit: 10, fields: "id" });
    for (const m of rows(matters)) {
      const r = await api("/documents.json", { matter_id: m.id, limit: 1, fields: "id,latest_document_version{uuid}" });
      if (r.status === 200 && rows(r).length > 0) return rows(r)[0];
    }
  }
  return null;
}

const doc = await findDocument();
if (doc === null) {
  line("No document was available to test. Add one document to the test account and run again.");
} else {
  const versionUuid = doc.latest_document_version?.uuid;
  const downloadUrl = new URL(`${base}/documents/${doc.id}/download`);
  if (versionUuid) downloadUrl.searchParams.set("version_uuid", versionUuid);
  const hops = [];
  let current = downloadUrl;
  let sentAuthToStorage = false;
  for (let hop = 0; hop < 4; hop++) {
    const onApiHost = current.host === baseHost;
    if (onApiHost) await pace();
    const headers = onApiHost ? { Authorization: `Bearer ${await accessToken()}` } : { Range: "bytes=0-0" };
    if (!onApiHost && headers.Authorization) sentAuthToStorage = true;
    const res = await fetch(current, { method: "GET", redirect: "manual", headers });
    if (onApiHost) requestCount++;
    hops.push({ status: res.status, apiHost: onApiHost });
    const location = res.headers.get("location");
    if (res.body) await res.body.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    break;
  }
  const redirected = hops[0].status >= 300 && hops[0].status < 400;
  const crossHost = hops.some((h) => !h.apiHost);
  const storageHop = hops.find((h) => !h.apiHost);
  line(`- Download endpoint answered HTTP ${hops[0].status}`);
  line(`- Redirects to another location: ${yes(redirected)}`);
  line(`- Storage link is on a different host than the API: ${yes(crossHost)}`);
  line(`- Storage link works without the Authorization header: ${storageHop ? yes(storageHop.status === 200 || storageHop.status === 206) : "n/a"}${storageHop ? ` (HTTP ${storageHop.status})` : ""}`);
  line(`- Authorization header sent to the storage host: ${yes(sentAuthToStorage)}`);
  line(`- Hops followed: ${hops.length} (${hops.map((h) => h.status).join(" -> ")})`);
}

line();
line("### 4. Fields returned by the documents list call");
line();
{
  const scope = wide.documents.accepted ? {} : scoped();
  const full = await api("/documents.json", { ...scope, limit: 1, fields: "id,size,updated_at,latest_document_version{uuid,size}" });
  line(`- Full field selection (id, size, updated_at, latest_document_version{uuid,size}): HTTP ${full.status}${full.rejectedField ? ", a field was rejected" : ""}`);
  if (full.status === 200 && rows(full).length > 0) {
    const d = rows(full)[0];
    line(`- latest_document_version.uuid returned in the list: ${yes(typeof d.latest_document_version?.uuid === "string")}`);
    line(`- latest_document_version.size returned in the list: ${yes(typeof d.latest_document_version?.size === "number")}`);
    line(`- updated_at returned in the list: ${yes(typeof d.updated_at === "string")}`);
    line(`- size returned in the list: ${yes(typeof d.size === "number")}`);
  } else if (full.status === 200) {
    line("- No documents in scope, so the returned fields cannot be checked.");
  } else {
    for (const [label, fields] of [
      ["updated_at", "id,size,updated_at"],
      ["latest_document_version{uuid,size}", "id,size,latest_document_version{uuid,size}"],
    ]) {
      const r = await api("/documents.json", { ...scope, limit: 1, fields });
      line(`- ${label} on its own: HTTP ${r.status}`);
    }
  }
}

line();
line("### 5. Account-wide /documents.json: pagination and documents without a matter");
line();
let accountWideDocsOk = false;
let matterNullSeen = false;
let paginationOk = false;
if (!wide.documents.accepted) {
  line("Account-wide listing was not accepted (section 1), so these checks do not apply.");
} else {
  const seen = new Set();
  let duplicateIds = 0;
  let withMatter = 0;
  let withoutMatter = 0;
  let pages = 0;
  let token = null;
  let secondPageNonEmpty = null;
  let tokenAdvanced = true;
  let lastToken = null;
  let totalRecords = null;
  for (; pages < 5; ) {
    const r = await api("/documents.json", { limit: 200, fields: "id,matter", ...(token ? { page_token: token } : {}) });
    if (r.status !== 200) {
      line(`- Page ${pages + 1} failed with HTTP ${r.status}`);
      break;
    }
    pages++;
    if (pages === 1) totalRecords = records(r);
    if (pages === 2) secondPageNonEmpty = rows(r).length > 0;
    for (const d of rows(r)) {
      if (seen.has(d.id)) duplicateIds++;
      seen.add(d.id);
      if (d.matter === null || d.matter === undefined) withoutMatter++;
      else withMatter++;
    }
    const next = hasNext(r) ? nextToken(r) : null;
    if (!next) break;
    if (next === lastToken) tokenAdvanced = false;
    lastToken = next;
    token = next;
  }
  matterNullSeen = withoutMatter > 0;
  paginationOk = pages > 0 && duplicateIds === 0 && tokenAdvanced && (pages < 2 || secondPageNonEmpty === true);
  accountWideDocsOk = pages > 0;
  line(`- meta.records on the first page: ${show(totalRecords)}`);
  line(`- Pages read (200 per page, capped at 5): ${pages}`);
  line(`- Documents seen: ${seen.size} (with a matter ${withMatter}, without a matter ${withoutMatter})`);
  line(`- Documents without a matter returned (matter null): ${yes(matterNullSeen)}${matterNullSeen ? "" : " (not confirmed: none in the sample)"}`);
  line(`- Pagination works (token advances, no repeated ids, next page not empty): ${yes(paginationOk)}${pages < 2 ? " (only one page available, so only partly tested)" : ""}`);
}

line();
line("### 6. Folder data needed for paths");
line();
let folderDataOk = false;
let foldersDetail = "not evaluated";

async function listAll(pathname, params, maxPages) {
  const items = [];
  let token = null;
  let pages = 0;
  let status = 0;
  let truncated = false;
  for (;;) {
    const r = await api(pathname, { ...params, limit: 200, ...(token ? { page_token: token } : {}) });
    status = r.status;
    if (r.status !== 200) break;
    pages++;
    items.push(...rows(r));
    token = hasNext(r) ? nextToken(r) : null;
    if (!token) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
  }
  return { status, items, pages, truncated };
}

const FOLDER_FIELDS = "id,name,parent{id,type},matter{id}";

function classifyFolders(list, knownIds) {
  const c = {
    total: list.length,
    names: 0,
    parentWithId: 0,
    parentObjectNoId: 0,
    parentAbsent: 0,
    withMatter: 0,
    noParentWithMatter: 0,
    noParentNoMatter: 0,
    parentTypes: {},
    notInKnown: 0,
    matterIds: new Set(),
  };
  for (const f of list) {
    const hasParentId = f.parent != null && f.parent.id != null;
    const hasMatterId = f.matter != null && f.matter.id != null;
    if (typeof f.name === "string") c.names++;
    if (hasParentId) c.parentWithId++;
    else if (f.parent != null) c.parentObjectNoId++;
    else c.parentAbsent++;
    if (hasMatterId) {
      c.withMatter++;
      c.matterIds.add(f.matter.id);
    }
    if (!hasParentId && hasMatterId) c.noParentWithMatter++;
    if (!hasParentId && !hasMatterId) c.noParentNoMatter++;
    const type = hasParentId ? String(f.parent.type ?? "unknown") : "(no parent id)";
    c.parentTypes[type] = (c.parentTypes[type] ?? 0) + 1;
    if (knownIds && !knownIds.has(f.id)) c.notInKnown++;
  }
  return c;
}

const typeCounts = (c) => Object.entries(c.parentTypes).sort().map(([k, v]) => `${k}: ${v}`).join(", ") || "none";

{
  const wideFolders = await listAll("/folders.json", { fields: FOLDER_FIELDS }, 10);
  line(`- Account-wide listing: HTTP ${wideFolders.status}, ${wideFolders.items.length} folders in ${wideFolders.pages} page(s)${wideFolders.truncated ? " (capped at 10 pages)" : ""}`);
  if (wideFolders.status !== 200) {
    foldersDetail = `account-wide listing failed (HTTP ${wideFolders.status})`;
  } else {
    const ids = new Set(wideFolders.items.map((f) => f.id));
    const cw = classifyFolders(wideFolders.items, null);
    const dangling = wideFolders.items.filter((f) => f.parent?.id != null && f.parent.type === "Folder" && !ids.has(f.parent.id)).length;
    line(`- Every folder has a name: ${yes(cw.names === cw.total && cw.total > 0)} (${cw.names} of ${cw.total})`);
    line(`- Folders with a parent id: ${cw.parentWithId}; parent object without id: ${cw.parentObjectNoId}; parent absent or null: ${cw.parentAbsent}`);
    line(`- Parent types: ${typeCounts(cw)}`);
    line(`- Folders with a matter id: ${cw.withMatter}`);
    line(`- Folders without a parent id that have a matter id instead: ${cw.noParentWithMatter}`);
    line(`- Folders with neither a parent id nor a matter id: ${cw.noParentNoMatter}`);
    line(`- Distinct matters that have at least one folder: ${cw.matterIds.size} (matters in account: ${show(matterCount)})`);
    line(`- Folders whose parent is a Folder missing from this listing: ${dangling}`);

    const mattersForFolders = await api("/matters.json", { limit: 5, fields: "id" });
    const perMatter = [];
    for (const m of rows(mattersForFolders)) {
      const r = await listAll("/folders.json", { matter_id: m.id, fields: FOLDER_FIELDS }, 5);
      if (r.status === 200) perMatter.push(classifyFolders(r.items, ids));
    }
    line();
    line("Per-matter listing (matter_id filter) for the first matters returned:");
    line();
    line("| Sample | folders | no parent id | with matter id | not in account-wide listing |");
    line("|---|---|---|---|---|");
    perMatter.forEach((c, i) => {
      line(`| ${i + 1} | ${c.total} | ${c.total - c.parentWithId} | ${c.withMatter} | ${c.notInKnown} |`);
    });
    const missingFromWide = perMatter.reduce((sum, c) => sum + c.notInKnown, 0);
    line();
    line(`- Folders returned per matter but missing from the account-wide listing (sampled matters): ${missingFromWide}`);

    const namesOk = cw.total > 0 && cw.names === cw.total;
    folderDataOk = namesOk && cw.noParentNoMatter === 0 && dangling === 0 && missingFromWide === 0 && perMatter.length > 0;
    foldersDetail = folderDataOk
      ? "every folder has a name and either a parent id or a matter id, no dangling parents, per-matter listing adds nothing"
      : [
          !namesOk && "some folders have no name",
          cw.noParentNoMatter > 0 && `${cw.noParentNoMatter} folders have neither parent nor matter`,
          dangling > 0 && `${dangling} folders have a parent missing from the listing`,
          missingFromWide > 0 && `${missingFromWide} folders appear only in per-matter listings`,
          perMatter.length === 0 && "no matter could be sampled",
        ].filter(Boolean).join("; ");
  }
}

line();
line("### 7. Other endpoints");
line();
line("| Endpoint | HTTP | meta.records |");
line("|---|---|---|");
const documentIdForVersions = doc?.id;
const others = [
  ["practice_areas", "/practice_areas.json", {}],
  ["bills", "/bills.json", {}],
  ["matter_stages", "/matter_stages.json", {}],
  ["custom_fields", "/custom_fields.json", {}],
  ["calendars", "/calendars.json", {}],
  ["communications", "/communications.json", {}],
  ["allocations", "/allocations.json", {}],
  ["trust_line_items", "/trust_line_items.json", {}],
  ["bank_transactions", "/bank_transactions.json", {}],
];
if (documentIdForVersions !== undefined) {
  others.push(["document_versions (document_id filter)", "/document_versions.json", { document_id: documentIdForVersions }]);
  others.push(["document_versions (nested path)", `/documents/${documentIdForVersions}/document_versions.json`, {}]);
}
for (const [name, pathname, params] of others) {
  const r = await api(pathname, { ...params, limit: 1, fields: "id" });
  line(`| ${name} | ${r.status} | ${show(records(r))} |`);
}

line();
line("### 7b. Document version endpoint forms");
line();
if (doc === null) {
  line("No document was available to test.");
} else {
  const documentId = doc.id;
  const uuid = doc.latest_document_version?.uuid;
  const forms = [
    ["/document_versions.json, no filter", "/document_versions.json", {}],
    ["/document_versions.json?document_id", "/document_versions.json", { document_id: documentId }],
    ["/document_versions.json?document_id with fields=uuid", "/document_versions.json", { document_id: documentId, fields: "uuid" }],
    ["/documents/{id}/document_versions.json", `/documents/${documentId}/document_versions.json`, {}],
    ["/documents/{id}/versions.json", `/documents/${documentId}/versions.json`, {}],
    ["/documents/{id}.json with document_versions expansion", `/documents/${documentId}.json`, { fields: "id,document_versions{uuid}" }],
    ["/documents/{id}.json with versions expansion", `/documents/${documentId}.json`, { fields: "id,versions{uuid}" }],
  ];
  if (uuid) forms.push(["/document_versions/{uuid}.json", `/document_versions/${uuid}.json`, {}]);
  line("| Form | HTTP | field rejected | rows | rows carry a uuid |");
  line("|---|---|---|---|---|");
  for (const [name, pathname, params] of forms) {
    const r = await api(pathname, params);
    const list = rows(r);
    line(`| ${name} | ${r.status} | ${yes(r.rejectedField)} | ${r.status === 200 ? list.length : "n/a"} | ${r.status === 200 && list.length > 0 ? yes(list.every((v) => typeof v.uuid === "string")) : "n/a"} |`);
  }
}

line();
line("### 7c. custom_fields 403");
line();
{
  const me = await api("/users/who_am_i.json", { fields: "id,subscription_type,account_owner" });
  if (me.status === 200) {
    const d = me.json?.data ?? {};
    line(`- Connecting user: subscription_type ${show(d.subscription_type)}, account owner ${d.account_owner === undefined ? "n/a" : yes(d.account_owner)}`);
  } else {
    line(`- Connecting user role fields: HTTP ${me.status}${me.rejectedField ? " (a field was rejected)" : ""}`);
  }
  line();
  line("| Request | HTTP | says forbidden | mentions permission or scope |");
  line("|---|---|---|---|");
  for (const [name, pathname, params] of [
    ["/custom_fields.json", "/custom_fields.json", {}],
    ["/custom_fields.json?fields=id", "/custom_fields.json", { fields: "id" }],
    ["/custom_fields.json?parent_type=Matter", "/custom_fields.json", { parent_type: "Matter", fields: "id" }],
    ["/custom_fields.json?parent_type=Contact", "/custom_fields.json", { parent_type: "Contact", fields: "id" }],
    ["/custom_field_sets.json", "/custom_field_sets.json", { fields: "id" }],
  ]) {
    const r = await api(pathname, { ...params, limit: 1 });
    line(`| ${name} | ${r.status} | ${yes(r.forbiddenWording)} | ${yes(r.permissionWording)} |`);
  }
  const expansion = await api("/matters.json", {
    limit: 50,
    fields: "id,custom_field_values{id,field_name,field_type,value,custom_field,picklist_option}",
  });
  if (expansion.status === 200) {
    const entries = rows(expansion).flatMap((m) => (Array.isArray(m.custom_field_values) ? m.custom_field_values : []));
    const stripped = entries.filter((e) => e.field_name === null || e.field_name === undefined).length;
    line();
    line(`- custom_field_values expansion on matters (first 50): HTTP 200, ${entries.length} value entries, ${stripped} without a field name (stripped)`);
  } else {
    line();
    line(`- custom_field_values expansion on matters: HTTP ${expansion.status}${expansion.rejectedField ? " (a field was rejected)" : ""}`);
  }
}

line();
line("### 8. Page size and meta.records");
line();
for (const limit of [200, 2000]) {
  const r = await api("/matters.json", { limit, fields: "id" });
  line(`- limit=${limit}: HTTP ${r.status}, rows returned ${r.status === 200 ? rows(r).length : "n/a"}, meta.records ${show(records(r))}`);
}

line();
line("### Suggested strategy flags");
line();
const reasons = [];
if (!wide.documents.accepted) reasons.push("account-wide /documents.json was not accepted");
if (wide.documents.accepted && !accountWideDocsOk) reasons.push("account-wide /documents.json returned no readable page");
if (wide.documents.accepted && !paginationOk) reasons.push("pagination was not confirmed");
if (wide.documents.accepted && !matterNullSeen) reasons.push("documents without a matter were not seen");
if (!folderDataOk) reasons.push("folder name and parent data were not confirmed");
const documentsAccountWide = reasons.length === 0;
line(`- documents strategy: ${documentsAccountWide ? "accountWide" : "perMatter"}`);
if (!documentsAccountWide) {
  line(`  - reasons: ${reasons.join("; ")}`);
  line("  - consequence: unfiled documents are reported as NOT ENUMERATED and the verdict is INCOMPLETE");
  if (wide.documents.accepted && !matterNullSeen) {
    line("  - note: if this account simply has no unfiled documents, add one and run again to confirm");
  }
}
line(`- notes (matter): ${wide["notes type=matter"].accepted ? "accountWide" : "perMatter"}`);
line(`- notes (contact): ${wide["notes type=contact"].accepted ? "accountWide" : "NOT ENUMERATED"}`);
line(`- relationships: ${wide.relationships.accepted ? "accountWide" : "perMatter"}`);
line(`- folders: ${wide.folders.accepted && folderDataOk ? "accountWide" : wide.folders.accepted ? "UNDECIDED (see section 6)" : "perMatter"}`);
line(`  - folder data check: ${foldersDetail}`);
line(`- updated_since supported (honored): ${Object.entries(sinceVerdicts).filter(([, v]) => v === "honored").map(([k]) => k).join(", ") || "none confirmed"}`);
line(`- Requests sent: ${requestCount} (GET only)`);

console.log(out.join("\n"));
