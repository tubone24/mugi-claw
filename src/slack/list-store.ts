import { nanoid } from 'nanoid';
import { getDb } from '../db/database.js';
import type { UserList, ListItem } from '../types.js';

export class ListStore {
  // Lists
  getAllLists(): UserList[] {
    const rows = getDb().prepare('SELECT * FROM user_lists ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToList);
  }

  getListsByUser(userId: string): UserList[] {
    const rows = getDb().prepare(
      'SELECT * FROM user_lists WHERE created_by = ? ORDER BY created_at DESC'
    ).all(userId) as Record<string, unknown>[];
    return rows.map(this.rowToList);
  }

  getList(id: string): UserList | null {
    const row = getDb().prepare('SELECT * FROM user_lists WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToList(row) : null;
  }

  getListByName(name: string, userId: string): UserList | null {
    const row = getDb().prepare(
      'SELECT * FROM user_lists WHERE name = ? AND created_by = ?'
    ).get(name, userId) as Record<string, unknown> | undefined;
    return row ? this.rowToList(row) : null;
  }

  createList(data: { name: string; channelId?: string; createdBy: string }): UserList {
    const id = nanoid();
    getDb().prepare(
      'INSERT INTO user_lists (id, name, channel_id, created_by) VALUES (?, ?, ?, ?)'
    ).run(id, data.name, data.channelId ?? null, data.createdBy);
    return this.getList(id)!;
  }

  deleteList(id: string): boolean {
    const result = getDb().prepare('DELETE FROM user_lists WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Items
  getItems(listId: string): ListItem[] {
    const rows = getDb().prepare(
      'SELECT * FROM list_items WHERE list_id = ? ORDER BY CASE status WHEN \'open\' THEN 0 ELSE 1 END, created_at ASC'
    ).all(listId) as Record<string, unknown>[];
    return rows.map(this.rowToItem);
  }

  getItem(id: string): ListItem | null {
    const row = getDb().prepare('SELECT * FROM list_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToItem(row) : null;
  }

  getItemByTitle(listId: string, title: string): ListItem | null {
    const row = getDb().prepare(
      'SELECT * FROM list_items WHERE list_id = ? AND title = ?'
    ).get(listId, title) as Record<string, unknown> | undefined;
    return row ? this.rowToItem(row) : null;
  }

  createItem(data: {
    listId: string;
    title: string;
    description?: string;
    assignee?: string;
    dueDate?: string;
    priority?: 'high' | 'medium' | 'low';
    createdBy: string;
  }): ListItem {
    const id = nanoid();
    getDb().prepare(
      `INSERT INTO list_items (id, list_id, title, description, assignee, due_date, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.listId, data.title, data.description ?? null, data.assignee ?? null, data.dueDate ?? null, data.priority ?? 'medium', data.createdBy);
    return this.getItem(id)!;
  }

  updateItem(id: string, data: Partial<{
    title: string;
    description: string;
    status: 'open' | 'done';
    assignee: string;
    dueDate: string;
    priority: 'high' | 'medium' | 'low';
  }>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.assignee !== undefined) { fields.push('assignee = ?'); values.push(data.assignee); }
    if (data.dueDate !== undefined) { fields.push('due_date = ?'); values.push(data.dueDate); }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
    if (fields.length === 0) return false;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    const result = getDb().prepare(`UPDATE list_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  deleteItem(id: string): boolean {
    const result = getDb().prepare('DELETE FROM list_items WHERE id = ?').run(id);
    return result.changes > 0;
  }

  toggleItemStatus(id: string): 'open' | 'done' | null {
    const item = this.getItem(id);
    if (!item) return null;
    const newStatus = item.status === 'open' ? 'done' : 'open';
    getDb().prepare("UPDATE list_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, id);
    return newStatus;
  }

  private rowToList(row: Record<string, unknown>): UserList {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      channelId: row['channel_id'] as string | undefined,
      createdBy: row['created_by'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private rowToItem(row: Record<string, unknown>): ListItem {
    return {
      id: row['id'] as string,
      listId: row['list_id'] as string,
      title: row['title'] as string,
      description: row['description'] as string | undefined,
      status: (row['status'] as string as 'open' | 'done') ?? 'open',
      assignee: row['assignee'] as string | undefined,
      dueDate: row['due_date'] as string | undefined,
      priority: (row['priority'] as string as 'high' | 'medium' | 'low') ?? 'medium',
      createdBy: row['created_by'] as string,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
