import type { ClaudeSession } from '../types.js';

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();

  /** セッション保存 */
  saveSession(threadTs: string, channel: string, sessionId: string): void {
    this.sessions.set(threadTs, {
      sessionId,
      threadTs,
      channel,
      startedAt: this.sessions.get(threadTs)?.startedAt ?? new Date(),
      lastActiveAt: new Date(),
    });
  }

  /** セッション取得 */
  getSession(threadTs: string): ClaudeSession | undefined {
    return this.sessions.get(threadTs);
  }

  /** 古いセッションをクリーンアップ（24時間以上前） */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24時間

    for (const [key, session] of this.sessions) {
      if (now - session.lastActiveAt.getTime() > maxAge) {
        this.sessions.delete(key);
      }
    }
  }
}
