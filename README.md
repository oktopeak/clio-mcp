# Clio MCP Server: Connect Claude to Clio Practice Management

> ### Built by [Oktopeak](https://oktopeak.com/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-byline): AI transformation & automation for law firms
> **Digital transformation for legal and healthcare businesses.** We build AI integrations, workflow automation, and custom software your firm owns outright, including this connector. → [Book a 30-min call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-byline-call)

Open-source Model Context Protocol (MCP) connector that lets Claude read live data from [Clio](https://www.clio.com) (matters, contacts, documents, tasks, calendar, and billing) without copying client information into chat windows. Built for law firms that care about attorney-client privilege, ABA Opinion 512 compliance, and keeping AI workflows inside their existing practice management stack.

> **TL;DR:** 26 Clio tools exposed to Claude across stdio and HTTP/SSE transports. Audit-logged for ABA Opinion 512. OAuth tokens encrypted at rest with AES-256-GCM. Local-only: no relay server, no cloud middleman. MIT license, free forever.

**Who this is for:** Law firm IT, legal operations teams, tech-forward partners, and engineers at legal tech companies. If you can follow a five-step terminal install, you can use this.

> [!TIP]
> **Not a developer? You don't need to be.**
>
> The README below assumes someone comfortable editing a JSON config file. If that's not you or your team, we deploy this for law firms: scoped credentials, audit log wired in, one custom workflow, training. A simpler one-command installer is also planned for v0.2.
>
> → **[See Guided MCP Setup](https://oktopeak.com/services/mcp-guided-setup/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-tip-svc)**, or [book a 30-min call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-tip-call)

**Jump to:** [Demo](#demo) · [Setup](#setup) · [Available tools](#available-tools) · [Security & compliance](#compliance--security) · [Need it deployed for you?](#need-more-than-the-connector)

---

## Demo

Watch Claude pull live data from Clio in under a minute (matters, contacts, tasks) without copying client information into chat.

<p align="center">
  <a href="https://youtu.be/RmB0iGyJ9cs">
    <img src="docs/demo-thumbnail.png" alt="Clio MCP: Claude pulls live data" width="640">
  </a>
  <br><br>
  <a href="https://youtu.be/RmB0iGyJ9cs"><b>▶&nbsp;&nbsp;Watch the 60-second demo on YouTube</b></a>
</p>

---

**Setup tips + ABA Opinion 512 compliance updates for firms building with Claude + Clio.**

→ [Subscribe to Oktopeak Builder Notes](https://tally.so/r/q4kzk9?source=clio-readme). Short emails, easy unsubscribe.

---

## Compliance & Security

This section exists because law firms evaluating AI tools have asked the right questions. Here are direct answers.

### ABA Formal Opinion 512: AI and competence

ABA Opinion 512 (2023) requires attorneys using AI tools to understand how those tools work, supervise their outputs, and maintain confidentiality of client information. This connector is designed with those obligations in mind:

- **Audit log.** Every tool call (every time Claude queries Clio on your behalf) is appended to a local log file at `~/.clio-mcp/audit.log`. Each entry records the timestamp, which tool was invoked, what arguments were passed, whether it succeeded, and the Clio user ID. The log is stored on your machine, not in any cloud service. It is append-only and never purged by the software, so your firm retains a complete record of AI-initiated data access.

- **No data retention by the connector.** The connector does not store matter data, client names, or any Clio content. It fetches from the API and passes results to Claude. The only thing persisted locally is your authentication token, and that is encrypted (see below).

- **Scope limited to tasks, notes, and document uploads.** The connector can create tasks and notes on matters, and upload documents to matters. It cannot create, edit, or delete matters, contacts, calendar entries, or billing records. This is a deliberate v1 design choice: write access is limited to the operations most useful for AI-assisted legal work while minimising liability.

### Token security: encryption at rest

Your OAuth credentials are never stored in plain text. After you authenticate, the connector encrypts your access token and refresh token using **AES-256-GCM**, the same standard used by financial institutions, and writes the ciphertext to `~/.clio-mcp/tokens.enc`. The encryption key is auto-generated on first run and stored in your OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service), never on the filesystem in plaintext.

If someone obtained the token file without the key, they would not be able to read it.

### OAuth 2.0: no passwords stored

Authentication uses Clio's standard OAuth 2.0 flow. You log in through your browser on Clio's own login page. The connector never sees or handles your Clio password. CSRF protection is implemented via a cryptographic state parameter on every auth request.

### Local-first architecture

The connector runs entirely on your machine. There is no Clio MCP cloud service, no relay server, no third party in the middle. Your Clio API traffic goes directly from your device to Clio's servers.

---

## Trust Model

Three questions practitioners evaluating an AI tool for sensitive legal work should ask before installing.

### Which Claude tier should we use?

The connector secures the transport between Clio and Claude. It does NOT change what Claude itself does with data once data enters a conversation. **Claude's data handling depends on the tier you use, not on this connector.**

- **Anthropic API with zero-data-retention (ZDR)**: no-training, no-retention terms, enabled at the organization level on the Anthropic API. A small firm can obtain it; it is not reserved for large enterprise contracts. **This is the configuration we recommend for any work involving privileged client data.**
- **Claude Enterprise / Team**: explicit no-training guarantees, with ZDR available as an option. One way to get the configuration above, suited to firms that want a managed workspace rather than an API integration. Claude Enterprise is one option, not the only one.
- **Claude Pro / Max (consumer)**: Anthropic does not train on consumer chat data by default and human review for safety is limited. Acceptable for non-privileged exploration. **Not a substitute for a zero-data-retention deployment when handling client matter data.**

If you are deploying this connector at a firm, pair it with a zero-data-retention configuration (the Anthropic API with ZDR at the organization level, or Claude Enterprise with ZDR). If you are an individual lawyer testing it on personal or non-privileged data, Claude Pro is reasonable for the testing phase but should not become the long-term setup for client work.

One caveat on model choice: the no-retention default is model-dependent. The newest and most capable model may require retention and opt-in review, so pin the model deliberately and re-check the retention terms on every vendor release.

### Access vs retention: the distinction most evaluations miss

A common assumption is that logging equals compliance: if there is a record of what was accessed, the firm is covered. That conflates two separate things, and the gap between them is where privileged content gets exposed.

- **Retention** is what happens to the data *after* the request: whether it persists in training sets, vendor logs, or any system once the answer is returned.
- **Access** is whether the model saw the matter content *at all*, even ephemerally, in-flight, only to produce its answer.

For privileged matter content, **access is the exposure.** The moment privileged content enters a conversation, the model has processed it, whether or not anything is retained afterward. No-retention and no-training guarantees constrain what happens to the data later; they do not undo the fact that it was seen, and the firm's audit log records only that access happened, not that it was permissible.

This is why tier choice is not optional for privileged work. **Zero-data-retention is the only clean answer for anything touching privileged matter content**, whether you obtain it on the Anthropic API at the organization level or through Claude Enterprise: it is the configuration where the content is processed under contractual no-training, no-retention terms rather than consumer ones. If the matter is privileged and you are not on a ZDR configuration (or a local model, see below), assume the content has been exposed under terms your firm has not vetted.

The connector's own no-retention posture (it stores nothing but your encrypted token) covers the transport layer only. It says nothing about what the model tier does with content once that content enters the conversation. That second question is the one this section answers, and it is the one your firm has to answer before privileged data ever reaches Claude.

### Supply-chain trust (npm package)

The connector ships as `@oktopeak/clio-mcp` on npm. Like every npm package, the published version can be updated at any time by the maintainer. Standard hygiene applies:

- **Pin versions in production.** Use an exact version such as `@oktopeak/clio-mcp@2.0.1` (the current release in `package.json`) rather than a range like `^2.0.0`. Audit before upgrading.
- **Review the diff.** Every release is a tagged commit on GitHub. Verify changes before pulling a new version into a firm-wide deployment.
- **Build from source.** If your firm requires it, clone the repo, audit the code, run from your own build artifact. We do not gate any feature behind the npm distribution.
- **Maintainers.** Published by [Oktopeak](https://oktopeak.com), a public team with public commits and a public npm publisher account. Not anonymous. We respond to security reports at `office@oktopeak.com`.

### What is encrypted, what is not

To pre-empt a common misread:

- **OAuth tokens** (your Clio access + refresh token) are encrypted with AES-256-GCM at rest in `~/.clio-mcp/tokens.enc`. They cannot be read without the encryption key.
- **The encryption key itself** is auto-generated on first run and stored in the OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service). It never touches the filesystem in plaintext. For CI/headless installs without a keychain, you can override this by setting `ENCRYPTION_KEY` as a 64-character hex string in your environment.
- **Audit log entries** at `~/.clio-mcp/audit.log` are not encrypted. They contain metadata (timestamps, tool names, parameters with secrets redacted), not Clio content.

---

## Running with a local model (no third-party processor)

After the SDNY ruling in [*United States v. Heppner*](https://harvardlawreview.org/blog/2026/03/united-states-v-heppner/) (Feb 2026) that consumer Claude is not protected by attorney-client privilege, some firms want a deployment with **no third-party AI processor at all**: model inference running entirely on the firm's own hardware.

This connector supports that out of the box. MCP is a protocol, not a Claude-specific feature. The same connector that talks to Claude Desktop also talks to:

- **[LM Studio](https://lmstudio.ai)** running Llama 4 70B / DeepSeek V4 / Mistral Large locally (recommended primary path)
- **[Continue.dev](https://continue.dev)** + [Ollama](https://ollama.com) + a bridge ([`mcphost`](https://github.com/mark3labs/mcphost) or [`ollama-mcp-bridge`](https://github.com/patruff/ollama-mcp-bridge))
- Any other MCP-compatible client

Full deployment guide and example configs in [`docs/privilege-stack/`](docs/privilege-stack/). Strategic context (when this beats Claude Enterprise, hardware spec, validation steps) in our [Privilege Stack blog post](https://oktopeak.com/blog/privilege-stack-on-prem-legal-ai/).

---

## What you can do

Once connected, you can ask Claude things like:

**Matters**
- *"Show me all open matters for Acme Corp"*
- *"What's the status of matter 2024-0042?"*
- *"List my pending matters from the last quarter"*
- *"Open a new matter for Acme Corp: litigation, responsible attorney John Smith"*

**Contacts**
- *"Find the contact details for Jane Smith"*
- *"What's the email address and phone number for client ID 8821?"*
- *"Show me all contacts matching 'Acme', and fetch the next page if there are more"*

**Documents**
- *"List all documents on matter 4821"*
- *"Get the download link for document 9934"*
- *"Find all documents named 'retainer' across all matters"*

**Tasks**
- *"What tasks are due this week on matter 4821?"*
- *"Show me all high-priority incomplete tasks"*
- *"Create a task on matter 4821 to file the motion by Friday, high priority"*

**Notes**
- *"Add a note to matter 4821: initial consultation completed, client confirmed retainer"*
- *"Create a note on this matter summarising today's call with the client"*

**Calendar**
- *"What do I have scheduled between April 28 and May 2?"*
- *"List all calendar entries for next week"*
- *"Show me my available calendars"*
- *"Add a court hearing for matter 4821 on June 10 at 9am"*

**Time entries**
- *"How many hours have been logged on matter 4821 this month?"*
- *"Show me all time entries between April 1 and April 30"*

**Billing**
- *"What's the outstanding balance on matter 4821?"*
- *"When was the last invoice issued for this matter?"*

**Users**
- *"List all attorneys in the firm"*
- *"What's the user ID for Jane Smith?"*
- *"Show me all staff members"*

The connector retrieves live data from Clio on every request. Nothing is cached or stored by the AI.

---

## Requirements

Before you begin, make sure you have:

- **Node.js 18 or later**: [nodejs.org/en/download](https://nodejs.org/en/download)
- **Claude Desktop**: [claude.ai/download](https://claude.ai/download)
- **A Clio account** with permission to create developer applications (ask your Clio administrator if you are unsure)

---

## Setup

**5 steps. 10-15 minutes the first time.** You'll register a Clio Developer App, add one JSON block to your Claude Desktop config, and run an OAuth login. The encryption key is generated automatically; no manual key handling.

Before you run any of this in production, read the [Compliance & Security](#compliance--security) and [Trust Model](#trust-model) sections above. If you are deploying for a firm, pair the connector with a zero-data-retention configuration (the Anthropic API with ZDR at the organization level, or Claude Enterprise); see "Which Claude tier should we use?" above.

### Step 1: Clone and build

Open a terminal and run:

```bash
git clone https://github.com/oktopeak/clio-mcp.git
cd clio-mcp
npm install
npm run build
```

Note the full path to the folder you just cloned; you will need it in Step 3.

```bash
# On Mac/Linux, print the full path:
pwd

# Example output: /Users/yourname/clio-mcp
```

### Step 2: Create a Clio API application

1. Go to **[developers.clio.com](https://developers.clio.com)** and sign in with your Clio login
2. Click **Developer Apps → Add**
3. Give it a name (e.g., *Claude Connector*)
4. Set the redirect URI to exactly: `http://127.0.0.1:5678/callback`
5. Save the application
6. Copy the **Client ID** and **Client Secret**; you will need them in the next step

### Step 3: Configure Claude Desktop

As of v2.0.0 the connector supports two transports: **stdio** (the connector runs as a child process of Claude Desktop, single-user) and **HTTP/SSE** (the connector runs as a standalone server, supports multiple sessions and remote access). Pick one.

Open your Claude Desktop configuration file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

#### Option A: stdio (simplest, single-user)

Add the following block inside the `"mcpServers"` section, replacing the placeholder values with your own:

```json
{
  "mcpServers": {
    "clio": {
      "command": "node",
      "args": ["/FULL/PATH/TO/clio-mcp/build/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "CLIO_CLIENT_ID": "your_client_id",
        "CLIO_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/clio-mcp` with the path you noted in Step 1 (e.g., `/Users/yourname/clio-mcp`). `TRANSPORT=stdio` is required because the connector defaults to HTTP mode at v2.0.0.

#### Option B: HTTP/SSE (standalone server, multi-session)

Start the connector as a long-running server. **In HTTP mode an API key is required.** The server refuses to start unless `MCP_API_KEY` is set to a secret of at least 24 characters. Generate one first, then start the server. In a terminal, from the `clio-mcp` directory:

```bash
# Generate a key once and keep it somewhere safe
openssl rand -hex 32

TRANSPORT=http MCP_BASE_URL=http://127.0.0.1:3000 MCP_API_KEY=<the key you generated> \
CLIO_CLIENT_ID=your_client_id CLIO_CLIENT_SECRET=your_client_secret \
node build/index.js
```

Then point Claude Desktop at it via the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, passing the same key as a bearer token. (`mcp-remote` recommends the `${AUTH_HEADER}` form because Claude Desktop does not handle spaces inside `args` reliably.)

```json
{
  "mcpServers": {
    "clio": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3000/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <the key you generated>" }
    }
  }
}
```

Every route that reaches the MCP server returns `401 Unauthorized` without the key: all methods on `/mcp` (POST, the GET/SSE stream, DELETE) and any unknown path. Only `/health` and the OAuth redirect target `/oauth/callback` are reachable without it, because Clio's browser redirect cannot carry a bearer token.

**Local development only:** if you need to run the HTTP server without a key on your own machine, set `MCP_ALLOW_UNAUTHENTICATED=true`. The server starts with a loud warning and every route is open. Never use this on a public host or anywhere other people can reach the port; anyone who can reach the endpoint can drive the connector with your Clio access.

---

If the file already has other MCP servers configured, add a comma after the last entry and then add the `"clio"` block.

**Using Clio EU, Australia, or Canada?** Set `CLIO_REGION` to `eu`, `au`, or `ca` (the default is `us`). Clio assigns the region when the account is created, and the value must match the Clio server your firm logs in to: `app.clio.com` (us), `eu.app.clio.com` (eu), `au.app.clio.com` (au), or `ca.app.clio.com` (ca). Check the hostname in your browser after logging in to Clio, or contact Clio support if you are unsure. See [Clio regions](#clio-regions) below for the full table.

### Step 4: Restart Claude Desktop

Quit Claude Desktop completely and reopen it.

> [!TIP]
> **On Windows?** The same Windows-specific gotchas that hit our MyCase MCP install also hit Clio MCP: `Could not attach to MCP server` (direct npx invocation), `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (corporate antivirus SSL inspection), and OAuth redirect port mismatches. The fixes (`cmd /c npx` wrapper, `NODE_OPTIONS=--use-system-ca`, port matching) are documented in our companion install guide.
>
> → **[MyCase MCP on Windows: The Install Guide We Wish Existed](https://oktopeak.com/blog/mycase-mcp-windows-install-guide/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=windows-install-guide)**, written for MyCase MCP but the Windows fixes apply identically to Clio MCP.

### Step 5: Authenticate with Clio

In a new Claude conversation, type:

```
authenticate with Clio
```

Claude will open your browser to Clio's login page. Log in normally. When you see *"Authentication successful"*, return to Claude. You are connected.

To confirm everything is working, type:

```
check my Clio auth status
```

You should see your Clio user ID and token expiry time.

---

> [!TIP]
> **Not the person who edits config files?**
>
> If the five steps above look like too much, we can deploy it in your firm for you: scoped OAuth credentials, audit log wired into your stack, one custom workflow designed with your team, and training. Most law firms find this is the faster path.
>
> → **[See Guided MCP Setup](https://oktopeak.com/services/mcp-guided-setup/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=mid-tip-svc)**, or [book a 30-min scoping call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=mid-tip-call)

---

## Available tools

Claude selects and calls these tools automatically based on your questions. You do not need to invoke them by name.

### Auth (3 tools)

| Tool | What it does |
|---|---|
| `authenticate` | Opens your browser to Clio's login page and stores your credentials securely |
| `auth_status` | Shows whether you are currently authenticated and when your session expires |
| `logout` | Clears your stored credentials from this machine |

### Matters (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_matters` | `status` (open/pending/closed), `limit` | Lists matters with optional status filter |
| `get_matter` | `matter_id` | Returns full detail for a specific matter |
| `create_matter` | `client_id`, `description`, `status`, `open_date`, `practice_area_id`, `billable`, `responsible_attorney_id`, `originating_attorney_id`, `client_reference` | Creates a new matter; status defaults to Open, billable defaults to true |

### Contacts (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `search_contacts` | `query`, `limit`, `page_token` | Searches contacts by name, email, or company; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token`; pass the token back to fetch the next page |
| `get_contact` | `contact_id` | Returns full detail for a specific contact including all emails, phone numbers, and addresses |

### Documents (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_documents` | `matter_id`, `parent_id`, `query`, `limit`, `page_token` | Lists or full-text searches documents; at least one of `matter_id`, `parent_id`, or `query` is required; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `get_document` | `document_id` | Returns document metadata and a direct download URL |
| `upload_document` | `file_path`, `matter_id`, `name`, `content_type` | Uploads a local file to a matter using Clio's multipart S3 upload flow |

### Tasks (4 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_tasks` | `matter_id`, `status` (Pending/Complete/In Progress/In Review/Draft), `due_date_start`, `due_date_end`, `limit` | Lists tasks with optional filters |
| `create_task` | `matter_id`, `name`, `description`, `priority` (High/Normal/Low), `due_date`, `assignee_id` | Creates a task on a matter; priority defaults to Normal |
| `update_task` | `task_id`, `name`, `description`, `priority`, `due_date`, `status`, `assignee_id` | Updates one or more fields on an existing task |
| `complete_task` | `task_id` | Marks a task as complete |

### Calendar (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_calendars` | none | Lists calendars the user can write to; use the returned `id` as `calendar_owner_id` when creating entries |
| `list_calendar_entries` | `from`, `to` | Lists calendar entries within a date range (YYYY-MM-DD or YYYY-MM-DDTHH:MM) |
| `create_calendar_entry` | `summary`, `start_at`, `end_at`, `calendar_owner_id`, `description`, `all_day`, `matter_id`, `location`, `send_email_notification`, `attendee_ids` | Creates a calendar entry (hearing, deadline, meeting); `start_at`/`end_at` accept date or datetime |

### Time entries (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_time_entries` | `matter_id`, `start_date`, `end_date`, `limit` | Lists billable time entries with optional filters |
| `log_time_entry` | `matter_id`, `date`, `quantity_in_hours`, `note`, `price`, `non_billable`, `no_charge`, `activity_description_id`, `user_id` | Creates a new billable (or non-billable) time entry on a matter |
| `create_activity` | `type`, `date`, `matter_id`, `note`, `quantity_in_hours`, `price`, `non_billable`, `no_charge`, `activity_description_id`, `user_id`, `reference`, `tax_setting` | Creates any Clio activity type: TimeEntry, ExpenseEntry, HardCostEntry, or SoftCostEntry |

### Billing (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `get_billing_summary` | `matter_id` | Returns total billed, outstanding balance, and last invoice date for a matter |

### Notes (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `create_note` | `matter_id`, `subject`, `body` | Creates a note on a matter; appears in Clio's matter timeline |

### Users (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_users` | `name`, `subscription_type` (attorney/nonattorney), `enabled`, `limit` | Lists firm users with their IDs |
| `get_user` | `user_id` | Returns detail for a single user by ID |

### Audit log (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `export_audit_log` | `date_from`, `date_to`, `matter_id`, `limit`, `offset` | Exports audit-log entries for bar review and ABA Opinion 512 compliance. Filterable by date range and matter, paginated (default 500 per page, max 1000) |

---

## Resources

The connector also exposes two MCP resources: read-only content that compatible clients (including Claude Desktop) can surface automatically at the start of a session.

| Resource URI | What it contains |
|---|---|
| `clio://compliance/notice` | One-paragraph compliance reminder covering ABA Opinion 512, audit logging, and the attorney-review requirement for AI-generated content |
| `clio://auth/status` | Live authentication state: whether you are connected, your Clio user ID, and minutes until token expiry |

---

## Configuration reference

All settings are passed as environment variables (in your Claude Desktop config for stdio mode, or in the server's environment for HTTP mode). Only `CLIO_CLIENT_ID` and `CLIO_CLIENT_SECRET` are required in all modes; `MCP_BASE_URL` and `MCP_API_KEY` are additionally required in HTTP mode.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLIO_CLIENT_ID` | Yes | (none) | Client ID from your Clio developer application |
| `CLIO_CLIENT_SECRET` | Yes | (none) | Client Secret from your Clio developer application |
| `TRANSPORT` | No | `http` | `stdio` or `http`. Defaults to `http` at v2.0.0; set to `stdio` for the pre-v2 behavior |
| `MCP_BASE_URL` | HTTP mode | (none) | Public base URL of this server (e.g. `http://127.0.0.1:3000`). Used for the OAuth redirect |
| `PORT` | No | `3000` | HTTP listen port (HTTP mode only) |
| `MCP_API_KEY` | HTTP mode | (none) | Bearer token every client must send in the `Authorization` header. Required in HTTP mode, minimum 24 characters; the server refuses to start without it. Generate with `openssl rand -hex 32` |
| `MCP_ALLOW_UNAUTHENTICATED` | No | `false` | Local development only. `true` lets the HTTP server start without `MCP_API_KEY` and prints a warning at startup. Never set this on a public host |
| `ENCRYPTION_KEY` | No | auto-generated | Overrides OS keychain. Required only for CI/headless installs where no keychain is available. Must be a 64-character hex string. |
| `CLIO_REDIRECT_PORT` | No | `5678` | Local port for the OAuth callback (stdio mode). Change if 5678 is in use on your machine |
| `CLIO_REGION` | No | `us` | Clio data region: `us`, `eu`, `au`, or `ca`. Controls the default Clio API and OAuth base URLs. Set at Clio account creation; must match the server your firm logs in to. Any other value stops startup with an error |
| `CLIO_API_BASE` | No | `<region host>/api/v4` | Advanced override for the API base URL. Takes precedence over `CLIO_REGION` |
| `CLIO_AUTH_URL` | No | `<region host>/oauth/authorize` | Advanced override for the OAuth authorization endpoint |
| `CLIO_TOKEN_URL` | No | `<region host>/oauth/token` | Advanced override for the OAuth token endpoint |

### Clio regions

Clio hosts each firm's data in one of four regions. The region is chosen when the Clio account is created and the connector cannot change it; set `CLIO_REGION` to match the server your firm logs in to (the hostname in the browser address bar after login). Any value outside this list stops the connector at startup with an error naming the valid values. There is no silent fallback to the US endpoint.

| `CLIO_REGION` | Clio server | API base | OAuth authorize / token |
|---|---|---|---|
| `us` (default) | `app.clio.com` | `https://app.clio.com/api/v4` | `https://app.clio.com/oauth/authorize`, `https://app.clio.com/oauth/token` |
| `eu` | `eu.app.clio.com` | `https://eu.app.clio.com/api/v4` | `https://eu.app.clio.com/oauth/authorize`, `https://eu.app.clio.com/oauth/token` |
| `au` | `au.app.clio.com` | `https://au.app.clio.com/api/v4` | `https://au.app.clio.com/oauth/authorize`, `https://au.app.clio.com/oauth/token` |
| `ca` | `ca.app.clio.com` | `https://ca.app.clio.com/api/v4` | `https://ca.app.clio.com/oauth/authorize`, `https://ca.app.clio.com/oauth/token` |

---

## Audit log reference

Every tool call is recorded at `~/.clio-mcp/audit.log` in [JSONL](https://jsonlines.org) format (one JSON object per line). Example entry:

```json
{"timestamp":"2026-04-23T14:05:00.123Z","session_id":"3f2e9b1c-...","machine_ip":"192.168.1.42","tool":"get_matter","args":{"matter_id":4821},"outcome":"success","clio_user_id":"10023","matter_id":4821}
```

Each entry contains:

| Field | Description |
|---|---|
| `timestamp` | ISO 8601 date and time of the call |
| `session_id` | Per-session UUID (stable for the life of a stdio process; one per HTTP session) |
| `machine_ip` | LAN IPv4 address of the host that logged the call, when detectable |
| `tool` | Which tool Claude invoked |
| `args` | Arguments passed to the tool (secrets are automatically redacted) |
| `outcome` | `success`, `error`, or `not_found` |
| `error_message` | Present only when `outcome` is `error` |
| `clio_user_id` | The Clio user whose credentials were active |
| `matter_id` | Present for matter-specific queries |
| `result_count` | Present for list / export tools: number of records returned |

The log file is append-only and never rotated or truncated by this software. To archive old entries, use your operating system's log rotation tools (`logrotate` on Linux/Mac).

---

## Troubleshooting

**Claude says the Clio tool is not available**
Restart Claude Desktop fully (quit, do not just close the window). If the problem persists, check that the path in your config file is correct and that `build/index.js` exists in that folder.

**Authentication opens a browser but then nothing happens**
Make sure the redirect URI in your Clio developer application is set to exactly `http://127.0.0.1:5678/callback`. No trailing slash, no `localhost`; it must be `127.0.0.1`.

**"ENCRYPTION_KEY must be 64 hex chars" error**
This error appears when `ENCRYPTION_KEY` is set in your environment but has the wrong length. Either correct or remove the value; if removed, the connector will use the key stored in your OS keychain (or generate one on first run).

**"Token file exists but decryption failed" warning**
This appears if the encryption key no longer matches the key used to encrypt the token file, for example if the keychain entry was deleted, you switched machines, or you changed `ENCRYPTION_KEY`. Run the `logout` tool in Claude and then `authenticate` again to re-create the token file with the current key.

**Logout does not clear the keychain entry**
The `logout` command removes your stored token file but not the encryption key from the OS keychain. For a complete credential wipe (for example, when transferring a machine), also remove the `clio-mcp / encryption-key` entry via your system's keychain manager: Keychain Access on macOS, Windows Credential Manager on Windows, or `secret-tool delete --label clio-mcp` on Linux.

**Port 5678 is already in use**
Add `"CLIO_REDIRECT_PORT": "5679"` to the `env` block in your Claude Desktop config, and update your Clio application's redirect URI to `http://127.0.0.1:5679/callback`.

---

## Need more than the connector?

The open-source connector handles about 20% of what most firms eventually want from Claude + Clio. It reads your data. It does not build workflows around that data.

We help two ways, depending on your scope:

→ **Guided MCP Setup**: We deploy the connector in your firm with scoped credentials, audit log wired into your stack, a custom workflow designed with your team, and training. Scope and pricing tailored to your firm.
  → [oktopeak.com/services/mcp-guided-setup/](https://oktopeak.com/services/mcp-guided-setup/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-svc-guided)

→ **Legal AI Integration**: For multi-workflow builds, document automation, intake automation, custom AI agents, and full compliance architecture across your stack.
  → [oktopeak.com/services/legal-ai-integration/](https://oktopeak.com/services/legal-ai-integration/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-svc-legal-ai)

→ **Firm-wide deployment:** rolling Claude + this connector out to a whole firm (Claude Cowork, multi-user, security review)? See [Firm Deployment](https://oktopeak.com/services/firm-deployment/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-svc-firm-deployment).

ABA Opinion 512 compliant from day one. Want a polished overview of this connector with video demo and FAQ?
→ [oktopeak.com/clio-mcp/](https://oktopeak.com/clio-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-hub)

Want to talk first? → [Book a 30-min scoping call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-call)

---

## Other connectors by Oktopeak

We ship the same kind of connector for other practice management platforms. Each has its own overview page on oktopeak.com:

- **[MyCase MCP](https://oktopeak.com/mycase-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=xlink-mycase)**: open-source MCP connector for MyCase legal practice management. Same architecture, same audit logging, same encryption at rest. MIT licensed. Source: [github.com/oktopeak/mycase-mcp](https://github.com/oktopeak/mycase-mcp). npm: [`@oktopeak/mycase-mcp`](https://www.npmjs.com/package/@oktopeak/mycase-mcp)
- **[Filevine MCP](https://oktopeak.com/filevine-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=xlink-filevine)**: open-source MCP connector for Filevine practice management. Cases, contacts, notes, documents, tasks, and Collection sections. Same architecture, same audit logging, same encryption at rest. MIT licensed. Source: [github.com/oktopeak/filevine-mcp](https://github.com/oktopeak/filevine-mcp). npm: [`@oktopeak/filevine-mcp`](https://www.npmjs.com/package/@oktopeak/filevine-mcp)
- **[Lawmatics MCP](https://oktopeak.com/lawmatics-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=xlink-lawmatics)**: open-source MCP connector for Lawmatics legal CRM and intake, with a config-level read-only mode. MIT licensed. Source: [github.com/oktopeak/lawmatics-mcp](https://github.com/oktopeak/lawmatics-mcp). npm: [`@oktopeak/lawmatics-mcp`](https://www.npmjs.com/package/@oktopeak/lawmatics-mcp)
- **[IntakeQ / PracticeQ MCP](https://github.com/oktopeak/IntakeQ)**: HIPAA-aware MCP connector for IntakeQ/PracticeQ (healthcare / behavioral & allied-health clinics). Audit logging on every PHI read/write, BAA + Zero-Data-Retention guidance. MIT licensed. npm: [`@oktopeak/intakeq-mcp`](https://www.npmjs.com/package/@oktopeak/intakeq-mcp)

---

## Supporting this project

This connector is free, MIT licensed, and maintained by [Oktopeak](https://oktopeak.com). It always will be; we don't take donations. If it saved you time, the things that actually help:

- **Star this repo.** It is genuinely how other firms find it.
- **Tell another firm** running Clio.
- **[Leave a review](https://clutch.co/profile/oktopeak)** if we helped you directly.
- Need it deployed, extended, or maintained for your firm? **[Commercial support](https://oktopeak.com/clio-mcp/)**; that is what funds the free work.

## Who we are

**[Oktopeak](https://oktopeak.com/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=who-we-are): digital transformation for law firms and healthcare.**

We're a 7-person in-house product team building AI solutions for regulated industries: AI integrations, workflow automation, and custom software our clients own outright. We maintain five open-source MCP connectors: Clio, [MyCase](https://github.com/oktopeak/mycase-mcp), [Filevine](https://github.com/oktopeak/filevine-mcp), [Lawmatics](https://github.com/oktopeak/lawmatics-mcp), and [IntakeQ](https://github.com/oktopeak/IntakeQ), and deploy them inside real practices with scoped credentials, audit logs, and workflows built around how your team actually works.

- 🌐 [oktopeak.com](https://oktopeak.com/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=who-we-are)
- 📅 [Book a 30-min call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=who-we-are-call)
- ✉️ office@oktopeak.com (security reports welcome)
- 💼 [LinkedIn](https://www.linkedin.com/company/oktopeak-tech)

---

## Contributing

Issues and pull requests welcome. If you run into a Clio API edge case this connector does not handle cleanly, open an issue with the scenario and an example request. If you want to add a tool that falls within the "read-only" v1 scope, send a PR.

---

## License

MIT © [Oktopeak](https://oktopeak.com)

See [LICENSE](./LICENSE) for the full text.
