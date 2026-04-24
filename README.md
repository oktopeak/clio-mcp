# Clio MCP Server: Connect Claude to Clio Practice Management

Open-source Model Context Protocol (MCP) connector that lets Claude read live data from [Clio](https://www.clio.com) — matters, contacts, documents, tasks, calendar, and billing — without copying client information into chat windows. Built for law firms that care about attorney-client privilege, ABA Opinion 512 compliance, and keeping AI workflows inside their existing practice management stack.

> **TL;DR** — 15 Clio tools exposed to Claude. Audit-logged for ABA Opinion 512. OAuth tokens encrypted at rest with AES-256-GCM. Local-only — no relay server, no cloud middleman. MIT license, free forever.

**Who this is for:** Law firm IT, legal operations teams, tech-forward partners, and engineers at legal tech companies. If you can follow a six-step terminal install, you can use this.

**Who this is NOT for (yet):** Attorneys who've never opened a terminal. A simpler one-command installer is planned for v0.2. In the meantime, ask your IT person to run the setup below — or have our team deploy it for you ([oktopeak.com/services/legal-ai-integration/](https://oktopeak.com/services/legal-ai-integration/)).

---

## What you can do

Once connected, you can ask Claude things like:

**Matters**
- *"Show me all open matters for Acme Corp"*
- *"What's the status of matter 2024-0042?"*
- *"List my pending matters from the last quarter"*

**Contacts**
- *"Find the contact details for Jane Smith"*
- *"What's the email address and phone number for client ID 8821?"*

**Documents**
- *"List all documents on matter 4821"*
- *"Get the download link for document 9934"*

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

**Time entries**
- *"How many hours have been logged on matter 4821 this month?"*
- *"Show me all time entries between April 1 and April 30"*

**Billing**
- *"What's the outstanding balance on matter 4821?"*
- *"When was the last invoice issued for this matter?"*

The connector retrieves live data from Clio on every request. Nothing is cached or stored by the AI.

---

## Compliance & Security

This section exists because law firms evaluating AI tools have asked the right questions. Here are direct answers.

### ABA Formal Opinion 512 — AI and competence

ABA Opinion 512 (2023) requires attorneys using AI tools to understand how those tools work, supervise their outputs, and maintain confidentiality of client information. This connector is designed with those obligations in mind:

- **Audit log.** Every tool call — every time Claude queries Clio on your behalf — is appended to a local log file at `~/.clio-mcp/audit.log`. Each entry records the timestamp, which tool was invoked, what arguments were passed, whether it succeeded, and the Clio user ID. The log is stored on your machine, not in any cloud service. It is append-only and never purged by the software, so your firm retains a complete record of AI-initiated data access.

- **No data retention by the connector.** The connector does not store matter data, client names, or any Clio content. It fetches from the API and passes results to Claude. The only thing persisted locally is your authentication token, and that is encrypted (see below).

- **Scope limited to tasks and notes.** The connector can create tasks and notes on matters. It cannot create, edit, or delete matters, contacts, documents, calendar entries, or billing records. This is a deliberate v1 design choice — write access is limited to the two operations most useful for AI-assisted legal work while minimising liability.

### Token security — encryption at rest

Your OAuth credentials are never stored in plain text. After you authenticate, the connector encrypts your access token and refresh token using **AES-256-GCM** — the same standard used by financial institutions — and writes the ciphertext to `~/.clio-mcp/tokens.enc`. The encryption key is a secret you generate yourself (instructions below) and is never transmitted anywhere.

If someone obtained the token file without the key, they would not be able to read it.

### OAuth 2.0 — no passwords stored

Authentication uses Clio's standard OAuth 2.0 flow. You log in through your browser on Clio's own login page. The connector never sees or handles your Clio password. CSRF protection is implemented via a cryptographic state parameter on every auth request.

### Local-first architecture

The connector runs entirely on your machine. There is no Clio MCP cloud service, no relay server, no third party in the middle. Your Clio API traffic goes directly from your device to Clio's servers.

---

## Requirements

Before you begin, make sure you have:

- **Node.js 18 or later** — [nodejs.org/en/download](https://nodejs.org/en/download)
- **Claude Desktop** — [claude.ai/download](https://claude.ai/download)
- **A Clio account** with permission to create developer applications (ask your Clio administrator if you are unsure)

---

## Setup

Takes about five minutes if Node.js and Claude Desktop are already installed. Add another five to ten minutes if you need to install them first.

### Step 1 — Clone and build

Open a terminal and run:

```bash
git clone https://github.com/oktopeak/clio-mcp.git
cd clio-mcp
npm install
npm run build
```

Note the full path to the folder you just cloned — you will need it in Step 4.

```bash
# On Mac/Linux, print the full path:
pwd

# Example output: /Users/yourname/clio-mcp
```

### Step 2 — Create a Clio API application

1. Log in to Clio and go to **Settings → Developer Applications**
2. Click **Add Application**
3. Give it a name (e.g., *Claude Connector*)
4. Set the redirect URI to exactly: `http://127.0.0.1:5678/callback`
5. Save the application
6. Copy the **Client ID** and **Client Secret** — you will need them in the next step

### Step 3 — Generate your encryption key

This is a one-time password the connector uses to encrypt your Clio tokens on disk. You generate it on your own machine. It never leaves your laptop, and no one else ever sees it. If you lose it, you re-authenticate — nothing dangerous happens.

In your terminal, run:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. It will be a 64-character string of random letters and numbers. Paste it into a password manager or a safe note — you will use it in Step 4 and you will need it if you ever reconfigure the connector.

### Step 4 — Configure Claude Desktop

Open your Claude Desktop configuration file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following block inside the `"mcpServers"` section, replacing the placeholder values with your own:

```json
{
  "mcpServers": {
    "clio": {
      "command": "node",
      "args": ["/FULL/PATH/TO/clio-mcp/build/index.js"]
    }
  }
}
```

Replace `/FULL/PATH/TO/clio-mcp` with the path you noted in Step 1 (e.g., `/Users/yourname/clio-mcp`).

If the file already has other MCP servers configured, add a comma after the last entry and then add the `"clio"` block.

**Using Clio EU, Canada, or Australia?** Change `CLIO_API_BASE`, `CLIO_AUTH_URL`, and `CLIO_TOKEN_URL` to your regional Clio endpoints (for example, `https://eu.app.clio.com/...`). Contact Clio support if you are unsure which region your firm is on.

### Step 5 — Restart Claude Desktop

Quit Claude Desktop completely and reopen it.

### Step 6 — Authenticate with Clio

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

## Available tools

Claude selects and calls these tools automatically based on your questions. You do not need to invoke them by name.

### Auth (3 tools)

| Tool | What it does |
|---|---|
| `authenticate` | Opens your browser to Clio's login page and stores your credentials securely |
| `auth_status` | Shows whether you are currently authenticated and when your session expires |
| `logout` | Clears your stored credentials from this machine |

### Matters (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_matters` | `status` (Open/Pending/Closed), `limit` | Lists matters with optional status filter |
| `get_matter` | `matter_id` | Returns full detail for a specific matter |

### Contacts (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `search_contacts` | `query`, `limit` | Searches contacts by name, email, or company |
| `get_contact` | `contact_id` | Returns full detail for a specific contact including all emails, phone numbers, and addresses |

### Documents (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_documents` | `matter_id` or `folder_id`, `limit` | Lists documents in a matter or folder |
| `get_document` | `document_id` | Returns document metadata and a direct download URL |

### Tasks (2 tools)

| Tool | Inputs | What it does |
|---|---|---|
| `list_tasks` | `matter_id`, `status` (Pending/Complete), `due_date_start`, `due_date_end`, `limit` | Lists tasks with optional filters |
| `create_task` | `matter_id`, `name`, `priority` (High/Normal/Low), `due_date`, `assignee_id` | Creates a task on a matter; priority defaults to Normal |

### Calendar (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `list_calendar_entries` | `start_date`, `end_date` | Lists calendar entries within a date range |

### Time entries (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `list_time_entries` | `matter_id`, `start_date`, `end_date`, `limit` | Lists billable time entries with optional filters |

### Billing (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `get_billing_summary` | `matter_id` | Returns total billed, outstanding balance, and last invoice date for a matter |

### Notes (1 tool)

| Tool | Inputs | What it does |
|---|---|---|
| `create_note` | `matter_id`, `subject`, `body` | Creates a note on a matter; appears in Clio's matter timeline |

---

## Resources

The connector also exposes two MCP resources — read-only content that compatible clients (including Claude Desktop) can surface automatically at the start of a session.

| Resource URI | What it contains |
|---|---|
| `clio://compliance/notice` | One-paragraph compliance reminder covering ABA Opinion 512, audit logging, and the attorney-review requirement for AI-generated content |
| `clio://auth/status` | Live authentication state — whether you are connected, your Clio user ID, and minutes until token expiry |

---

## Configuration reference

All settings are passed as environment variables in your Claude Desktop config (see Step 4). Only the first three are required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLIO_CLIENT_ID` | Yes | — | Client ID from your Clio developer application |
| `CLIO_CLIENT_SECRET` | Yes | — | Client Secret from your Clio developer application |
| `ENCRYPTION_KEY` | Yes | — | 64-character hex key for encrypting stored tokens |
| `CLIO_REDIRECT_PORT` | No | `5678` | Local port for the OAuth callback. Change if 5678 is in use on your machine |
| `CLIO_API_BASE` | No | `https://app.clio.com/api/v4` | Override for Clio EU, Canada, or Australia (e.g., `https://eu.app.clio.com/api/v4`) |
| `CLIO_AUTH_URL` | No | `https://app.clio.com/oauth/authorize` | OAuth authorization endpoint |
| `CLIO_TOKEN_URL` | No | `https://app.clio.com/oauth/token` | OAuth token endpoint |

---

## Audit log reference

Every tool call is recorded at `~/.clio-mcp/audit.log` in [JSONL](https://jsonlines.org) format (one JSON object per line). Example entry:

```json
{"timestamp":"2026-04-23T14:05:00.123Z","tool":"get_matter","args":{"matter_id":4821},"outcome":"success","clio_user_id":"10023","matter_id":4821}
```

Each entry contains:

| Field | Description |
|---|---|
| `timestamp` | ISO 8601 date and time of the call |
| `tool` | Which tool Claude invoked |
| `args` | Arguments passed to the tool (secrets are automatically redacted) |
| `outcome` | `success` or `error` |
| `error_message` | Present only when `outcome` is `error` |
| `clio_user_id` | The Clio user whose credentials were active |
| `matter_id` | Present for matter-specific queries |
| `result_count` | Present for list tools — number of records returned |

The log file is append-only and never rotated or truncated by this software. To archive old entries, use your operating system's log rotation tools (`logrotate` on Linux/Mac).

---

## Troubleshooting

**Claude says the Clio tool is not available**
Restart Claude Desktop fully (quit, do not just close the window). If the problem persists, check that the path in your config file is correct and that `build/index.js` exists in that folder.

**Authentication opens a browser but then nothing happens**
Make sure the redirect URI in your Clio developer application is set to exactly `http://127.0.0.1:5678/callback`. No trailing slash, no `localhost` — it must be `127.0.0.1`.

**"ENCRYPTION_KEY must be 64 hex chars" error**
Regenerate the key using the command in Step 3. Paste the full output — it should be exactly 64 characters.

**"Token file exists but decryption failed" warning**
This appears if the encryption key in your config no longer matches the key that was used to encrypt the token file. Run the `logout` tool in Claude and then `authenticate` again. If you changed your `ENCRYPTION_KEY`, update it back to the original value, or log out first before changing it.

**Port 5678 is already in use**
Add `"CLIO_REDIRECT_PORT": "5679"` to the `env` block in your Claude Desktop config, and update your Clio application's redirect URI to `http://127.0.0.1:5679/callback`.

---

## Need more than the connector?

The open-source connector handles about 20% of what most firms eventually want from Claude + Clio. It reads your data. It does not build workflows around that data.

Our **Legal AI Integration service** picks up where the connector stops:

- **Document automation templates** — retainer agreements, pleadings, engagement letters, clause libraries drafted by Claude from live matter context, reviewed by an attorney before anything goes out
- **Intake workflows** — new leads routed into qualified matters, pre-populated with client data, flagged by practice area
- **Custom AI agents** — deadline reminders, billing review, matter summaries, contract negotiation assistants scoped to your firm's way of working
- **Full compliance architecture** — audit logging that spans your DMS, e-signature tool, calendar, and billing system, not just Clio

Fixed price, four to six weeks, ABA Opinion 512 compliant from day one.

→ [oktopeak.com/services/legal-ai-integration/](https://oktopeak.com/services/legal-ai-integration/)

---

## Contributing

Issues and pull requests welcome. If you run into a Clio API edge case this connector does not handle cleanly, open an issue with the scenario and an example request. If you want to add a tool that falls within the "read-only" v1 scope, send a PR.

---

## License

MIT © [Oktopeak](https://oktopeak.com)

See [LICENSE](./LICENSE) for the full text.
