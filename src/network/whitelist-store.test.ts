import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/database.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
  })),
}));

import { WhitelistStore } from './whitelist-store.js';
import { getDb } from '../db/database.js';

describe('WhitelistStore', () => {
  let store: WhitelistStore;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('default whitelist', () => {
    it('allows a hostname that is in the default whitelist', () => {
      store = new WhitelistStore(['example.com']);
      expect(store.isAllowed('example.com')).toBe(true);
    });

    it('rejects a hostname not in the default whitelist', () => {
      store = new WhitelistStore(['example.com']);
      expect(store.isAllowed('evil.com')).toBe(false);
    });
  });

  describe('wildcard matching', () => {
    it('matches subdomains against a wildcard pattern', () => {
      store = new WhitelistStore(['*.googleapis.com']);
      expect(store.isAllowed('storage.googleapis.com')).toBe(true);
    });

    it('matches the exact suffix domain for a wildcard pattern', () => {
      store = new WhitelistStore(['*.googleapis.com']);
      expect(store.isAllowed('googleapis.com')).toBe(true);
    });

    it('does not match unrelated domains against a wildcard pattern', () => {
      store = new WhitelistStore(['*.googleapis.com']);
      expect(store.isAllowed('evil.com')).toBe(false);
    });

    it('matches deeply nested subdomains against a wildcard', () => {
      store = new WhitelistStore(['*.googleapis.com']);
      expect(store.isAllowed('a.b.storage.googleapis.com')).toBe(true);
    });
  });

  describe('addTemporary', () => {
    it('allows a hostname after adding it temporarily', () => {
      store = new WhitelistStore();
      store.addTemporary('temp.com');
      expect(store.isAllowed('temp.com')).toBe(true);
    });

    it('does not persist temporary entries to the database', () => {
      store = new WhitelistStore();
      store.addTemporary('temp.com');
      expect(getDb).not.toHaveBeenCalled();
    });
  });

  describe('unknown host', () => {
    it('rejects an unknown hostname', () => {
      store = new WhitelistStore();
      expect(store.isAllowed('evil.com')).toBe(false);
    });
  });

  describe('port specificity', () => {
    it('allows the exact port that was added', () => {
      store = new WhitelistStore();
      store.addTemporary('api.com', 443);
      expect(store.isAllowed('api.com', 443)).toBe(true);
    });

    it('allows wildcard port lookup when added with a specific port via fallback to hostname:*', () => {
      store = new WhitelistStore();
      store.addTemporary('api.com', 443);
      // isAllowed checks hostname:80 first, then falls back to hostname:*
      // Since we added api.com with port=443, the key is "api.com:443"
      // Checking port 80 looks for "api.com:80" and "api.com:*" — neither matches
      expect(store.isAllowed('api.com', 80)).toBe(false);
    });

    it('allows any port when added without a specific port (wildcard)', () => {
      store = new WhitelistStore();
      store.addTemporary('api.com'); // key becomes "api.com:*"
      expect(store.isAllowed('api.com', 443)).toBe(true);
      expect(store.isAllowed('api.com', 80)).toBe(true);
      expect(store.isAllowed('api.com')).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes a temporary entry so it is no longer allowed', () => {
      store = new WhitelistStore();
      store.addTemporary('temp.com');
      expect(store.isAllowed('temp.com')).toBe(true);

      store.remove('temp.com');
      expect(store.isAllowed('temp.com')).toBe(false);
    });

    it('calls the database to delete the entry on remove', () => {
      store = new WhitelistStore();
      store.addTemporary('temp.com');
      store.remove('temp.com');

      const mockDb = vi.mocked(getDb);
      expect(mockDb).toHaveBeenCalled();
      const db = mockDb.mock.results[0]!.value;
      expect(db.prepare).toHaveBeenCalled();
    });

    it('removes a port-specific entry without affecting other ports', () => {
      store = new WhitelistStore();
      store.addTemporary('api.com', 443);
      store.addTemporary('api.com', 80);

      store.remove('api.com', 443);
      expect(store.isAllowed('api.com', 443)).toBe(false);
      expect(store.isAllowed('api.com', 80)).toBe(true);
    });
  });

  describe('loadCache', () => {
    it('calls getDb and loads rows into the permanent cache', () => {
      const mockRows = [
        { hostname: 'cached.com', port: null },
        { hostname: 'cached2.com', port: 8080 },
      ];
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          all: vi.fn(() => mockRows),
          run: vi.fn(),
        })),
      } as any);

      store = new WhitelistStore();
      store.loadCache();

      expect(store.isAllowed('cached.com')).toBe(true);
      expect(store.isAllowed('cached2.com', 8080)).toBe(true);
      expect(store.isAllowed('cached2.com', 9999)).toBe(false);
    });
  });

  describe('addPermanent', () => {
    it('adds to permanent cache and calls the database', () => {
      const mockRun = vi.fn();
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          run: mockRun,
        })),
      } as any);

      store = new WhitelistStore();
      store.addPermanent('perm.com', 'user1', 443, 'API access');

      expect(store.isAllowed('perm.com', 443)).toBe(true);
      expect(mockRun).toHaveBeenCalledWith('perm.com', 443, 'user1', 'API access');
    });
  });

  describe('list', () => {
    it('returns default, temporary, and permanent entries', () => {
      const mockRows = [
        {
          id: 1,
          hostname: 'db-host.com',
          port: null,
          is_permanent: 1,
          approved_by: 'admin',
          purpose: 'testing',
          created_at: '2025-01-01T00:00:00Z',
          expires_at: null,
        },
      ];
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          all: vi.fn(() => mockRows),
          run: vi.fn(),
        })),
      } as any);

      store = new WhitelistStore(['default.com']);
      store.addTemporary('temp.com', 443);

      const entries = store.list();

      // Should include: 1 DB row + 1 temporary + 1 default = 3
      expect(entries).toHaveLength(3);

      const dbEntry = entries.find((e) => e.hostname === 'db-host.com');
      expect(dbEntry).toBeDefined();
      expect(dbEntry!.isPermanent).toBe(true);
      expect(dbEntry!.approvedBy).toBe('admin');

      const tempEntry = entries.find((e) => e.hostname === 'temp.com');
      expect(tempEntry).toBeDefined();
      expect(tempEntry!.isPermanent).toBe(false);

      const defaultEntry = entries.find((e) => e.hostname === 'default.com');
      expect(defaultEntry).toBeDefined();
      expect(defaultEntry!.approvedBy).toBe('system');
      expect(defaultEntry!.purpose).toBe('default whitelist');
    });
  });

  describe('seedDefaults', () => {
    it('inserts each default hostname into the database and reloads cache', () => {
      const mockRun = vi.fn();
      const mockAll = vi.fn(() => []);
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          all: mockAll,
          run: mockRun,
        })),
      } as any);

      store = new WhitelistStore(['a.com', 'b.com']);
      store.seedDefaults();

      // run() called once per default hostname for INSERT + once for SELECT in loadCache
      expect(mockRun).toHaveBeenCalledWith('a.com');
      expect(mockRun).toHaveBeenCalledWith('b.com');
    });
  });
});
