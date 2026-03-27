# mugi-claw(むぎ苦労）

A Slack-resident AI assistant powered by [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Delegates tasks via `@mention`, streams real-time progress to threads, and operates browser UIs through Playwright + Chrome DevTools Protocol — accessing Gmail, Google Drive, Google Photos, and more without API keys.

## Key Features

| Feature | Description |
|---------|-------------|
| **Slack-native interface** | Interact via `@mention` in any channel or thread. Real-time progress updates with tool-specific emoji indicators. |
| **Browser automation** | Playwright + CDP-based control of a persistent Chrome session. Operates Google services (Gmail, Drive, Photos) through their web UIs — no OAuth/API keys required. |
| **Desktop automation** | macOS desktop control via screenshots and coordinate-based interactions (click, type, hotkey, scroll). |
| **Personalization** | Per-user profiles and memory. Learns preferences, facts, and habits from conversations to personalize responses. |
| **Scheduled tasks** | Cron-based recurring tasks with node-cron. Auto-executes Claude CLI and notifies results via DM or channel. |
| **Secure credential input** | `browser_secure_input` lets users enter passwords/OTPs through a local Web UI — credentials never touch the LLM context. |
| **Seatbelt sandbox** | macOS Seatbelt restricts filesystem and network access at the OS level. Unlike Docker, maintains direct access to the host Chrome CDP session. |
| **Network whitelist proxy** | All outbound traffic routed through an HTTP CONNECT proxy with domain-level whitelist control and Slack-based approval flow. |
| **Tool approval system** | Dangerous tool invocations require explicit owner approval via Slack interactive buttons. |
| **Hook-based guard scripts** | PreToolUse hooks block `.env` access, out-of-project file deletion, and dangerous shell commands. |
| **Observability** | Full session tracing via Langfuse, Slack webhook notifications, and Obsidian session export. |
| **Model switching** | Switch between `opus` / `sonnet` / `haiku` globally from Slack. |
| **Slash commands** | `/mugiclaw` for managing profiles, schedules, memories, and model settings. |
| **Multi-user support** | SQLite-backed profiles, memories, and settings per Slack user. |
| **Session continuity** | Thread-based Claude session mapping with `--resume` support across messages. |
| **Concurrency control** | Configurable max concurrent Claude CLI processes (default: 3) with automatic queuing. |
| **Docker support** | Docker Compose setup with a separate Chrome container for headless browser operations. |
| **launchd integration** | macOS persistent service with auto-start on login and crash recovery. |
| **File attachments** | Slack file uploads are downloaded and passed to Claude as local file paths. |

## Architecture

```mermaid
graph TB
    subgraph Slack["Slack Workspace"]
        User["User @mention / /mugiclaw"]
        SlackAPI["Slack API (Socket Mode)"]
        Buttons["Interactive Buttons<br/>(Approve/Deny)"]
    end

    subgraph MugiClaw["mugi-claw (Node.js)"]
        App["Slack Bolt App"]

        subgraph Handlers["Request Handlers"]
            MH["Mention Handler"]
            CH["Command Handler"]
            PO["Profile Onboarding"]
        end

        subgraph Claude["Claude CLI Engine"]
            CR["Claude Runner<br/>(spawn + queue)"]
            SP["Stream Parser<br/>(NDJSON)"]
            PB["Prompt Builder"]
            RP["Result Parser<br/>(structured output)"]
            SM["Session Manager"]
        end

        subgraph Data["Data Layer (SQLite)"]
            PS["Profile Store"]
            TS["Task Store"]
            SS["Settings Store"]
            WS["Whitelist Store"]
        end

        subgraph Security["Security Layer"]
            AM["Approval Manager"]
            AS["Approval Server<br/>(:3456)"]
            CM["Credential Manager"]
            CS["Credential Server<br/>(:3457)"]
            PS2["Proxy Server<br/>(:18080)"]
        end

        subgraph Scheduling["Scheduler"]
            SCH["Scheduler (node-cron)"]
            TR["Task Runner"]
            NOT["Notifier"]
        end

        TM["Thread Manager<br/>(real-time updates)"]
    end

    subgraph MCP["MCP Servers (child processes)"]
        BrowserMCP["Browser MCP<br/>(Playwright + CDP)"]
        DesktopMCP["Desktop MCP<br/>(node-screenshots + cliclick)"]
    end

    subgraph External["External Services"]
        Chrome["Chrome<br/>(CDP :9222)"]
        WebServices["Gmail / Drive / Photos<br/>/ Web"]
        Langfuse["Langfuse<br/>(tracing)"]
        Obsidian["Obsidian Vault<br/>(session export)"]
    end

    subgraph Sandbox["Seatbelt Sandbox (optional)"]
        SB["sandbox-exec -f mugi-claw.sb"]
    end

    User --> SlackAPI
    SlackAPI --> App
    App --> MH & CH & PO
    MH --> PB --> CR
    CR -->|"spawn claude CLI"| SB
    SB -->|"NDJSON stream"| SP
    SP --> TM --> SlackAPI
    SP --> RP --> PS & TS
    CR --> SM
    MH --> PS & TS & SS
    CH --> PS & TS & SS & SCH

    SCH -->|"cron trigger"| TR
    TR --> CR
    TR --> NOT --> SlackAPI

    CR -.->|"--mcp-config"| BrowserMCP & DesktopMCP
    BrowserMCP --> Chrome --> WebServices
    DesktopMCP -->|"screenshots + clicks"| Chrome

    BrowserMCP -->|"secure_input"| AS
    AS --> CM
    CM -->|"Slack notification"| SlackAPI
    CS -->|"Web UI form"| CM

    PS2 -->|"CONNECT tunnel"| WebServices
    PS2 --> WS
    PS2 -->|"approval request"| SlackAPI
    Buttons --> AM & PS2

    CR -.->|"hooks"| Langfuse & Obsidian

    style Security fill:#ffe0e0
    style Sandbox fill:#fff3cd
    style MCP fill:#e0f0ff
```

## Sequence Diagrams

### 1. Mention → Claude CLI Execution

```mermaid
sequenceDiagram
    actor User
    participant Slack
    participant App as mugi-claw
    participant DB as SQLite
    participant CLI as Claude Code CLI
    participant MCP as Browser MCP
    participant Chrome

    User->>Slack: @mugibow do something
    Slack->>App: app_mention event (Socket Mode)

    App->>DB: Check user profile
    alt First-time user
        App->>Slack: Send onboarding DM (Block Kit)
    end

    App->>Slack: Post "🐕 Thinking..."
    App->>Slack: Fetch thread history (conversations.replies)

    App->>DB: Load profile, memories, scheduled tasks
    App->>App: Build prompt (SOUL + IDENTITY + AGENTS + INSTRUCTIONS + context)

    App->>CLI: spawn claude --output-format stream-json
    Note over CLI: Runs inside Seatbelt sandbox (if enabled)

    loop NDJSON Stream Events
        CLI-->>App: system_init (session_id, tools)
        App->>App: Save session mapping (thread → session)

        CLI-->>App: tool_use (e.g., browser_navigate)
        App->>Slack: Update status "🌐 browser_navigate..."

        CLI->>MCP: Call browser_navigate via MCP
        MCP->>Chrome: Playwright CDP command
        Chrome-->>MCP: Page loaded
        MCP-->>CLI: Tool result

        CLI-->>App: text (partial response)
        CLI-->>App: tool_use (next tool...)
        App->>Slack: Update status with tool emoji
    end

    CLI-->>App: result (final text, cost, duration)

    App->>App: Parse structured output blocks
    App->>DB: Save memories / Update profile / Manage schedules
    App->>Slack: Post final result (split if >4000 chars)
    App->>Slack: Upload any written files
```

### 2. Secure Credential Input (browser_secure_input)

```mermaid
sequenceDiagram
    actor Owner
    participant Slack
    participant CLI as Claude Code CLI
    participant MCP as Browser MCP
    participant AS as Approval Server<br/>(:3456)
    participant CM as Credential Manager
    participant CS as Credential Server<br/>(:3457)
    participant Chrome

    Note over CLI: Session expires, login page detected

    CLI->>MCP: browser_screenshot()
    MCP->>Chrome: Take screenshot
    MCP->>AS: POST /api/upload-screenshot
    AS->>Slack: Upload screenshot to thread

    CLI->>MCP: browser_get_text()
    MCP->>Chrome: Get form structure
    MCP-->>CLI: Form selectors identified

    CLI->>MCP: browser_secure_input({site, fields})
    MCP->>AS: POST /api/credential-request (blocking)
    AS->>CM: requestCredential(site, fields)

    CM->>Slack: Post "🔐 Credential input required"<br/>with link to Web UI form
    CM->>CM: Start 5-min timeout

    Owner->>CS: Open Web UI form (http://local-ip:3457/credential/{id})
    CS-->>Owner: Render HTML form (password fields masked)
    Owner->>CS: Submit credentials
    CS->>CM: resolve(requestId, values)

    CM-->>AS: Return {success: true, values: {...}}
    AS-->>MCP: HTTP response with values

    MCP->>MCP: Extract values, detach from result object
    MCP->>Chrome: page.fill(selector, value) for each field
    MCP->>MCP: values = null (immediate GC)

    MCP-->>CLI: "Secure input completed: N field(s) filled"
    Note over CLI: LLM only sees success message,<br/>never the actual credentials

    CLI->>MCP: browser_click("login button")
    MCP->>Chrome: Click submit
```

### 3. Network Whitelist Approval Flow

```mermaid
sequenceDiagram
    actor Owner
    participant Slack
    participant CLI as Claude Code CLI
    participant Proxy as Proxy Server<br/>(:18080)
    participant WS as Whitelist Store
    participant NA as Network Approval

    CLI->>Proxy: HTTPS CONNECT api.example.com:443
    Proxy->>WS: isAllowed("api.example.com", 443)?
    WS-->>Proxy: false (not whitelisted)

    Proxy->>NA: requestNetworkApproval(hostname, port)
    NA->>Slack: Post approval request with 3 buttons

    Note over Slack: ┌─────────────────────────┐<br/>│ Network Access Request  │<br/>│ Host: api.example.com   │<br/>│ Port: 443               │<br/>│                         │<br/>│ [Allow Once] [Allow     │<br/>│ Permanent] [Deny]       │<br/>└─────────────────────────┘

    alt Owner clicks "Allow Permanent"
        Owner->>Slack: Click button
        Slack->>NA: action: allow_permanent
        NA->>WS: addPermanent("api.example.com")
        WS->>DB: INSERT INTO network_whitelist
        NA-->>Proxy: {approved: true, permanent: true}
        Proxy->>CLI: HTTP 200 Connection Established
        Proxy->>Proxy: Create TCP tunnel
    else Owner clicks "Allow Once"
        Owner->>Slack: Click button
        NA->>WS: addTemporary("api.example.com")
        Note over WS: In-memory only,<br/>cleared on restart
        NA-->>Proxy: {approved: true, permanent: false}
        Proxy->>CLI: HTTP 200 Connection Established
    else Owner clicks "Deny" or 10-min timeout
        NA-->>Proxy: {approved: false}
        Proxy->>CLI: HTTP 403 Forbidden
    end
```

### 4. Tool Approval Flow (PreToolUse Hook)

```mermaid
sequenceDiagram
    actor Owner
    participant Slack
    participant CLI as Claude Code CLI
    participant Hook as tool-approval.sh
    participant AS as Approval Server<br/>(:3456)
    participant AM as Approval Manager

    CLI->>Hook: PreToolUse event (tool_name, tool_input)

    Hook->>Hook: Check auto-approve rules

    alt Read-only tool (Read, Glob, Grep, screenshot, etc.)
        Hook-->>CLI: exit 0 (auto-approved)
    else Dangerous Bash command (rm, git push, sudo, etc.)
        Hook->>AS: POST /api/approval {tool, input}
        AS->>AM: requestApproval(toolName, toolInput)
        AM->>Slack: Post approval request<br/>[Approve] [Deny]
        AM->>AM: Start 10-min timeout

        alt Owner approves
            Owner->>Slack: Click "Approve"
            Slack->>AM: resolve(requestId, true)
            AM-->>AS: approved: true
            AS-->>Hook: {"approved": true}
            Hook-->>CLI: exit 0 (approved)
        else Owner denies or timeout
            AM-->>AS: approved: false
            AS-->>Hook: {"approved": false}
            Hook-->>CLI: exit 2 (denied)
        end
    else Write/Edit tool
        Hook->>AS: POST /api/approval (always requires approval)
        Note over AS: Same approval flow as above
    end
```

### 5. Scheduled Task Execution

```mermaid
sequenceDiagram
    participant Cron as node-cron
    participant SCH as Scheduler
    participant TR as Task Runner
    participant DB as SQLite
    participant CLI as Claude Code CLI
    participant NOT as Notifier
    participant Slack

    Cron->>SCH: Cron expression matches
    SCH->>TR: run(task)

    TR->>DB: Create TaskRun record
    TR->>DB: Load owner profile & memories
    TR->>TR: Build prompt (persona + task prompt)
    TR->>DB: Get current model setting

    TR->>CLI: spawn claude CLI
    CLI-->>TR: NDJSON stream events
    CLI-->>TR: result (text, cost, duration)

    TR->>DB: Update TaskRun (status, result, cost)

    TR->>NOT: notify(task, result)
    NOT->>Slack: Post to DM or channel<br/>(result + cost + duration)
```

### 6. Observability Pipeline (Hooks)

```mermaid
sequenceDiagram
    participant CLI as Claude Code CLI
    participant LF as langfuse-logger.sh
    participant SN as slack-notify.sh
    participant OE as obsidian-export.py
    participant Langfuse as Langfuse Cloud
    participant Slack
    participant Obsidian as Obsidian Vault

    Note over CLI: Session Start
    CLI->>LF: SessionStart {session_id, model}
    LF->>Langfuse: trace-create (session-init)
    LF->>LF: Capture git branch/commit

    Note over CLI: User Input
    CLI->>LF: UserPromptSubmit {prompt}
    LF->>Langfuse: trace-create (turn-N)

    Note over CLI: Tool Execution
    CLI->>LF: PreToolUse {tool_name, tool_input}
    LF->>Langfuse: span-create (tool:X)

    CLI->>LF: PostToolUse {tool_name, response}
    LF->>Langfuse: span-update (output + status)

    Note over CLI: Sub-agent (if spawned)
    CLI->>LF: SubagentStart {agent_type, agent_id}
    LF->>Langfuse: span-create (subagent:X)
    CLI->>LF: SubagentStop {last_message}
    LF->>Langfuse: span-update (output)

    Note over CLI: Notification
    CLI->>SN: Notification {message, title}
    SN->>Slack: Webhook POST (Block Kit)

    Note over CLI: Turn Complete
    CLI->>LF: Stop {transcript_path}
    LF->>LF: Parse transcript diff
    LF->>LF: Merge thinking-only messages
    LF->>Langfuse: generation-create (batch)<br/>with token counts + cost

    Note over CLI: Session End
    CLI->>LF: SessionEnd {reason}
    LF->>Langfuse: generation-create (session-total-usage)
    LF->>LF: Cleanup state dir

    CLI->>OE: SessionEnd {transcript_path}
    OE->>OE: Parse transcript (prompts, tools, files)
    OE->>Obsidian: Write session markdown note
```

## Security Architecture

mugi-claw implements defense-in-depth with multiple independent security layers. Each layer operates independently, so a bypass at one level is caught by another.

```mermaid
graph TB
    subgraph L1["Layer 1: OS-Level Sandbox (Seatbelt)"]
        SB1["Filesystem Isolation<br/>Write: project + ~/.mugi-claw + /tmp only<br/>Read: blocks ~/.ssh, ~/.aws, ~/.gnupg"]
        SB2["Network Isolation<br/>Outbound: localhost only<br/>External: must go through proxy"]
    end

    subgraph L2["Layer 2: Network Control (Proxy)"]
        P1["HTTP CONNECT Proxy (:18080)"]
        P2["Domain Whitelist<br/>(default + permanent + temporary)"]
        P3["Slack Approval Flow<br/>(Allow Once / Permanent / Deny)"]
        P4["Connection Limits<br/>(max 50 concurrent)"]
    end

    subgraph L3["Layer 3: Tool Approval (Hooks)"]
        H1["PreToolUse: tool-approval.sh<br/>Auto-approve: read-only tools<br/>Always approve: Write, Edit<br/>Pattern match: dangerous commands"]
        H2["PreToolUse: guard-bash.sh<br/>Block: .env access<br/>Block: out-of-project rm/unlink"]
        H3["PreToolUse: guard-file-access.sh<br/>Block: .env file Read/Write/Edit"]
    end

    subgraph L4["Layer 4: Credential Protection"]
        C1["browser_secure_input<br/>Local Web UI for password entry"]
        C2["LLM Context Isolation<br/>Credentials never in prompt/response"]
        C3["Immediate Memory Cleanup<br/>values = null after use"]
        C4["XSS Prevention<br/>escapeHtml() on all outputs"]
    end

    subgraph L5["Layer 5: Operational Security"]
        O1["Owner-only approval<br/>(OWNER_SLACK_USER_ID)"]
        O2["Timeout auto-deny<br/>Tool: 10min, Credential: 5min"]
        O3["Concurrency limits<br/>CLI: 3, Proxy: 50"]
        O4["Graceful shutdown<br/>SIGINT/SIGTERM handlers"]
    end

    subgraph L6["Layer 6: Audit & Observability"]
        A1["Langfuse Tracing<br/>All tools, tokens, costs"]
        A2["Pino Structured Logging<br/>All security events"]
        A3["Obsidian Session Export<br/>Offline audit trail"]
        A4["Slack Notifications<br/>Real-time alerts"]
    end

    L1 --> L2 --> L3 --> L4
    L5 --> L6

    style L1 fill:#fff3cd
    style L2 fill:#d4edda
    style L3 fill:#cce5ff
    style L4 fill:#f8d7da
    style L5 fill:#e2d9f3
    style L6 fill:#d1ecf1
```

### Security Feature Details

| Threat | Mitigation | Implementation |
|--------|-----------|----------------|
| **Credential leakage to LLM** | Credentials entered through local Web UI, never passed to LLM context. Values nulled immediately after browser fill. | `browser_secure_input` in `src/browser/mcp-server.ts` |
| **Unauthorized file access** | Seatbelt sandbox restricts write to project dir + temp. Guard hooks block `.env` access via Read/Write/Edit/Bash. | `sandbox/mugi-claw.sb`, `scripts/guard-*.sh` |
| **Sensitive file exposure** | `.ssh`, `.aws`, `.gnupg` blocked at sandbox level. `.env` files blocked by hook scripts. | Seatbelt `deny default` + hook `exit 2` |
| **Unrestricted network access** | All outbound traffic routed through proxy. Only whitelisted domains auto-allowed. Unknown domains require Slack approval. | `src/network/proxy-server.ts` |
| **Dangerous CLI commands** | PreToolUse hook detects `rm`, `sudo`, `git push`, `pip install`, etc. and routes to Slack approval. | `.claude/hooks/tool-approval.sh` |
| **Unauthorized tool use** | Write/Edit always require approval. Destructive Bash patterns detected by regex. | `tool-approval.sh` pattern matching |
| **Out-of-project file deletion** | Guard script resolves absolute paths and blocks `rm`/`unlink` targeting paths outside project directory. | `scripts/guard-bash.sh` |
| **Resource exhaustion** | Max 3 concurrent Claude CLI processes (configurable 1-10). Max 50 proxy connections. 5-min timeout on credentials. | `ClaudeRunner` queue, `ProxyServer.MAX_CONNECTIONS` |
| **Session hijacking** | Thread-isolated screenshot directories. Per-thread dedicated browser tabs (Playwright pages). | `THREAD_ID` in `mcp-server.ts`, `getPage()` |
| **Approval circumvention** | Only `OWNER_SLACK_USER_ID` can approve. 10-min auto-deny timeout. Race condition prevented by Promise-first pattern. | `ApprovalManager`, `NetworkApprovalManager` |
| **XSS in credential form** | All user-facing output sanitized with `escapeHtml()`. Form fields use proper `type="password"`. Autocomplete disabled. | `credential-server.ts` |
| **Missing audit trail** | Full lifecycle tracing via Langfuse hooks. Pino structured logging for all security events. Obsidian export for offline review. | `.claude/hooks/scripts/langfuse-logger.sh` |

## Prerequisites

- **Node.js** 20 or later
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated
- **Google Chrome** (if using browser automation features)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From a manifest**
3. Select your workspace
4. Paste the contents of `manifest.json`
5. After creation, obtain the following tokens:

| Token | Location | Format |
|-------|----------|--------|
| Bot Token | **OAuth & Permissions** → Bot User OAuth Token | `xoxb-...` |
| App Token | **Basic Information** → App-Level Tokens → Generate with `connections:write` scope | `xapp-...` |
| Signing Secret | **Basic Information** → App Credentials | string |
| User Token (optional) | **OAuth & Permissions** → User OAuth Token | `xoxp-...` |

> **User Token**: Required for cross-workspace search (`search.messages`). If not needed, you can skip this.

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your tokens:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token
SLACK_SIGNING_SECRET=your-signing-secret
OWNER_SLACK_USER_ID=U01XXXXXX

# Optional: Enable cross-workspace search
SLACK_USER_TOKEN=xoxp-your-user-token
```

### 4. Launch Chrome (for browser automation)

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=~/.mugi-claw/chrome-profile
```

1. Log in to Google in the launched Chrome window (first time only)
2. The session persists in `chrome-profile`, so re-login is not required

### 5. Start the Application

#### Development Mode (with hot reload)

```bash
npm run dev
```

#### Production Mode

```bash
npm run build
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | — | Slack Bot Token (`xoxb-`) |
| `SLACK_APP_TOKEN` | Yes | — | Slack App-Level Token (`xapp-`) |
| `SLACK_SIGNING_SECRET` | Yes | — | Slack Signing Secret |
| `SLACK_USER_TOKEN` | No | — | Slack User Token (`xoxp-`). For cross-workspace search. |
| `OWNER_SLACK_USER_ID` | Yes | — | Bot owner's Slack User ID |
| `DB_PATH` | No | `~/.mugi-claw/mugi-claw.db` | SQLite database path |
| `CLAUDE_CLI_PATH` | No | `claude` | Path to Claude Code CLI binary |
| `CLAUDE_MAX_CONCURRENT` | No | `3` | Max concurrent Claude CLI processes (1–10) |
| `CLAUDE_MAX_TURNS` | No | `50` | Max turns per Claude CLI session (1–200) |
| `CHROME_DEBUGGING_PORT` | No | `9222` | Chrome CDP port |
| `CHROME_USER_DATA_DIR` | No | `~/.mugi-claw/chrome-profile` | Chrome user data directory |
| `PROXY_PORT` | No | `18080` | Network proxy port |
| `DEFAULT_WHITELIST` | No | `registry.npmjs.org,github.com,api.anthropic.com,slack.com` | Initial whitelist domains (comma-separated) |
| `SANDBOX_ENABLED` | No | `false` | Enable Seatbelt sandbox (`true`/`false`) |
| `SANDBOX_PROFILE` | No | `sandbox/mugi-claw.sb` | Path to Seatbelt profile |
| `LOG_LEVEL` | No | `info` | Log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`) |
| `NODE_ENV` | No | `development` | Environment (`development`/`production`/`test`) |

## Seatbelt Sandbox & Network Proxy

mugi-claw uses macOS Seatbelt (`sandbox-exec`) and an HTTP CONNECT proxy to isolate Claude Code CLI execution. Unlike Docker, the sandbox maintains direct access to the host Chrome CDP session on `localhost:9222`.

### Architecture

Seatbelt and the network proxy work together as a two-layer defense:

```mermaid
graph TD
    subgraph Host["Host macOS"]
        Chrome["Chrome CDP :9222"]
        Approval["Approval Server :3456"]
        Credential["Credential Server :3457"]

        subgraph SB["Seatbelt Sandbox"]
            CLI["Claude Code CLI"]
            MCP["MCP Servers<br/>(browser, desktop)"]
            Bash["Bash subprocesses<br/>(curl, npm, etc.)"]
        end

        Proxy["Network Proxy :18080"]
    end

    subgraph External["Internet"]
        WL["Whitelisted Domains<br/>github.com, api.anthropic.com, ..."]
        Unknown["Unknown Domains"]
    end

    CLI --> MCP
    CLI --> Bash
    CLI -->|"localhost (direct)"| Chrome
    CLI -->|"localhost (direct)"| Approval
    CLI -->|"localhost (direct)"| Credential
    Bash -->|"HTTP_PROXY"| Proxy
    Bash -.->|"curl --noproxy, nc, etc."| SB
    SB -.->|"EPERM (kernel block)"| External
    Proxy -->|"auto-pass"| WL
    Proxy -->|"Slack approval"| Unknown

    style SB fill:#fff3cd,stroke:#ffc107
    style Proxy fill:#d4edda,stroke:#28a745
```

**Layer 1 — Seatbelt (OS-level, kernel-enforced):**
- Blocks all external network at the kernel level — only `localhost` connections are allowed
- Denies access to sensitive files (`~/.ssh`, `~/.aws`, `~/.gnupg`)
- Cannot be bypassed by any subprocess, even with `--noproxy` or direct sockets

**Layer 2 — Network Proxy (application-level):**
- All HTTP/HTTPS traffic is forced through `localhost:18080` via `HTTP_PROXY`/`HTTPS_PROXY` env vars
- Whitelisted domains pass through automatically
- Unknown domains trigger a Slack approval flow
- Provides human-in-the-loop control over network access

**Why both layers?**

| Attack Vector | Seatbelt Only | Proxy Only | Both |
|---------------|:---:|:---:|:---:|
| `curl https://evil.com` | Blocked | Blocked (not whitelisted) | Blocked |
| `curl --noproxy '*' https://evil.com` | Blocked | **Bypassed** | Blocked |
| `nc evil.com 443` | Blocked | **Bypassed** | Blocked |
| `python3 -c "socket.connect(...)"` | Blocked | **Bypassed** | Blocked |

Without Seatbelt, any subprocess that ignores `HTTP_PROXY` can connect directly to the internet. Seatbelt ensures all external connections are blocked at the kernel level, making the proxy the only possible exit path.

### How the Network Proxy Works

The proxy is an HTTP CONNECT tunnel server (`src/network/proxy-server.ts`).

```
Claude CLI subprocess (curl, npm, etc.)
  |
  | CONNECT evil.com:443
  v
Proxy Server (localhost:18080)
  |
  v
WhitelistStore.isAllowed(hostname)?
  |
  ├─ YES (default whitelist / temporary / permanent)
  |    → TCP tunnel established → 200 Connection Established
  |
  └─ NO
       |
       v
     Has session context (Slack thread)?
       |
       ├─ NO → 403 Forbidden (auto-deny)
       |
       └─ YES → Slack approval message posted to thread
                  |
                  ├─ "Allow Once"      → temporary permit (memory, cleared on restart)
                  ├─ "Allow Permanent" → saved to SQLite, persists across restarts
                  └─ "Deny"            → 403 Forbidden

                  (10-minute timeout → auto-deny)
```

**Whitelist resolution order** (`src/network/whitelist-store.ts`):

1. **Default whitelist** — configured via `DEFAULT_WHITELIST` env var. Wildcard support (e.g., `*.googleapis.com`)
2. **Temporary permits** — in-memory Set, cleared on restart
3. **Permanent permits** — stored in SQLite (`~/.mugi-claw/mugi-claw.db`), loaded into cache on startup

**Default whitelisted domains:**

| Domain | Purpose |
|--------|---------|
| `registry.npmjs.org` | npm package installs |
| `github.com` | Git operations |
| `api.anthropic.com` | Claude API |
| `platform.claude.com` | Claude CLI auth/telemetry |
| `cloud.langfuse.com` | Langfuse tracing |
| `*.datadoghq.com` | Datadog logging |
| `slack.com` | Slack API |

Configurable via `DEFAULT_WHITELIST` env var (comma-separated).

### Setup

1. **Find your Claude CLI absolute path** and set it in `.env`:

```bash
which claude
# Example: /Users/yourname/.local/bin/claude
```

```bash
# .env
SANDBOX_ENABLED=true
CLAUDE_CLI_PATH=/Users/yourname/.local/bin/claude
```

> `sandbox-exec` requires an absolute path. The default `claude` (relative) will fail with exit code 71.

2. **Update paths in the Seatbelt profile** to match your `$HOME`:

```bash
sed -i '' "s|/Users/tubone24|$HOME|g" sandbox/mugi-claw.sb
```

3. **Verify the profile**:

```bash
sandbox-exec -f sandbox/mugi-claw.sb /path/to/claude --version
```

### Seatbelt Profile Design

The profile uses an **allow-default** strategy with targeted deny rules:

```scheme
(version 1)
(allow default)                          ;; Allow everything by default

;; Network: block external, allow localhost
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote tcp "localhost:*"))
(allow network-outbound (remote unix-socket))
(allow network-inbound)
(allow network-outbound (remote udp "*:53"))  ;; DNS

;; Filesystem: block sensitive paths
(deny file-read*  (subpath "/Users/yourname/.ssh"))
(deny file-read*  (subpath "/Users/yourname/.aws"))
(deny file-read*  (subpath "/Users/yourname/.gnupg"))
(deny file-write* (subpath "/Users/yourname/.ssh"))
(deny file-write* (subpath "/Users/yourname/.aws"))
(deny file-write* (subpath "/Users/yourname/.gnupg"))
```

**Why `(allow default)` instead of `(deny default)`?**

`(deny default)` requires explicitly allowing every operation the process needs (file reads, shared library loading, mach lookups, process info, etc.). The Claude CLI binary is complex (x86_64 Mach-O running via Rosetta on Apple Silicon) and needs many low-level system operations that are difficult to enumerate. `(allow default)` avoids this complexity while still enforcing the critical restrictions (network + sensitive files).

**Adding access for additional directories:**

```scheme
;; Example: allow access to an Obsidian vault
(deny file-read*  (subpath "/Users/yourname/Documents/vault"))
;; ↑ Use deny rules to BLOCK paths. Everything else is allowed by default.
```

**Seatbelt syntax rules:**

| Rule | Description |
|------|-------------|
| `(allow default)` | Allow everything not explicitly denied |
| `(deny network-outbound (remote ip "*:*"))` | Block all external network |
| `(allow network-outbound (remote ip "localhost:*"))` | Allow localhost connections |
| `(deny file-read* (subpath "..."))` | Block read access to a directory tree |
| `(deny file-write* (subpath "..."))` | Block write access to a directory tree |

> **Important:** Network host must be `*` or `localhost` — IP addresses like `127.0.0.1` cause exit code 65.

### Proxy Environment Variables

When `SANDBOX_ENABLED=true`, `claude-runner.ts` automatically injects:

```
HTTP_PROXY=http://localhost:18080
HTTPS_PROXY=http://localhost:18080
```

These are inherited by all subprocesses (curl, wget, npm, etc.). Combined with Seatbelt's network restriction, this forces all external HTTP/HTTPS traffic through the proxy.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Exit code 65: `host must be * or localhost` | IP address in network rule | Use `localhost` instead of `127.0.0.1` |
| Exit code 71: `execvp() failed: No such file or directory` | Relative CLI path | Set `CLAUDE_CLI_PATH` to absolute path (`which claude`) |
| `zsh: abort` on `sandbox-exec` | Missing system permissions | Use `(allow default)` strategy instead of `(deny default)` |
| `code: null` + bot hangs | Process killed by signal, error not emitted | Fixed in `claude-runner.ts` — signal kills now emit errors |
| `No session context - denying network access` | Domain not in whitelist + no Slack thread | Add domain to `DEFAULT_WHITELIST` |
| `Network access denied` for known domain | Missing from default whitelist | Add to `DEFAULT_WHITELIST` env var |

**Debug commands:**

```bash
# Watch for Seatbelt violations
log stream --style compact --predicate 'sender=="Sandbox"'

# Test sandbox profile
sandbox-exec -f sandbox/mugi-claw.sb /bin/true && echo "OK"

# Check if Claude CLI works in sandbox
sandbox-exec -f sandbox/mugi-claw.sb /path/to/claude --version

# Verify proxy is running
lsof -i :18080
```

## Browser Automation

Google services (Gmail, Drive, Photos) are operated through their browser UIs, not APIs.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an element (non-sensitive only) |
| `browser_screenshot` | Take a screenshot (auto-uploaded to Slack thread) |
| `browser_get_text` | Get text content of an element or full page |
| `browser_wait` | Wait for an element to appear |
| `browser_evaluate` | Execute JavaScript on the page |
| `browser_secure_input` | Securely input credentials via local Web UI |

### Desktop MCP Tools

| Tool | Description |
|------|-------------|
| `desktop_screenshot` | Capture the full desktop |
| `desktop_click` | Click at coordinates |
| `desktop_right_click` / `desktop_double_click` | Context menu / double-click |
| `desktop_type` | Type text |
| `desktop_key` | Press a key (Enter, Escape, arrows, etc.) |
| `desktop_hotkey` | Keyboard shortcut (Cmd+C, Ctrl+Shift+S, etc.) |
| `desktop_mouse_move` | Move mouse to coordinates |
| `desktop_scroll` | Scroll up/down |
| `desktop_open_app` | Launch an application |
| `desktop_get_screen_info` | Get screen resolution |
| `desktop_wait` | Wait for a duration |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/mugiclaw help` | Show help |
| `/mugiclaw profile` | View profile |
| `/mugiclaw profile set <field> <value>` | Update profile |
| `/mugiclaw schedule list` | List scheduled tasks |
| `/mugiclaw schedule add <name> <cron> <prompt>` | Add a scheduled task |
| `/mugiclaw schedule remove <name>` | Remove a scheduled task |
| `/mugiclaw schedule pause <name>` | Pause/resume a task |
| `/mugiclaw run <name>` | Run a task immediately |
| `/mugiclaw memories` | List memories |
| `/mugiclaw memory add <text>` | Add a memory |
| `/mugiclaw memory forget <id>` | Delete a memory |
| `/mugiclaw model` | Show current model |
| `/mugiclaw model <opus\|sonnet\|haiku>` | Switch model |

Natural language scheduling via `@mention` is also supported:

```
@mugibow Check my Gmail every morning at 9 AM and summarize unread emails
```

## Data Persistence

SQLite database at `~/.mugi-claw/mugi-claw.db`:

| Table | Description |
|-------|-------------|
| `user_profile` | Per-user profile (name, location, timezone, hobbies, etc.) |
| `user_memories` | Conversational memory (preferences, facts, habits, context) |
| `scheduled_tasks` | Cron-based task definitions |
| `task_runs` | Task execution history (status, cost, duration) |
| `settings` | Global settings (Claude model, etc.) |
| `network_whitelist` | Permanently approved network domains |

## Observability

### Langfuse Tracing

Full session lifecycle tracing including tool calls, sub-agents, token usage, and costs.

Add to `~/.claude/.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
# Optional
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
```

**What gets traced:**

| Event | Langfuse Object | Details |
|-------|----------------|---------|
| Session start | Trace | model, git branch/commit, cwd |
| User prompt | Trace | prompt text, turn number |
| Tool use | Span | tool name, input summary, output |
| Tool failure | Span (ERROR) | error message, is_interrupt flag |
| Sub-agent | Span | agent type, description, output |
| LLM response | Generation | thinking + output, token counts, cost |
| Session total | Generation | aggregated usage + cost breakdown |

## Deployment

### Docker

```bash
# Build & start
docker compose -f docker/docker-compose.yml up -d

# View logs
docker compose -f docker/docker-compose.yml logs -f mugi-claw
```

Docker Compose runs two services:
- **mugi-claw**: Main application (Node.js 20)
- **chrome**: Headless Chrome (zenika/alpine-chrome) with CDP on port 9222

Volumes:
- `~/.claude` → mounted read-only (Claude auth)
- `~/.mugi-claw` → mounted read-write (Chrome profile, database)

### macOS launchd (Persistent Service)

Use macOS `launchd` for auto-start on login and crash recovery.

#### 1. Build

```bash
npm run build
```

#### 2. Install the plist

```bash
cp launchd/com.mugi-claw.plist ~/Library/LaunchAgents/
```

> **Note**: Edit the plist to match your Node.js path (`which node`), working directory, and `PATH` (include `~/.local/bin` for Claude CLI). launchd does not read shell profiles.

#### 3. Service Commands

```bash
# Register & start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mugi-claw.plist

# Stop & unregister
launchctl bootout gui/$(id -u)/com.mugi-claw

# Start
launchctl kickstart gui/$(id -u)/com.mugi-claw

# Restart
launchctl kickstart -k gui/$(id -u)/com.mugi-claw

# Check status
launchctl print gui/$(id -u)/com.mugi-claw

# View logs
tail -f ~/.mugi-claw/launchd-stdout.log
tail -f ~/.mugi-claw/launchd-stderr.log
```

#### 4. Updating Code

```bash
launchctl bootout gui/$(id -u)/com.mugi-claw
npm run build
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mugi-claw.plist
```

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode (tsx watch with hot reload) |
| `npm run build` | TypeScript build |
| `npm start` | Production mode |
| `npm run typecheck` | Type checking only |
| `npm run lint` | ESLint |

## Project Structure

```
src/
├── index.ts                    # Entry point, initialization & graceful shutdown
├── config.ts                   # Environment variable validation (Zod)
├── types.ts                    # Shared type definitions
├── db/
│   ├── database.ts             # SQLite singleton (WAL mode)
│   ├── migrations.ts           # Schema definitions
│   └── settings-store.ts       # Global settings (model, etc.)
├── profile/
│   ├── profile-store.ts        # Profile & memory CRUD
│   └── profile-onboarding.ts   # First-time user DM (Block Kit)
├── claude/
│   ├── claude-runner.ts        # CLI spawn + concurrency queue + sandbox
│   ├── stream-parser.ts        # NDJSON stream parser
│   ├── session-manager.ts      # Thread ↔ session mapping
│   ├── prompt-builder.ts       # Persona + context prompt assembly
│   └── result-parser.ts        # Structured output block parser
├── scheduler/
│   ├── scheduler.ts            # node-cron management
│   ├── task-store.ts           # Task CRUD
│   └── task-runner.ts          # Task execution
├── slack/
│   ├── app.ts                  # Slack Bolt + Socket Mode
│   ├── notifier.ts             # Result notification (DM/channel)
│   ├── thread-manager.ts       # Real-time progress (debounced updates)
│   ├── context-collector.ts    # Thread history + cross-workspace search
│   ├── markdown-converter.ts   # Markdown → Slack mrkdwn
│   └── handlers/
│       ├── mention-handler.ts  # @mention handler
│       ├── command-handler.ts  # /mugiclaw router
│       └── commands/           # Subcommand implementations
├── approval/
│   ├── approval-manager.ts     # Tool approval with Slack buttons
│   ├── approval-server.ts      # HTTP API (:3456) for hooks + screenshots
│   └── register-handlers.ts    # Slack interaction handlers
├── credential/
│   ├── credential-manager.ts   # Secure credential input orchestration
│   └── credential-server.ts    # Web UI server (:3457) for credential forms
├── network/
│   ├── proxy-server.ts         # HTTP CONNECT proxy with whitelist
│   ├── whitelist-store.ts      # 3-tier whitelist (default + temp + permanent)
│   └── network-approval.ts     # Slack approval for unknown domains
├── browser/
│   ├── chrome-launcher.ts      # Chrome CDP launch & health check
│   └── mcp-server.ts           # Playwright MCP (8 tools + secure_input)
└── desktop/
    └── mcp-server.ts           # macOS desktop MCP (11 tools)

.claude/                        # Persona & configuration
├── SOUL.md                     # Mission & core values
├── IDENTITY.md                 # Name, speech patterns, tone
├── AGENTS.md                   # Available skills & MCP tools
├── INSTRUCTIONS.md             # Security rules & structured output
├── hooks/                      # Claude Code event hooks
│   ├── tool-approval.sh        # PreToolUse approval routing
│   └── scripts/
│       └── langfuse-logger.sh  # Full lifecycle tracing (1176 lines)
└── skills/                     # Browser automation skill definitions

scripts/                        # Guard hooks
├── guard-bash.sh               # Block .env access & out-of-project deletion
└── guard-file-access.sh        # Block .env Read/Write/Edit

sandbox/
└── mugi-claw.sb                # Seatbelt profile (deny-default)

docker/
├── Dockerfile                  # Node.js 20 + Playwright deps
└── docker-compose.yml          # mugi-claw + Chrome services

launchd/
└── com.mugi-claw.plist         # macOS persistent service config
```

## License

Private project. All rights reserved.
