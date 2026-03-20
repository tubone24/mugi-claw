import { getDb } from './database.js';

export type ClaudeModel = 'opus' | 'sonnet' | 'haiku';

export class SettingsStore {
  get(key: string): string | null {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    getDb().prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, value);
  }

  getModel(): ClaudeModel {
    const value = this.get('claude_model');
    if (value === 'opus' || value === 'sonnet' || value === 'haiku') {
      return value;
    }
    return 'sonnet';
  }

  setModel(model: ClaudeModel): void {
    this.set('claude_model', model);
  }
}
