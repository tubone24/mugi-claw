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
  };
  browser: {
    debuggingPort: number;
    userDataDir: string;
  };
  logLevel: string;
}
