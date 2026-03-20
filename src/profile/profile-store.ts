import { getDb } from '../db/database.js';
import type { UserProfile, UserMemory } from '../types.js';

export class ProfileStore {
  getProfile(slackUserId: string): UserProfile | null {
    const row = getDb().prepare('SELECT * FROM user_profile WHERE slack_user_id = ?').get(slackUserId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToProfile(row);
  }

  upsertProfile(slackUserId: string, data: Partial<Omit<UserProfile, 'slackUserId' | 'createdAt' | 'updatedAt'>>): void {
    const existing = this.getProfile(slackUserId);
    if (existing) {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (data.displayName !== undefined) { fields.push('display_name = ?'); values.push(data.displayName); }
      if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location); }
      if (data.timezone !== undefined) { fields.push('timezone = ?'); values.push(data.timezone); }
      if (data.hobbies !== undefined) { fields.push('hobbies = ?'); values.push(JSON.stringify(data.hobbies)); }
      if (data.favoriteFoods !== undefined) { fields.push('favorite_foods = ?'); values.push(JSON.stringify(data.favoriteFoods)); }
      if (data.interests !== undefined) { fields.push('interests = ?'); values.push(JSON.stringify(data.interests)); }
      if (data.customData !== undefined) { fields.push('custom_data = ?'); values.push(JSON.stringify(data.customData)); }
      if (fields.length === 0) return;
      fields.push("updated_at = datetime('now')");
      values.push(slackUserId);
      getDb().prepare(`UPDATE user_profile SET ${fields.join(', ')} WHERE slack_user_id = ?`).run(...values);
    } else {
      getDb().prepare(
        `INSERT INTO user_profile (slack_user_id, display_name, location, timezone, hobbies, favorite_foods, interests, custom_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        slackUserId,
        data.displayName ?? null,
        data.location ?? null,
        data.timezone ?? 'Asia/Tokyo',
        JSON.stringify(data.hobbies ?? []),
        JSON.stringify(data.favoriteFoods ?? []),
        JSON.stringify(data.interests ?? []),
        JSON.stringify(data.customData ?? {}),
      );
    }
  }

  getMemories(slackUserId: string, limit = 50): UserMemory[] {
    const rows = getDb().prepare(
      'SELECT * FROM user_memories WHERE slack_user_id = ? ORDER BY updated_at DESC LIMIT ?'
    ).all(slackUserId, limit) as Record<string, unknown>[];
    return rows.map(this.rowToMemory);
  }

  addMemory(slackUserId: string, category: UserMemory['category'], content: string, source: UserMemory['source'] = 'conversation'): number {
    const result = getDb().prepare(
      'INSERT INTO user_memories (slack_user_id, category, content, source) VALUES (?, ?, ?, ?)'
    ).run(slackUserId, category, content, source);
    return Number(result.lastInsertRowid);
  }

  deleteMemory(id: number): boolean {
    const result = getDb().prepare('DELETE FROM user_memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private rowToProfile(row: Record<string, unknown>): UserProfile {
    return {
      slackUserId: row['slack_user_id'] as string,
      displayName: row['display_name'] as string | undefined,
      location: row['location'] as string | undefined,
      timezone: (row['timezone'] as string) ?? 'Asia/Tokyo',
      hobbies: JSON.parse((row['hobbies'] as string) ?? '[]'),
      favoriteFoods: JSON.parse((row['favorite_foods'] as string) ?? '[]'),
      interests: JSON.parse((row['interests'] as string) ?? '[]'),
      customData: JSON.parse((row['custom_data'] as string) ?? '{}'),
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private rowToMemory(row: Record<string, unknown>): UserMemory {
    return {
      id: row['id'] as number,
      slackUserId: row['slack_user_id'] as string,
      category: row['category'] as UserMemory['category'],
      content: row['content'] as string,
      source: row['source'] as UserMemory['source'],
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
