// Slack関連
export interface SlackContext {
  channel: string;
  threadTs: string;
  userMessage: string;
  userId: string;
  threadMessages: ThreadMessage[];
  searchResults: SearchResult[];
}

export interface ThreadMessage {
  user: string;
  text: string;
  ts: string;
  botId?: string;
}

export interface SearchResult {
  channel: string;
  text: string;
  ts: string;
  permalink: string;
}

// Claude CLI stream-json イベント型
export type ClaudeStreamEvent =
  | ClaudeSystemInit
  | ClaudeAssistantText
  | ClaudeAssistantToolUse
  | ClaudeAssistantToolResult
  | ClaudeResult;

export interface ClaudeSystemInit {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
  mcp_servers: string[];
}

export interface ClaudeAssistantText {
  type: 'assistant';
  subtype: 'text';
  message: string;
}

export interface ClaudeAssistantToolUse {
  type: 'assistant';
  subtype: 'tool_use';
  tool: string;
  input: Record<string, unknown>;
}

export interface ClaudeAssistantToolResult {
  type: 'tool_result';
  subtype: 'success' | 'error';
  tool: string;
  output: string;
}

export interface ClaudeResult {
  type: 'result';
  subtype: 'success' | 'error';
  result: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
}

// プロセス管理
export interface ClaudeSession {
  sessionId: string;
  threadTs: string;
  channel: string;
  startedAt: Date;
  lastActiveAt: Date;
}

// Thread Manager
export interface ProgressUpdate {
  type: 'thinking' | 'tool_use' | 'text' | 'result' | 'error';
  content: string;
  toolName?: string;
}

// パーソナライズ
export interface UserProfile {
  slackUserId: string;
  displayName?: string;
  location?: string;
  timezone: string;
  hobbies: string[];
  favoriteFoods: string[];
  interests: string[];
  customData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UserMemory {
  id: number;
  slackUserId: string;
  category: 'preference' | 'fact' | 'habit' | 'context';
  content: string;
  source: 'conversation' | 'profile_setup' | 'explicit';
  createdAt: string;
  updatedAt: string;
}

// スケジュールタスク
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  cronExpression: string;
  taskPrompt: string;
  enabled: boolean;
  notifyChannel?: string;
  notifyType: 'dm' | 'channel';
  model?: string;
  mentionUsers: string[];    // ['U12345', 'U67890']
  mentionHere: boolean;      // <!here>
  mentionChannel: boolean;   // <!channel>
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
}

export interface TaskRun {
  id: number;
  taskId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'error';
  resultSummary?: string;
  errorMessage?: string;
  costUsd?: number;
  durationMs?: number;
}

// Config
export interface AppConfig {
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
    userToken?: string;
  };
  claude: {
    cliPath: string;
    maxConcurrent: number;
    maxTurns: number;
    maxRetries: number;
  };
  browser: {
    debuggingPort: number;
    userDataDir: string;
  };
  db: {
    path: string;
  };
  approval: {
    port: number;
  };
  credential: {
    port: number;
  };
  network: {
    proxyPort: number;
    defaultWhitelist: string[];
  };
  sandbox: {
    enabled: boolean;
    profile: string;
  };
  owner: {
    slackUserId: string;
  };
  logLevel: string;
}

// Network whitelist
export interface WhitelistEntry {
  id?: number;
  hostname: string;
  port?: number;
  isPermanent: boolean;
  approvedBy?: string;
  purpose?: string;
  createdAt: string;
  expiresAt?: string;
}
