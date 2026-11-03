# Clio MCP Server: Connect Claude to Clio Practice Management

> ### Built by [Oktopeak](https://oktopeak.com/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-byline): AI transformation & automation for law firms
> **Digital transformation for legal and healthcare businesses.** We build AI integrations, workflow automation, and custom software your firm owns outright, including this connector. → [Book a 30-min call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-byline-call)

[![Connect Claude to Clio for the whole law firm, 24-second video](docs/own-your-clio-video.jpg)](https://oktopeak.com/clio-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=video#video)

*Twenty-six seconds on what the connector does for a whole firm: runs in your own cloud, each person signs in with their own Clio login, one audit log, one automation built each month, $300 a month flat. [Watch it](https://oktopeak.com/clio-mcp/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=video#video).*

Open-source Model Context Protocol (MCP) connector that lets Claude read live data from [Clio](https://www.clio.com) (matters, custom fields, notes, contacts, documents, folders, tasks, calendar, and billing) without copying client information into chat windows. Built for law firms that care about attorney-client privilege, ABA Opinion 512 compliance, and keeping AI workflows inside their existing practice management stack.

> **TL;DR:** 37 Clio tools exposed to Claude across stdio and HTTP/SSE transports. Audit-logged for ABA Opinion 512. OAuth tokens encrypted at rest with AES-256-GCM. Local-only by default: you register your own Clio developer app, and no relay server sits in between. A separate one-click "listed" variant for the Clio App Directory uses a minimal login-only broker instead, see [Listed / one-click install variant](#listed--one-click-install-variant-app-directory). MIT license, free forever.

**Who this is for:** Law firm IT, legal operations teams, tech-forward partners, and engineers at legal tech companies. If you can follow a five-step terminal install, you can use this.

> [!TIP]
> **Not a developer? You don't need to be.**
>
> The README below assumes someone comfortable editing a JSON config file. If that's not you or your team, we deploy this for law firms: scoped credentials, audit log wired in, one custom workflow, training. A simpler one-command installer is also planned for v0.2.
>
> → **Whole firm? The Firm Plan: $300 a month.** Set up in your own cloud, every attorney signs in with their own login, one audit log, one automation built for you each month, no setup fee, cancel any time. → [oktopeak.com/firm-plan/](https://oktopeak.com/firm-plan/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-tip-firmplan), or [book a 30-min call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=top-tip-call)

**Jump to:** [Demo](#demo) · [Setup](#setup) · [Available tools](#available-tools) · [Export your whole account](#exporting-your-whole-account) · [Security & compliance](#compliance--security) · [Need it deployed for you?](#need-more-than-the-connector)

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

## New in 2.5.0: export your whole account

`npx @oktopeak/clio-mcp export --out <folder>` copies every matter, contact, note, task, calendar entry, time entry, expense, bill and document out of Clio onto your own computer, read-only, under your own Clio app. Run `npx @oktopeak/clio-mcp auth` first. See [Exporting your whole account](#exporting-your-whole-account).

Only want the export, not the Claude connector? The same command ships on its own as [`@oktopeak/clio-export`](https://github.com/oktopeak/clio-export): `npx @oktopeak/clio-export --out <folder>`. Walkthrough: [oktopeak.com/clio-export/](https://oktopeak.com/clio-export/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=new-in-250).

## Upgrading from 2.0.1

If you installed before September 2026 you are on 2.0.1, and there is one reason to upgrade that is worth stating plainly rather than burying in a changelog.

**2.0.1 writes client data to its audit log.** Contact search queries, note subjects, matter descriptions and custom field values were all recorded verbatim in `~/.clio-mcp/audit.log`. The log is a plain file that nothing rotates. Since 2.2.0 audit entries carry ids, counts, dates and page tokens only, enforced by an allowlist rather than a denylist, with a test that fails if any tool ever starts logging content again.

```bash
npm install -g @oktopeak/clio-mcp@latest   # or just restart Claude Desktop if you use npx
```

Your existing `~/.clio-mcp/audit.log` still contains whatever the old version put there. It is worth reading before you decide what to do with it.

Also new since 2.0.1: custom fields and notes on matters and contacts, folder tools, matter relationships, a one-call activity summary across open matters, a config-level `READ_ONLY` mode, and full pagination on reads where a short answer would be a wrong one. See [CHANGELOG.md](CHANGELOG.md).

## Compliance & Security

This section exists because law firms evaluating AI tools have asked the right questions. Here are direct answers.

### ABA Formal Opinion 512: AI and competence

ABA Opinion 512 (2023) requires attorneys using AI tools to understand how those tools work, supervise their outputs, and maintain confidentiality of client information. This connector is designed with those obligations in mind:

- **Audit log.** Every tool call (every time Claude queries Clio on your behalf) is appended to a local log file at `~/.clio-mcp/audit.log`. Each entry records the timestamp, which tool was invoked, what arguments were passed, whether it succeeded, and the Clio user ID. The log is stored on your machine, not in any cloud service. It is append-only and never purged by the software, so your firm retains a complete record of AI-initiated data access.

- **No data retention by the connector.** The connector itself does not store matter data, client names, or any Clio content. It fetches from the API and passes results to Claude. The only thing it persists locally is your authentication token, and that is encrypted (see below). The separate `export` command is the one exception, by design: it writes a local copy of your Clio data to the folder you choose, and nothing else does.

- **Twelve write tools, all logged, all optional.** The connector can create matters, custom fields, notes, tasks, folders, calendar entries, time entries and activities, update matters and tasks, complete tasks, and upload documents. It never deletes anything and never touches contacts or billing records. Every write is recorded in the audit log, and `READ_ONLY=true` removes all twelve write tools from the server entirely (see [Read-only mode](#read-only-mode)), so a firm can start with read access and turn writes on when it has decided to.

### Token security: encryption at rest

Your OAuth credentials are never stored in plain text. After you authenticate, the connector encrypts your access token and refresh token using **AES-256-GCM**, the same standard used by financial institutions, and writes the ciphertext to `~/.clio-mcp/tokens.enc`. The encryption key is auto-generated on first run and stored in your OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service), never on the filesystem in plaintext.

If someone obtained the token file without the key, they would not be able to read it.

### OAuth 2.0: no passwords stored

Authentication uses Clio's standard OAuth 2.0 flow. You log in through your browser on Clio's own login page. The connector never sees or handles your Clio password. CSRF protection is implemented via a cryptographic state parameter on every auth request.

### Local-first architecture

The connector runs entirely on your machine. There is no Clio MCP cloud service, no relay server, no third party in the middle. Your Clio API traffic goes directly from your device to Clio's servers.

This is true for the default setup below, where you register your own Clio developer application. The one-click "listed" install variant (next section) is the one exception, and only for the login step.

### Listed / one-click install variant (App Directory)

If you installed this connector via the Clio App Directory's one-click install instead of registering your own Clio developer application, you're using the *listed variant*. It uses one Clio application owned by Oktopeak, shared across every installing firm, instead of a separate application per firm. That means the application's `client_secret` cannot be distributed to your machine — it lives only on a small hosted token broker Oktopeak operates.

**What that changes, precisely:** matter data flows directly between your machine and Clio; only the login handshake passes through our token service. Every tool call — matters, contacts, documents, tasks, calendar, billing, everything — still goes directly from your machine to Clio's API, exactly as in the BYOC setup above. The broker never sees, stores, or logs any of it; it is only involved for the few seconds it takes to complete the OAuth login (and again, briefly, on token refresh). It stores nothing durable — no tokens, no session data survive past that single handshake.

Full data-flow documentation for security reviewers, including a sequence diagram and what the broker persists versus never persists, is in the token broker's repository: [`docs/DATA_FLOW.md`](https://github.com/oktopeak/clio-mcp-backend/blob/main/docs/DATA_FLOW.md).

Everything else — local AES-256-GCM token encryption, the audit log, and the 37 tools — is identical to the BYOC setup. Note that Clio's OAuth doesn't support requesting a narrower scope per login; the permissions your token carries are whatever the connecting Clio application was granted when it was registered in the Clio Developer Portal. For the listed app, that registration is kept to the minimum permission set the 37 tools need — the same principle you'd apply yourself when registering your own app for the BYOC setup. See [Option C](#option-c--one-click-via-clio-app-directory) below for the resulting Claude Desktop config.

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

- **Pin versions in production.** Use an exact version such as `@oktopeak/clio-mcp@2.5.0` (the current release in `package.json`) rather than a range like `^2.0.0`. Audit before upgrading.
- **Review the diff.** Every release is a tagged commit on GitHub. Verify changes before pulling a new version into a firm-wide deployment.
- **Build from source.** If your firm requires it, clone the repo, audit the code, run from your own build artifact. We do not gate any feature behind the npm distribution.
- **Maintainers.** Published by [Oktopeak](https://oktopeak.com), a public team with public commits and a public npm publisher account. Not anonymous. We respond to security reports at `office@oktopeak.com`.

### What is encrypted, what is not

To pre-empt a common misread:

- **OAuth tokens** (your Clio access + refresh token) are encrypted with AES-256-GCM at rest in `~/.clio-mcp/tokens.enc`. They cannot be read without the encryption key.
- **The encryption key itself** is auto-generated on first run and stored in the OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service). It never touches the filesystem in plaintext. For CI/headless installs without a keychain, you can override this by setting `ENCRYPTION_KEY` as a 64-character hex string in your environment.
- **Audit log entries** at `~/.clio-mcp/audit.log` are not encrypted. They contain metadata (timestamps, tool names, parameters with secrets redacted), not Clio content.
- **The export folder** written by `export` is not encrypted by the connector. It holds your Clio data in plaintext, including client names in `checkpoint/`. Keep it on an encrypted disk.

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

- **Node.js 20 or later**: [nodejs.org/en/download](https://nodejs.org/en/download)
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

#### Option C — One-click via Clio App Directory

If you installed via the Clio App Directory, there's no developer application to register and no `CLIO_CLIENT_SECRET` to handle — the installer configures this for you. The resulting config uses `TOKEN_BROKER_URL` in place of `CLIO_CLIENT_ID`/`CLIO_CLIENT_SECRET`:

```json
{
  "mcpServers": {
    "clio": {
      "command": "node",
      "args": ["/FULL/PATH/TO/clio-mcp/build/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "TOKEN_BROKER_URL": "https://broker.oktopeak.com"
      }
    }
  }
}
```

See [Listed / one-click install variant](#listed--one-click-install-variant-app-directory) above for what this changes about the data flow.

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
> → **Whole firm? The Firm Plan: $300 a month.** Set up in your own cloud, every attorney signs in with their own login, one audit log, one automation built for you each month, no setup fee, cancel any time. → [oktopeak.com/firm-plan/](https://oktopeak.com/firm-plan/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=mid-tip-firmplan), or [book a 30-min scoping call](https://calendly.com/office-oktopeak/30min?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=mid-tip-call)

---

## Available tools

Claude selects and calls these tools automatically based on your questions. You do not need to invoke them by name.

### Auth (3 tools)

| Tool | What it does |
|---|---|
| `authenticate` | Opens your browser to Clio's login page and stores your credentials securely |
| `auth_status` | Shows whether you are currently authenticated and when your session expires |
| `logout` | Clears your stored credentials from this machine |

### Matters (4 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_matters` | `status` (open/pending/closed), `limit`, `page_token` | Lists matters with optional status filter, including custom field values; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `get_matter` | `matter_id` | Returns full detail for a specific matter, including its Maildrop forwarding address and custom field values |
| `create_matter` | `client_id`, `description`, `status`, `open_date`, `practice_area_id`, `billable`, `responsible_attorney_id`, `originating_attorney_id`, `client_reference`, `custom_field_values` | Creates a new matter; status defaults to Open, billable defaults to true |
| `update_matter` | `matter_id`, plus any of `create_matter`'s optional fields | Updates one or more fields on an existing matter, including its stage and custom field values |

### Custom fields (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_custom_fields` | `parent_type` (Matter/Contact), `include_deleted` | Lists the account's custom field definitions with their types, and for picklist fields their allowed options. Call this before reading or writing custom fields |
| `create_custom_field` | `name`, `parent_type` (Matter/Contact), `field_type`, `required`, `displayed`, `picklist_options` | Creates a new custom field definition. Use the returned `id` as `custom_field_id` in `create_matter` / `update_matter` to set its value |

### Matter stages (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `list_matter_stages` | `practice_area_id` | Lists the account's matter stages (Pre-Suit, Discovery, Settlement and so on) grouped by practice area and in pipeline order. Call this before setting `matter_stage_id`. Clio can attach workflows and task lists to a stage; whether an API-driven stage change fires them is not verified, so confirm on one matter before relying on it |

### Contacts (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `search_contacts` | `query`, `limit`, `page_token` | Searches contacts by name, email, or company; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token`; pass the token back to fetch the next page |
| `get_contact` | `contact_id` | Returns full detail for a specific contact including all emails, phone numbers, addresses, and custom field values |

### Relationships (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `list_matter_relationships` | `matter_id`, `limit`, `page_token` | Lists the contacts attached to a matter and the role each plays (co-counsel, expert, fact witness, opposing counsel) |

### Documents (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_documents` | `matter_id`, `parent_id`, `query`, `limit`, `page_token` | Lists or full-text searches documents; at least one of `matter_id`, `parent_id`, or `query` is required; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `get_document` | `document_id` | Returns document metadata and a direct download URL |
| `upload_document` | `file_path`, `matter_id`, `name`, `content_type` | Uploads a local file to a matter using Clio's multipart S3 upload flow |

### Folders (3 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_folders` | `matter_id`, `parent_id`, `query`, `limit`, `page_token` | Lists or full-text searches folders; at least one of `matter_id`, `parent_id`, or `query` is required; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `folder_exists` | `matter_id` or `parent_folder_id`, `name` | Checks whether a folder with the given exact name already exists; fully paginates and never relies on parent-type filtering, so it won't miss folders whose matter's document root is itself a Folder node |
| `create_folder` | `name`, `matter_id` or `parent_folder_id`, `if_not_exists` | Creates a folder at a matter's document root or under an existing folder; call `folder_exists` first to avoid duplicates |

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
| `list_calendar_entries` | `from`, `to`, `limit`, `page_token` | Lists calendar entries within a date range (YYYY-MM-DD or YYYY-MM-DDTHH:MM); returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `create_calendar_entry` | `summary`, `start_at`, `end_at`, `calendar_owner_id`, `description`, `all_day`, `matter_id`, `location`, `send_email_notification`, `attendee_ids` | Creates a calendar entry (hearing, deadline, meeting); `start_at`/`end_at` accept date or datetime |

### Time entries and expenses (4 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_time_entries` | `matter_id`, `start_date`, `end_date`, `limit`, `page_token` | Lists billable time entries with optional filters; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `list_expenses` | `matter_id`, `user_id`, `start_date`, `end_date`, `expense_type`, `limit`, `page_token` | Lists expenses (default `ExpenseEntry`; `HardCostEntry` / `SoftCostEntry` on request) with amount, quantity and category; same paginated envelope |
| `log_time_entry` | `matter_id`, `date`, `quantity_in_hours`, `note`, `price`, `non_billable`, `no_charge`, `activity_description_id`, `user_id` | Creates a new billable (or non-billable) time entry on a matter |
| `create_activity` | `type`, `date`, `matter_id`, `note`, `quantity_in_hours`, `price`, `non_billable`, `no_charge`, `activity_description_id`, `user_id`, `reference`, `tax_setting` | Creates any Clio activity type: TimeEntry, ExpenseEntry, HardCostEntry, or SoftCostEntry |

### Billing (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `get_billing_summary` | `matter_id` | Returns total billed, outstanding balance, and last invoice date for a matter |

### Notes (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `create_note` | `matter_id`, `subject`, `body` | Creates a note on a matter; appears in Clio's matter timeline |
| `list_notes` | `matter_id` **or** `contact_id`, `created_since`, `updated_since`, `limit`, `page_token` | Lists notes with subject, author, the note's own date, and the body as plain text (rich-text markup is kept on `detail_html`) |

### Reporting (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `matter_activity_summary` | `lookback_days`, `calendar_days_ahead`, `practice_area_id`, `stale_after_days`, `limit` | Last note, last time entry, next calendar entry, open task count and days since anything happened, for every open matter in one call, quietest first. Reads each collection once account-wide, so cost does not scale with the size of the book |

### Users (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_users` | `name`, `subscription_type` (attorney/nonattorney), `enabled`, `limit`, `page_token` | Lists firm users with their IDs; returns a paginated envelope with `total_count`, `has_more`, and `next_page_token` |
| `get_user` | `user_id` | Returns detail for a single user by ID |

### Audit log (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `export_audit_log` | `date_from`, `date_to`, `matter_id`, `limit`, `offset` | Exports audit-log entries for bar review and ABA Opinion 512 compliance. Filterable by date range and matter, paginated (default 500 per page, max 1000) |

---

## Exporting your whole account

The same package can copy everything out of Clio onto your own computer: every matter, contact, note, task, calendar entry, time entry, expense and bill as data files, and every document as a file in a folder tree a paralegal can navigate. Use it as a backup, or before you cancel. It only reads from Clio and never writes anything back.

```bash
npx @oktopeak/clio-mcp auth
npx @oktopeak/clio-mcp export --out ./clio-export
```

`auth` opens your browser, saves the login and prints who logged in and when the token expires. `export` never opens a browser; without a saved login it stops with "run auth first". Both commands need the same environment variables as the connector (`CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET`, and `CLIO_REGION` if you are not on `us`) and Node.js 20 or later. With `npx` there is no `.env` file to read, so set them in your shell:

```bash
# macOS / Linux
export CLIO_CLIENT_ID=your_client_id CLIO_CLIENT_SECRET=your_client_secret CLIO_REGION=eu
```

```powershell
# Windows PowerShell
$env:CLIO_CLIENT_ID = "your_client_id"
$env:CLIO_CLIENT_SECRET = Read-Host "Clio client secret"
$env:CLIO_REGION = "eu"
```

Export before you cancel. Run `--dry-run` first: it only counts records and documents and writes a `REPORT.md` with an estimate of the time and disk space the real run needs.

### Options

| Option | What it does |
|---|---|
| `--out <folder>` | Required. The folder must be empty or a previous export. |
| `--since <date>` | Only records changed after this date, where Clio supports it (see below). |
| `--only <list>` | Comma separated record types, for example `matters,folders,documents`. `document_versions` can only be named together with `documents`. |
| `--no-documents` | Skip documents and document files. |
| `--rate <n>` | Requests per second. Default 0.8, at most 10. Clio allows about 50 requests a minute, so values above about 0.8 will be throttled by Clio. |
| `--concurrency <n>` | Parallel downloads. Default 3, at most 8. |
| `--resume` | Continue a previous run in the same folder. |
| `--dry-run` | Count only. Writes `REPORT.md` and nothing else to the folder. |
| `--help` | Show the options. |

Record types: `matters`, `contacts`, `users`, `practice_areas`, `custom_fields`, `matter_stages`, `relationships`, `tasks`, `calendar_entries`, `notes`, `time_entries`, `expenses`, `bills`, `folders`, `documents`. Only when named in `--only`: `document_versions`, `communications`, `allocations`, `trust_line_items`, `bank_transactions`. Optional types that Clio refuses are reported as "not available", not as errors.

### What comes out

```
clio-export/
  data/<type>.jsonl            raw records, one per line
  data/<type>.csv              the same records for Excel
  matters/<number> - <client>/ documents, mirroring the Clio folder structure
  checkpoint/                  where the export saves its place
  manifest.json
  errors.jsonl                 failures: record type, status code and kind only
  REPORT.md                    what was exported, what was not, and why
```

Document files are named `<original name> [<document id>].<extension>`, made safe for Windows (no illegal characters, reserved names or over-long paths). The original names and folder paths are listed in `data/documents.csv`. The latest version of each document is downloaded; its version id is in the data. `--only document_versions` also saves the version history as data.

Names that Windows cannot store (reserved names such as `CON`, trailing dots or spaces, forbidden characters) are still handled by the export: `CON.txt` becomes `_CON [id].txt`. In live testing on an EU test account Clio refused to upload a file whose name ends with a dot, so such names should not occur in exported documents.

Empty folders are listed in `folders.jsonl` but are not created on disk; only folders that contain documents appear in the folder tree.

The CSV files open cleanly in Excel. Text that starts with `=`, `+`, `-` or `@` gets a leading apostrophe in the CSV so Excel does not run it as a formula; numbers are never changed, and the `.jsonl` files always hold the exact values.

### Other ways to get your data out

This is not the only option, and for some firms it is not the right one:

- **Clio's built-in export** (admins only) gives CSV files for matters, contacts, notes, tasks, calendar, communications, time and expenses. It does not include documents, bills or trust transactions. If spreadsheets are all you need, use it.
- **[FileScience](https://www.clio.com/app-directory/filescience/)** runs a hosted, daily cloud-to-cloud backup of Clio; the copy is kept in FileScience's cloud.
- **[Faster Suite](https://www.clio.com/app-directory/faster-suite/)** has a backup tool that downloads all Clio documents.
- **[Clio Data Escrow](https://help.clio.com/hc/en-us/articles/9290346939547)** keeps a weekly copy of Clio information and documents in a secure location.

This command is free and open source, runs once on your computer whenever you start it, and puts records and documents in one folder you control. For a nightly copy that runs without anyone starting it, you need a scheduler or one of the hosted options above.

### What is not included

- Ledger reports (trust ledger, client ledger, billing history, accounts receivable, work in progress). `--only ledger_reports` says so and exports nothing.
- Bill PDFs as Clio renders them. Bills are exported as data.
- Original email files.
- Documents that belong to no matter. The export compares its document count with the account's total and says in `REPORT.md` how many were left out; it never claims a complete export when it could not verify one.
- Custom fields on accounts where Clio refuses to return them. The export continues without them and `REPORT.md` says so. A run with an unreadable required type is reported as INCOMPLETE. If you see this, check the permissions of your Clio developer app (see Troubleshooting).

Known limitation: expenses are read per Clio activity type (`ExpenseEntry`, `HardCostEntry`, `SoftCostEntry`), and each row carries its type. If Clio also lists hard and soft cost entries under `ExpenseEntry`, those rows would appear twice in `data/expenses.*`. This has not been seen: no account we tested has hard or soft cost entries. Rows can be told apart by their `id`.

Tested live on 2026-11-03 against a Clio EU test account (408 matters, 419 folders, 8 documents, 11 MB): a dry run, a full export stopped with Ctrl-C (exit 4) and finished with `--resume` (COMPLETE, no duplicate rows), and a refresh run that downloaded 0 files again. Earlier live probes covered a 5 MB document and names with accents, double spaces and special characters. The test account has no bills and no hard or soft cost entries, so those types are covered by tests against a fake Clio only.

### How long it takes

Clio allows about 50 requests per minute per token during business hours. The default of 0.8 requests per second is 48 a minute, which stays under that limit. Every page of 200 records is one request, every document is at least one request more, and the folder tree and each matter's documents need a request each. A firm with 100,000 documents therefore needs well over a day. Large firms should start the export on a Friday and let it run over the weekend. `--dry-run` writes the number of requests and the time for your account to `REPORT.md`. The dry run itself has to look at every matter, at about 1.3 requests per matter, so at 0.8 requests per second it takes roughly 10 minutes for 400 matters. Downloads from Clio's storage link do not count against the limit.

### Stopping, resuming and running again

The export saves its position after every page. Press Ctrl-C (or kill the process) and run the same command with `--resume`: it continues where it stopped with no duplicate rows. Ctrl-C exits with code 4. Files that were half downloaded are discarded and fetched again; a file never carries its final name until it is complete.

The list of matters is built once at the start and is not rebuilt when you resume. Matters created in Clio after the first run are only picked up by running again **without** `--resume`. That second kind of run is a refresh: it starts the data files over, skips every document that is already on disk with the same size and version, moves a document if its matter was renamed, and never deletes anything. Files that were deleted in Clio stay on disk and are counted as orphans in `REPORT.md`.

If the login expires during a long run, the export saves its place and exits with code 3. Run `auth` again, then repeat the same command with `--resume`.

### Using --since

A date such as `2026-03-10` is read as 00:00:00 UTC on that date minus one day, so the filter includes a little too much rather than missing records. A full ISO datetime with an offset (`2026-03-10T09:00:00+02:00`) is used as given. The filter is applied to the record types where Clio supports `updated_since`; the others are exported in full and `REPORT.md` lists them. Folders are always exported in full, because the folder tree is needed for document paths. Documents are checked for every matter, not only matters that changed. Calendar entries are fetched in yearly chunks starting at the year of the date (or 1990 without `--since`), so an entry that starts before that year is not included.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done and complete |
| 1 | Done with errors, or the report says INCOMPLETE |
| 2 | Bad usage, or `--resume` refused (different options or account, or the saved index changed) |
| 3 | Not logged in, or the login expired |
| 4 | Interrupted; resumable with `--resume` |
| 5 | Fatal error |

### Privacy and safety

- The export never writes to Clio, and the Clio login is sent only to the Clio API, never to the storage link Clio redirects document downloads to.
- Logs, progress lines, `errors.jsonl` and audit entries carry record types, ids, counts and status codes only; never names, document titles, file paths or client values. Audit entries for the export (source `export`) are written to `~/.clio-mcp/audit.log` in your home folder, never into the export folder, and dry runs write them too.
- **The export folder holds confidential legal data in plaintext. Store it on an encrypted disk.** The `checkpoint/` folder also holds client names (the matter index and the per-matter document records), so it needs the same protection.
- Memory stays flat with the size of the firm: one page at a time. The folder tree is the exception: its folder ids, parents and names are kept in memory while documents are downloaded, roughly 100 bytes per folder.
- Run `--dry-run` in a fresh folder: in a folder that already holds an export it replaces that export's `REPORT.md`.

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
| `CLIO_CLIENT_ID` | Yes (BYO app) | — | Client ID from your Clio developer application. Not used, and not required, in the listed variant. |
| `CLIO_CLIENT_SECRET` | Yes (BYO app) | — | Client Secret from your Clio developer application. Not used, and not required, in the listed variant. |
| `TOKEN_BROKER_URL` | Yes (listed variant only) | — | URL of Oktopeak's hosted token broker. Set this INSTEAD OF `CLIO_CLIENT_ID`/`CLIO_CLIENT_SECRET` when installed via the Clio App Directory. See [Listed / one-click install variant](#listed--one-click-install-variant-app-directory). |
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
| `READ_ONLY` | No | `false` | `true`, `1` or `yes` leaves the twelve write tools unregistered so Claude can read Clio but never change it. Works on both transports. See [Read-only mode](#read-only-mode) |

### Read-only mode

Set `READ_ONLY=true` and the connector never registers its twelve write tools (`create_matter`, `update_matter`, `create_custom_field`, `create_note`, `create_task`, `update_task`, `complete_task`, `create_calendar_entry`, `log_time_entry`, `create_activity`, `upload_document`, `create_folder`). They do not appear in Claude's tool list and a call to any of them is rejected by the server, so this is a server-side guarantee rather than a client-side prompt. The read tools, the auth tools and the audit export keep working. Without it, the only thing standing between Claude and a write is the approval prompt your MCP client shows, which belongs to the client, not to this connector.

For Claude Desktop, add it next to the other variables:

```json
"env": {
  "CLIO_CLIENT_ID": "...",
  "CLIO_CLIENT_SECRET": "...",
  "TRANSPORT": "stdio",
  "READ_ONLY": "true"
}
```

Every tool also carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients that honour them can show which calls change data before you approve them.

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
| `machine_ip` | LAN IPv4 address of the host that logged the call. stdio mode only; inside a container the address means nothing, so it is left out |
| `user_id` | Caller identity when a hosting service runs the connector for several people. Absent in stdio and single-key HTTP mode |
| `request_id` | The host's request id, for matching an entry to its request log. Absent unless a host sets it |
| `tool` | Which tool Claude invoked |
| `args` | The arguments Claude passed, filtered by an allowlist (see below). Keys that were passed but are not on the list appear as `"[redacted]"` so the record still shows what was sent without containing it |
| `outcome` | `success`, `error`, or `not_found` |
| `error_message` | Present only when `outcome` is `error` |
| `clio_user_id` | The Clio user whose credentials were active |
| `matter_id` | Present for matter-specific queries |
| `result_count` | Present for list / export tools: number of records returned |

### Export entries

The `export` command writes its own entries to the same file, with the source `export` in the `tool` field: one per record type per phase (`count` for a dry run, `fetch`, `download`). They carry only the record type, the phase and counts, and are written to `~/.clio-mcp/audit.log` in your home folder, never into the export folder. Dry runs write entries too, marked `"dry_run":true`.

```json
{"timestamp":"2026-10-19T12:00:00.000Z","session_id":"3f2e9b1c-...","tool":"export","args":{"type":"documents","phase":"download","pages":0,"files":120,"bytes":48211904,"since":"2026-03-09T00:00:00.000Z","dry_run":false},"outcome":"success","clio_user_id":"10023","result_count":120}
```

The allowed keys are `type`, `phase`, `pages`, `files`, `bytes`, `since` and `dry_run`. No matter ids, names, document titles or paths are ever recorded, and a test enforces it.

### What is never written to the log

Arguments are logged by allowlist, not by denylist. For every tool only ids, limits, dates, page tokens, enums and booleans are recorded verbatim; any other argument that was passed is replaced by `"[redacted]"`. Concretely, the log never contains: contact search queries (`search_contacts.query`), document searches (`list_documents.query`), note subjects or bodies, task names or descriptions, calendar summaries, descriptions or locations, matter descriptions or client references, time-entry or activity notes, file paths or file names, or the `list_users` name filter. The full table is `AUDIT_ARG_ALLOWLIST` in `src/utils/auditLog.ts`, and a test fails if a free-text key is ever added to it. Secret-named keys (`access_token`, `client_secret`, `password`, `token`) are masked everywhere, including inside nested objects.

The log file is append-only and never rotated or truncated by this software. To archive old entries, use your operating system's log rotation tools (`logrotate` on Linux/Mac). Hosts that embed the connector as a library can replace the file with their own store through `configureAudit({ sink })`; the record format is the same.

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

**`list_custom_fields` returns 403 "User is forbidden from taking that action"**
Some setups refuse custom field reads even when the connecting user is the account owner and the token works for everything else. When it happens, `/custom_fields.json` returns 403 and the custom field values expanded on matters and contacts come back with an id but no name, type or value, with no error at all. We reproduced this on an EU account in October 2026 and fixed it by connecting through a Clio developer app that has the right permissions: with the new app `/custom_fields.json` returned 200 with the field definitions and the values on matters were readable. The same app had also been refused on communications, allocations and bank transactions, which started answering after the change. So the first thing to check is the permissions of the Clio developer app in the Clio developer portal (the app whose client ID you use), then reconnect (`logout`, then `authenticate`). If that is fine, check the connecting Clio user's custom field access with a Clio administrator. If neither explains it, please [open an issue](https://github.com/oktopeak/clio-mcp/issues) with your Clio region and the exact response.

**Custom fields come back with an `id` but `name`, `type` and `value` are `null`**
Same cause, no error this time: Clio drops the expanded attributes silently when the app is not allowed to read custom fields. The response carries a `custom_fields_warning` when this happens. Treat those fields as unread rather than empty; they are not blank in Clio. The `export` command reports the same condition as INCOMPLETE in `REPORT.md`.

**A custom field disappears entirely instead of showing empty**
This is expected, not a bug: `clear: true` (on `update_matter`'s `custom_field_values`) deletes the value record itself, not just its value. A field that was simply never set still gets an empty placeholder from Clio (and from this connector) with a real id and `value: null`; a field that was explicitly cleared has no record at all until a new value is set, so both this connector's output and Clio's own UI show nothing for it. If you want a field to keep showing as blank, set an empty-equivalent value instead of clearing it.

**A picklist shows `display_value: null` and `label_unresolved: true`**
The connector could not put a name to the selected option, so it shows nothing rather than the internal option id. It first uses the label Clio sends with the value, then falls back to one read of your field definitions. Both failing usually means the same permission problem as above.

**A response carries a `fields_warning`**
Clio rejected part of the field selection, so the request was retried without the optional expansions. The response is real but incomplete, and the missing fields are not necessarily empty in Clio. Please report it with the quoted message.

---

## Need more than the connector?

The open-source connector handles about 20% of what most firms eventually want from Claude + Clio. It reads your data. It does not build workflows around that data.

We help two ways, depending on your scope:

→ **Whole firm? The Firm Plan: $300 a month.** Set up in your own cloud, every attorney signs in with their own login, one audit log, one automation built for you each month, no setup fee, cancel any time. → [oktopeak.com/firm-plan/](https://oktopeak.com/firm-plan/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-firmplan)

→ **Legal AI Integration**: For multi-workflow builds, document automation, intake automation, custom AI agents, and full compliance architecture across your stack.
  → [oktopeak.com/services/legal-ai-integration/](https://oktopeak.com/services/legal-ai-integration/?utm_source=github&utm_medium=readme&utm_campaign=clio-mcp&utm_content=footer-svc-legal-ai)


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

## Using the connector as a library

Everything the two transports use is exported from `@oktopeak/clio-mcp/lib`, so a service can run the same 37 tools inside its own server: its own login, its own token store, its own audit store. The public npm package and the local install are unchanged; this is the seam a hosting service builds on.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAllTools, runWithSessionContext, configureAudit,
  buildClioAuthorizeUrl, exchangeClioCode, refreshClioTokens, fetchClioWhoAmI,
} from "@oktopeak/clio-mcp/lib";

// Once at startup: send audit entries to your store instead of ~/.clio-mcp/audit.log.
configureAudit({ sink: myAuditSink });

// Per request: register the tools you want to expose, then run the MCP request
// inside a session context that knows who the caller is and how to get a Clio token.
const server = new McpServer({ name: "my-host", version: "1.0.0" });
registerAllTools(server, { readOnly: false, auth: "none", exclude: ["upload_document"], complianceNotice: "..." });
await runWithSessionContext(
  {
    sessionId: requestId,
    userId, clioUserId, requestId,
    getAccessToken: () => tokenStore.validAccessToken(userId),   // refresh with refreshClioTokens() as needed
    getTokens: () => tokenStore.get(userId),
    storeTokens: (t) => tokenStore.set(userId, t),
    clearTokens: () => tokenStore.clear(userId),
  },
  () => transport.handleRequest(req, res, req.body)
);
```

The Clio OAuth functions take explicit credentials and a region (`buildClioAuthorizeUrl`, `exchangeClioCode`, `refreshClioTokens`, `fetchClioWhoAmI`, plus `generateCodeVerifier` / `deriveCodeChallenge` for PKCE); nothing in the library reads `CLIO_CLIENT_ID` from the environment. Outside stdio mode the tools refuse to run without a session context, so a host can never fall back to a shared token file by accident. Types ship with the package (`build/lib.d.ts`); the exported surface is pinned by `src/__tests__/lib.test.ts`.

## Contributing

Issues and pull requests welcome. If you run into a Clio API edge case this connector does not handle cleanly, open an issue with the scenario and an example request. If you add a tool, register its name in `src/tools/index.ts` (`TOOL_META`, and `WRITE_TOOLS` if it changes Clio data) so the read-only gate and the annotations cover it; `registry.test.ts` fails otherwise.

---

## License

MIT © [Oktopeak](https://oktopeak.com)

See [LICENSE](./LICENSE) for the full text.
