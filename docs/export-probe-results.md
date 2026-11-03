## Export probe results

- Run at: 2026-10-19T09:58:29.538Z
- Region: eu
- Matters reachable: yes (HTTP 200, meta.records 408)
- Sample matter available for scoped probes: yes

### 1. Account-wide listing (no matter filter)

| Endpoint | HTTP | Accepted | meta.records | next page link |
|---|---|---|---|---|
| notes type=matter | 200 | yes | 34 | yes |
| notes type=contact | 200 | yes | 0 | no |
| notes no type | 400 | no | n/a | no |
| relationships | 200 | yes | 2 | yes |
| documents | 200 | yes | 3 | yes |
| folders | 200 | yes | 417 | yes |

### 2. updated_since support

| Type | baseline HTTP | meta.records | future date HTTP | future records | 1990 records | Verdict |
|---|---|---|---|---|---|---|
| matters | 200 | 408 | 200 | 0 | 408 | honored |
| contacts | 200 | 3 | 200 | 0 | 3 | honored |
| users | 200 | 1 | 200 | 0 | 1 | honored |
| tasks | 200 | 3 | 200 | 0 | 3 | honored |
| notes (matter) | 200 | 34 | 200 | 0 | 34 | honored |
| time entries | 200 | 2 | 200 | 0 | 2 | honored |
| expenses | 200 | 1 | 200 | 0 | 1 | honored |
| calendar entries | 200 | 2 | 200 | 0 | 2 | honored |
| bills | 200 | 0 | 200 | 0 | 0 | inconclusive (no records) |
| documents | 200 | 3 | 200 | 0 | 3 | honored |
| folders | 200 | 417 | 200 | 0 | 417 | honored |
| relationships | 200 | 2 | 200 | 0 | 2 | honored |

### 3. Document download and redirect

- Download endpoint answered HTTP 303
- Redirects to another location: yes
- Storage link is on a different host than the API: yes
- Storage link works without the Authorization header: yes (HTTP 206)
- Authorization header sent to the storage host: no
- Hops followed: 2 (303 -> 206)

### 4. Fields returned by the documents list call

- Full field selection (id, size, updated_at, latest_document_version{uuid,size}): HTTP 200
- latest_document_version.uuid returned in the list: yes
- latest_document_version.size returned in the list: yes
- updated_at returned in the list: yes
- size returned in the list: yes

### 5. Account-wide /documents.json: pagination and documents without a matter

- meta.records on the first page: 3
- Pages read (200 per page, capped at 5): 1
- Documents seen: 3 (with a matter 3, without a matter 0)
- Documents without a matter returned (matter null): no (not confirmed: none in the sample)
- Pagination works (token advances, no repeated ids, next page not empty): yes (only one page available, so only partly tested)

### 6. Folder data needed for paths

- Listing scope: account-wide; HTTP 200
- Folders in the sample: 200
- Every folder has a name: yes
- Every folder has a parent id: no
- Parent types seen: Folder
- Folders directly under a matter (parent type Matter): no

### 7. Other endpoints

| Endpoint | HTTP | meta.records |
|---|---|---|
| practice_areas | 200 | 19 |
| bills | 200 | 0 |
| matter_stages | 200 | 5 |
| custom_fields | 403 | n/a |
| calendars | 200 | 2 |
| communications | 403 | n/a |
| allocations | 403 | n/a |
| trust_line_items | 200 | 0 |
| bank_transactions | 403 | n/a |
| document_versions (document_id filter) | 404 | n/a |
| document_versions (nested path) | 404 | n/a |

### 8. Page size and meta.records

- limit=200: HTTP 200, rows returned 200, meta.records 408
- limit=2000: HTTP 200, rows returned 200, meta.records 408

### Suggested strategy flags

- documents strategy: perMatter
  - reasons: documents without a matter were not seen; folder name and parent data were not confirmed
  - consequence: unfiled documents are reported as NOT ENUMERATED and the verdict is INCOMPLETE
  - note: if this account simply has no unfiled documents, add one and run again to confirm
- notes (matter): accountWide
- notes (contact): accountWide
- relationships: accountWide
- folders: accountWide
- updated_since supported (honored): matters, contacts, users, tasks, notes (matter), time entries, expenses, calendar entries, documents, folders, relationships
- Requests sent: 61 (GET only)

---

## Addendum: folder, document version and custom field investigation

- Run at: 2026-10-19T10:08:03.696Z
- Region: eu

Same account and region. Sections 6 to 8 of the extended probe; the rest repeated the results above.

### 6. Folder data needed for paths

- Account-wide listing: HTTP 200, 418 folders in 3 page(s)
- Every folder has a name: yes (418 of 418)
- Folders with a parent id: 417; parent object without id: 0; parent absent or null: 1
- Parent types: (no parent id): 1, Folder: 417
- Folders with a matter id: 415
- Folders without a parent id that have a matter id instead: 0
- Folders with neither a parent id nor a matter id: 1
- Distinct matters that have at least one folder: 408 (matters in account: 408)
- Folders whose parent is a Folder missing from this listing: 0

Per-matter listing (matter_id filter) for the first matters returned:

| Sample | folders | no parent id | with matter id | not in account-wide listing |
|---|---|---|---|---|
| 1 | 8 | 0 | 8 | 0 |
| 2 | 1 | 0 | 1 | 0 |
| 3 | 1 | 0 | 1 | 0 |
| 4 | 1 | 0 | 1 | 0 |
| 5 | 1 | 0 | 1 | 0 |

- Folders returned per matter but missing from the account-wide listing (sampled matters): 0

### 7. Other endpoints

| Endpoint | HTTP | meta.records |
|---|---|---|
| practice_areas | 200 | 19 |
| bills | 200 | 0 |
| matter_stages | 200 | 5 |
| custom_fields | 403 | n/a |
| calendars | 200 | 2 |
| communications | 403 | n/a |
| allocations | 403 | n/a |
| trust_line_items | 200 | 0 |
| bank_transactions | 403 | n/a |
| document_versions (document_id filter) | 404 | n/a |
| document_versions (nested path) | 404 | n/a |

### 7b. Document version endpoint forms

| Form | HTTP | field rejected | rows | rows carry a uuid |
|---|---|---|---|---|
| /document_versions.json, no filter | 404 | no | n/a | n/a |
| /document_versions.json?document_id | 404 | no | n/a | n/a |
| /document_versions.json?document_id with fields=uuid | 404 | no | n/a | n/a |
| /documents/{id}/document_versions.json | 404 | no | n/a | n/a |
| /documents/{id}/versions.json | 200 | no | 1 | no |
| /documents/{id}.json with document_versions expansion | 200 | no | 0 | n/a |
| /documents/{id}.json with versions expansion | 400 | yes | n/a | n/a |
| /document_versions/{uuid}.json | 404 | no | n/a | n/a |

### 7c. custom_fields 403

- Connecting user: subscription_type Attorney, account owner yes

| Request | HTTP | says forbidden | mentions permission or scope |
|---|---|---|---|
| /custom_fields.json | 403 | yes | no |
| /custom_fields.json?fields=id | 403 | yes | no |
| /custom_fields.json?parent_type=Matter | 403 | yes | no |
| /custom_fields.json?parent_type=Contact | 403 | yes | no |
| /custom_field_sets.json | 403 | yes | no |

- custom_field_values expansion on matters (first 50): HTTP 200, 452 value entries, 452 without a field name (stripped)

### 8. Page size and meta.records

- limit=200: HTTP 200, rows returned 200, meta.records 408
- limit=2000: HTTP 200, rows returned 200, meta.records 408


---

## Addendum 2: new Clio app, and why the folder count changed

### Folders: 417, then 418

The first probe (2026-10-19T09:58Z) counted **417** folders in two places (section 1 and the updated_since table). Every later run counts **418**: the extended probe at 10:08Z and the one at 11:11Z. Within each run the number of folders listed (3 pages: 200 + 200 + 18) equals `meta.records`, and that listing already includes the single parentless root folder, so the difference is not a counting rule such as "the root is left out of the total". The matter count was 408 in all runs. The most likely explanation is that one folder was created in the account between 09:58Z and 10:08Z; nothing in the data suggests an export or counting problem. The first probe's folder section only looked at the first 200 folders, so it could not show the difference itself.

### Second probe, after switching to a new Clio developer app (2026-10-19T11:11Z, EU)

The 403 on `/custom_fields.json` came from the **old app's permissions**. With the new app:

- `/custom_fields.json` returns **200 with 10 definitions** (also with `parent_type=Matter` / `Contact`, and `/custom_field_sets.json`).
- Custom field values on matters are readable: **452 value entries, 0 without a field name**. With the old app all 452 came back unnamed.
- `communications`, `allocations`, `trust_line_items` and `bank_transactions` now answer **200** (0 records each); with the old app `communications`, `allocations` and `bank_transactions` answered 403.
- Everything else is unchanged: 418 folders, 3 documents, `updated_since` honoured for the same types, download answers 303 to a storage link that works without the login, `/documents/{id}/versions.json` is the only version endpoint that exists.

The relevant sections of that run's output:

### 7. Other endpoints

| Endpoint | HTTP | meta.records |
|---|---|---|
| practice_areas | 200 | 19 |
| bills | 200 | 0 |
| matter_stages | 200 | 5 |
| custom_fields | 200 | 10 |
| calendars | 200 | 2 |
| communications | 200 | 0 |
| allocations | 200 | 0 |
| trust_line_items | 200 | 0 |
| bank_transactions | 200 | 0 |
| document_versions (document_id filter) | 404 | n/a |
| document_versions (nested path) | 404 | n/a |

### 7b. Document version endpoint forms

| Form | HTTP | field rejected | rows | rows carry a uuid |
|---|---|---|---|---|
| /document_versions.json, no filter | 404 | no | n/a | n/a |
| /document_versions.json?document_id | 404 | no | n/a | n/a |
| /document_versions.json?document_id with fields=uuid | 404 | no | n/a | n/a |
| /documents/{id}/document_versions.json | 404 | no | n/a | n/a |
| /documents/{id}/versions.json | 200 | no | 1 | no |
| /documents/{id}.json with document_versions expansion | 200 | no | 0 | n/a |
| /documents/{id}.json with versions expansion | 400 | yes | n/a | n/a |
| /document_versions/{uuid}.json | 404 | no | n/a | n/a |

### 7c. custom_fields 403

- Connecting user: subscription_type Attorney, account owner yes

| Request | HTTP | says forbidden | mentions permission or scope |
|---|---|---|---|
| /custom_fields.json | 200 | no | no |
| /custom_fields.json?fields=id | 200 | no | no |
| /custom_fields.json?parent_type=Matter | 200 | no | no |
| /custom_fields.json?parent_type=Contact | 200 | no | no |
| /custom_field_sets.json | 200 | no | no |

- custom_field_values expansion on matters (first 50): HTTP 200, 452 value entries, 0 without a field name (stripped)

