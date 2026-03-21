import { getDb } from '../db/database.js';
import type { WhitelistEntry } from '../types.js';

export class WhitelistStore {
  private temporarySet = new Set<string>();
  private defaultWhitelist: string[];

  constructor(defaultWhitelist: string[] = []) {
    this.defaultWhitelist = defaultWhitelist;
  }

  private makeKey(hostname: string, port?: number): string {
    return port ? `${hostname}:${port}` : hostname;
  }

  private matchesWildcard(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // e.g. ".googleapis.com"
      return hostname.endsWith(suffix) || hostname === pattern.slice(2);
    }
    return hostname === pattern;
  }

  isAllowed(hostname: string, port?: number): boolean {
    // Check default whitelist (supports wildcard like *.googleapis.com)
    for (const pattern of this.defaultWhitelist) {
      if (this.matchesWildcard(hostname, pattern)) {
        return true;
      }
    }

    // Check temporary (in-memory) set
    if (this.temporarySet.has(this.makeKey(hostname, port)) || this.temporarySet.has(hostname)) {
      return true;
    }

    // Check DB
    const db = getDb();
    const row = db.prepare(
      `SELECT id FROM network_whitelist WHERE hostname = ? AND (port IS NULL OR port = ?)`,
    ).get(hostname, port ?? null) as { id: number } | undefined;

    return !!row;
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
  }

  remove(hostname: string, port?: number): void {
    this.temporarySet.delete(this.makeKey(hostname, port));
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
    const defaults = [
      'registry.npmjs.org',
      'github.com',
      'api.anthropic.com',
      'slack.com',
    ];
    for (const hostname of defaults) {
      if (!this.defaultWhitelist.includes(hostname)) {
        this.defaultWhitelist.push(hostname);
      }
    }
  }
}
