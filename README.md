# Clio MCP Connector

Connect Claude directly to your Clio account. Ask questions, retrieve matters, and get answers — without leaving your AI assistant and without copying data into chat windows.

Built for law firms that need AI to work inside their existing practice management stack, not around it.

---

## What you can do

Once connected, you can ask Claude things like:

- *"Show me all open matters for Acme Corp"*
- *"What's the status of matter 2024-0042?"*
- *"List my pending matters from the last quarter"*

The connector retrieves live data from Clio on every request. Nothing is cached or stored by the AI.

---

## Compliance & Security

This section exists because law firms evaluating AI tools have asked the right questions. Here are direct answers.

### ABA Formal Opinion 512 — AI and competence

ABA Opinion 512 (2023) requires attorneys using AI tools to understand how those tools work, supervise their outputs, and maintain confidentiality of client information. This connector is designed with those obligations in mind:

- **Audit log.** Every tool call — every time Claude queries Clio on your behalf — is appended to a local log file at `~/.clio-mcp/audit.log`. Each entry records the timestamp, which tool was invoked, what arguments were passed, whether it succeeded, and the Clio user ID. The log is stored on your machine, not in any cloud service. It is append-only and never purged by the software, so your firm retains a complete record of AI-initiated data access.

- **No data retention by the connector.** The connector does not store matter data, client names, or any Clio content. It fetches from the API and passes results to Claude. The only thing persisted locally is your authentication token, and that is encrypted (see below).

- **Scope limited to read.** The current release only reads data from Clio. It cannot create, edit, or delete matters, contacts, or billing entries. Your Clio data cannot be modified through this connector.

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

## Setup — five minutes

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

In your terminal, run this one-time command to generate a secure encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. It will look like a long string of random letters and numbers. Keep it safe — if you lose it, you will need to re-authenticate.

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
      "args": ["/FULL/PATH/TO/clio-mcp/build/index.js"],
      "env": {
        "CLIO_CLIENT_ID": "paste-your-client-id-here",
        "CLIO_CLIENT_SECRET":"paste-your-client-secret-here",
        "CLIO_REDIRECT_PORT": 5678,
        "CLIO_AUTH_URL": "https://eu.app.clio.com/oauth/authorize",
        "CLIO_TOKEN_URL": "https://eu.app.clio.com/oauth/token",
        "CLIO_API_BASE": "https://eu.app.clio.com/api/v4",
        "ENCRYPTION_KEY": "paste-your-64-char-key-here"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/clio-mcp` with the path you noted in Step 1 (e.g., `/Users/yourname/clio-mcp`).

If the file already has other MCP servers configured, add a comma after the last entry and then add the `"clio"` block.

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

| Tool | What it does |
|---|---|
| `authenticate` | Opens your browser to Clio's login page and stores your credentials securely |
| `auth_status` | Shows whether you are currently authenticated and when your session expires |
| `logout` | Clears your stored credentials from this machine |
| `list_matters` | Returns matters from your Clio account, with optional filters for status and count |
| `get_matter` | Returns full detail for a specific matter by its Clio ID |

Claude selects and calls these tools automatically based on your questions. You do not need to invoke them by name.

---

## Configuration reference

All settings are passed as environment variables in your Claude Desktop config (see Step 4). Only the first three are required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLIO_CLIENT_ID` | Yes | — | Client ID from your Clio developer application |
| `CLIO_CLIENT_SECRET` | Yes | — | Client Secret from your Clio developer application |
| `ENCRYPTION_KEY` | Yes | — | 64-character hex key for encrypting stored tokens |
| `CLIO_REDIRECT_PORT` | No | `5678` | Local port for the OAuth callback. Change if 5678 is in use on your machine |
| `CLIO_API_BASE` | No | `https://app.clio.com/api/v4` | Override to use Clio Platform (`https://eu.app.clio.com/api/v4`) |
| `CLIO_AUTH_URL` | No | `https://app.clio.com/oauth/authorize` | OAuth authorization endpoint |
| `CLIO_TOKEN_URL` | No | `https://app.clio.com/oauth/token` | OAuth token endpoint |
| `CLIO_SCOPE` | No | `openid` | OAuth scopes to request |

**Clio Platform (EU/Canada) users:** Set `CLIO_API_BASE`, `CLIO_AUTH_URL`, and `CLIO_TOKEN_URL` to your regional endpoints. Contact Clio support for the correct URLs for your region.

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

## License

ISC © [Oktopeak](https://github.com/oktopeak)
