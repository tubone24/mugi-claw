export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_profile (
  slack_user_id TEXT PRIMARY KEY,
  display_name TEXT,
  location TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  hobbies TEXT DEFAULT '[]',
  favorite_foods TEXT DEFAULT '[]',
  interests TEXT DEFAULT '[]',
  custom_data TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT DEFAULT 'conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  cron_expression TEXT NOT NULL,
  task_prompt TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  notify_channel TEXT,
  notify_type TEXT DEFAULT 'dm',
  model TEXT,
  mention_users TEXT DEFAULT '[]',
  mention_here INTEGER DEFAULT 0,
  mention_channel INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  result_summary TEXT,
  error_message TEXT,
  cost_usd REAL,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('claude_model', 'sonnet');

CREATE TABLE IF NOT EXISTS network_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT NOT NULL,
  port INTEGER,
  is_permanent INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  purpose TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  UNIQUE(hostname, port)
);

CREATE TABLE IF NOT EXISTS reaction_triggers (
  id TEXT PRIMARY KEY,
  emoji_name TEXT NOT NULL UNIQUE,
  prompt_template TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  model TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, created_by)
);

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open',
  assignee TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'medium',
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;
