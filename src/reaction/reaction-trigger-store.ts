import { nanoid } from 'nanoid';
import { getDb } from '../db/database.js';
import type { ReactionTrigger } from '../types.js';

export class ReactionTriggerStore {
  getAll(): ReactionTrigger[] {
    const rows = getDb().prepare('SELECT * FROM reaction_triggers ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToTrigger);
  }

  getEnabled(): ReactionTrigger[] {
    const rows = getDb().prepare('SELECT * FROM reaction_triggers WHERE enabled = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToTrigger);
  }

  getById(id: string): ReactionTrigger | null {
    const row = getDb().prepare('SELECT * FROM reaction_triggers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTrigger(row) : null;
  }

  getByEmoji(emojiName: string): ReactionTrigger | null {
    const row = getDb().prepare('SELECT * FROM reaction_triggers WHERE emoji_name = ?').get(emojiName) as Record<string, unknown> | undefined;
    return row ? this.rowToTrigger(row) : null;
  }

  create(data: {
    emojiName: string;
    promptTemplate: string;
    description?: string;
    model?: string;
    createdBy?: string;
  }): ReactionTrigger {
    const id = nanoid();
    getDb().prepare(
      `INSERT INTO reaction_triggers (id, emoji_name, prompt_template, description, model, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, data.emojiName, data.promptTemplate, data.description ?? null, data.model ?? null, data.createdBy ?? null);
    return this.getById(id)!;
  }

  update(id: string, data: Partial<{ emojiName: string; promptTemplate: string; description: string; enabled: boolean; model: string }>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.emojiName !== undefined) { fields.push('emoji_name = ?'); values.push(data.emojiName); }
    if (data.promptTemplate !== undefined) { fields.push('prompt_template = ?'); values.push(data.promptTemplate); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
    if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
    if (fields.length === 0) return false;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    const result = getDb().prepare(`UPDATE reaction_triggers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = getDb().prepare('DELETE FROM reaction_triggers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByEmoji(emojiName: string): boolean {
    const result = getDb().prepare('DELETE FROM reaction_triggers WHERE emoji_name = ?').run(emojiName);
    return result.changes > 0;
  }

  toggle(id: string): boolean {
    const result = getDb().prepare("UPDATE reaction_triggers SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private rowToTrigger(row: Record<string, unknown>): ReactionTrigger {
    return {
      id: row['id'] as string,
      emojiName: row['emoji_name'] as string,
      promptTemplate: row['prompt_template'] as string,
      description: row['description'] as string | undefined,
      enabled: (row['enabled'] as number) === 1,
      model: row['model'] as string | undefined,
      createdBy: row['created_by'] as string | undefined,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
