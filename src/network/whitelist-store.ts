import { getDb } from '../db/database.js';
import type { WhitelistEntry } from '../types.js';

export class WhitelistStore {
  private temporarySet = new Set<string>();
  private permanentCache = new Set<string>();
  private defaultWhitelist: string[];

  constructor(defaultWhitelist: string[] = []) {
    this.defaultWhitelist = defaultWhitelist;
  }

  private makeKey(hostname: string, port?: number): string {
    return port != null ? `${hostname}:${port}` : `${hostname}:*`;
  }

  private matchesDefault(hostname: string): boolean {
    for (const pattern of this.defaultWhitelist) {
      if (this.matchesWildcard(hostname, pattern)) {
        return true;
      }
    }
    return false;
  }

  private matchesWildcard(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. ".googleapis.com"
      return hostname.endsWith(suffix) || hostname === pattern.slice(2);
    }
    return hostname === pattern;
  }

  loadCache(): void {
    this.permanentCache.clear();
    const db = getDb();
    const rows = db.prepare(`SELECT hostname, port FROM network_whitelist`).all() as Array<{
      hostname: string;
      port: number | null;
    }>;
    for (const row of rows) {
      this.permanentCache.add(this.makeKey(row.hostname, row.port ?? undefined));
    }
  }

  isAllowed(hostname: string, port?: number): boolean {
    // 1. デフォルトホワイトリスト（ワイルドカード対応）
    if (this.matchesDefault(hostname)) return true;
    // 2. 一時許可
    if (this.temporarySet.has(`${hostname}:${port ?? '*'}`)) return true;
    if (this.temporarySet.has(`${hostname}:*`)) return true;
    // 3. 永続キャッシュ
    if (this.permanentCache.has(`${hostname}:${port ?? '*'}`)) return true;
    if (this.permanentCache.has(`${hostname}:*`)) return true;
    return false;
  }

  addTemporary(hostname: string, port?: number, _purpose?: string): void {
    this.temporarySet.add(this.makeKey(hostname, port));
  }

  addPermanent(hostname: string, approvedBy: string, port?: number, purpose?: string): void {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO network_whitelist (hostname, port, is_permanent, approved_by, purpose)
       VALUES (?, ?, 1, ?, ?)`,
    ).run(hostname, port ?? null, approvedBy, purpose ?? null);
    this.permanentCache.add(this.makeKey(hostname, port));
  }

  remove(hostname: string, port?: number): void {
    const key = this.makeKey(hostname, port);
    this.temporarySet.delete(key);
    this.permanentCache.delete(key);
    const db = getDb();
    if (port != null) {
      db.prepare(`DELETE FROM network_whitelist WHERE hostname = ? AND port = ?`).run(hostname, port);
    } else {
      db.prepare(`DELETE FROM network_whitelist WHERE hostname = ? AND port IS NULL`).run(hostname);
    }
  }

  list(): WhitelistEntry[] {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM network_whitelist ORDER BY created_at DESC`).all() as Array<{
      id: number;
      hostname: string;
      port: number | null;
      is_permanent: number;
      approved_by: string | null;
      purpose: string | null;
      created_at: string;
      expires_at: string | null;
    }>;

    const entries: WhitelistEntry[] = rows.map((row) => ({
      id: row.id,
      hostname: row.hostname,
      port: row.port ?? undefined,
      isPermanent: row.is_permanent === 1,
      approvedBy: row.approved_by ?? undefined,
      purpose: row.purpose ?? undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
    }));

    // Add temporary entries
    for (const key of this.temporarySet) {
      const parts = key.split(':');
      const hostname = parts[0] ?? key;
      const portStr = parts[1];
      entries.push({
        hostname,
        port: portStr ? parseInt(portStr, 10) : undefined,
        isPermanent: false,
        createdAt: new Date().toISOString(),
      });
    }

    // Add default entries
    for (const pattern of this.defaultWhitelist) {
      entries.push({
        hostname: pattern,
        isPermanent: true,
        approvedBy: 'system',
        purpose: 'default whitelist',
        createdAt: '',
      });
    }

    return entries;
  }

  seedDefaults(): void {
    const db = getDb();
    for (const hostname of this.defaultWhitelist) {
      db.prepare(
        `INSERT OR IGNORE INTO network_whitelist (hostname, port, is_permanent, approved_by, purpose)
         VALUES (?, NULL, 1, 'system', 'default whitelist')`,
      ).run(hostname);
    }
    this.loadCache();
  }
}
