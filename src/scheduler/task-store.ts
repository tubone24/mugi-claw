import { nanoid } from 'nanoid';
import { getDb } from '../db/database.js';
import type { ScheduledTask, TaskRun } from '../types.js';

export class TaskStore {
  getAllTasks(): ScheduledTask[] {
    const rows = getDb().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToTask);
  }

  getEnabledTasks(): ScheduledTask[] {
    const rows = getDb().prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToTask);
  }

  getTask(id: string): ScheduledTask | null {
    const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  getTaskByName(name: string): ScheduledTask | null {
    const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  createTask(data: {
    name: string;
    description?: string;
    cronExpression: string;
    taskPrompt: string;
    notifyChannel?: string;
    notifyType?: 'dm' | 'channel';
    model?: string;
    mentionUsers?: string[];
    mentionHere?: boolean;
    mentionChannel?: boolean;
  }): ScheduledTask {
    const id = nanoid();
    getDb().prepare(
      `INSERT INTO scheduled_tasks (id, name, description, cron_expression, task_prompt, notify_channel, notify_type, model, mention_users, mention_here, mention_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.name, data.description ?? null, data.cronExpression, data.taskPrompt, data.notifyChannel ?? null, data.notifyType ?? 'dm', data.model ?? null, JSON.stringify(data.mentionUsers ?? []), data.mentionHere ? 1 : 0, data.mentionChannel ? 1 : 0);
    return this.getTask(id)!;
  }

  updateTask(id: string, data: Partial<{ name: string; description: string; cronExpression: string; taskPrompt: string; enabled: boolean; notifyChannel: string; notifyType: string; model: string; mentionUsers: string[]; mentionHere: boolean; mentionChannel: boolean }>): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    if (data.cronExpression !== undefined) { fields.push('cron_expression = ?'); values.push(data.cronExpression); }
    if (data.taskPrompt !== undefined) { fields.push('task_prompt = ?'); values.push(data.taskPrompt); }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
    if (data.notifyChannel !== undefined) { fields.push('notify_channel = ?'); values.push(data.notifyChannel); }
    if (data.notifyType !== undefined) { fields.push('notify_type = ?'); values.push(data.notifyType); }
    if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model); }
    if (data.mentionUsers !== undefined) { fields.push('mention_users = ?'); values.push(JSON.stringify(data.mentionUsers)); }
    if (data.mentionHere !== undefined) { fields.push('mention_here = ?'); values.push(data.mentionHere ? 1 : 0); }
    if (data.mentionChannel !== undefined) { fields.push('mention_channel = ?'); values.push(data.mentionChannel ? 1 : 0); }
    if (fields.length === 0) return false;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    const result = getDb().prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const result = getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  toggleTask(id: string): boolean {
    const result = getDb().prepare("UPDATE scheduled_tasks SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // Task runs
  createRun(taskId: string): number {
    const result = getDb().prepare('INSERT INTO task_runs (task_id) VALUES (?)').run(taskId);
    return Number(result.lastInsertRowid);
  }

  finishRun(runId: number, status: 'success' | 'error', resultSummary?: string, errorMessage?: string, costUsd?: number, durationMs?: number): void {
    getDb().prepare(
      "UPDATE task_runs SET finished_at = datetime('now'), status = ?, result_summary = ?, error_message = ?, cost_usd = ?, duration_ms = ? WHERE id = ?"
    ).run(status, resultSummary ?? null, errorMessage ?? null, costUsd ?? null, durationMs ?? null, runId);

    // Also update the task's last_run info
    const run = getDb().prepare('SELECT task_id FROM task_runs WHERE id = ?').get(runId) as { task_id: string } | undefined;
    if (run) {
      getDb().prepare(
        "UPDATE scheduled_tasks SET last_run_at = datetime('now'), last_status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(status, errorMessage ?? null, run.task_id);
    }
  }

  getRecentRuns(taskId: string, limit = 10): TaskRun[] {
    const rows = getDb().prepare(
      'SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(taskId, limit) as Record<string, unknown>[];
    return rows.map(this.rowToRun);
  }

  private rowToTask(row: Record<string, unknown>): ScheduledTask {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      description: row['description'] as string | undefined,
      cronExpression: row['cron_expression'] as string,
      taskPrompt: row['task_prompt'] as string,
      enabled: (row['enabled'] as number) === 1,
      notifyChannel: row['notify_channel'] as string | undefined,
      notifyType: (row['notify_type'] as 'dm' | 'channel') ?? 'dm',
      model: row['model'] as string | undefined,
      mentionUsers: JSON.parse((row['mention_users'] as string) ?? '[]'),
      mentionHere: (row['mention_here'] as number) === 1,
      mentionChannel: (row['mention_channel'] as number) === 1,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      lastRunAt: row['last_run_at'] as string | undefined,
      lastStatus: row['last_status'] as string | undefined,
      lastError: row['last_error'] as string | undefined,
    };
  }

  private rowToRun(row: Record<string, unknown>): TaskRun {
    return {
      id: row['id'] as number,
      taskId: row['task_id'] as string,
      startedAt: row['started_at'] as string,
      finishedAt: row['finished_at'] as string | undefined,
      status: row['status'] as TaskRun['status'],
      resultSummary: row['result_summary'] as string | undefined,
      errorMessage: row['error_message'] as string | undefined,
      costUsd: row['cost_usd'] as number | undefined,
      durationMs: row['duration_ms'] as number | undefined,
    };
  }
}
