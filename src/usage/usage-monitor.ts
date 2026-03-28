import fs from 'node:fs';
import cron from 'node-cron';
import type { Logger } from 'pino';
import type { WebClient } from '@slack/web-api';

const CACHE_FILE = '/tmp/claude/statusline-usage-cache.json';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5分以上古いデータは stale
const PRESENCE_THRESHOLD = 95; // utilization >= 95% で away

export interface UsageEntry {
  utilization: number | null;
  resets_at: string;
}

export interface ExtraUsageEntry {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

export interface UsageCacheData {
  five_hour: UsageEntry;
  seven_day: UsageEntry;
  seven_day_sonnet?: UsageEntry;
  extra_usage?: ExtraUsageEntry;
}

export interface UsageDisplayData {
  fiveHour: UsageEntry;
  sevenDay: UsageEntry;
  sevenDaySonnet: UsageEntry | null;
  extraUsage: ExtraUsageEntry | null;
  cacheAge: number; // ms since last update
  isStale: boolean;
}

const EMPTY_ENTRY: UsageEntry = { utilization: null, resets_at: '' };

export class UsageMonitor {
  private cronTask: cron.ScheduledTask | null = null;
  private cachedData: UsageDisplayData | null = null;

  constructor(
    private slackClient: WebClient,
    private logger: Logger,
  ) {}

  start(): void {
    // 初回即時実行
    void this.tick();

    // 1分間隔でキャッシュ読み取り + プレゼンス更新
    this.cronTask = cron.schedule('* * * * *', () => {
      void this.tick();
    });

    this.logger.info('UsageMonitor started (1min interval)');
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.logger.info('UsageMonitor stopped');
  }

  getUsageData(): UsageDisplayData | null {
    return this.cachedData;
  }

  private async tick(): Promise<void> {
    try {
      this.cachedData = this.readAndParse();
      await this.updatePresence();
    } catch (err) {
      this.logger.error({ err }, 'UsageMonitor tick failed');
    }
  }

  private readAndParse(): UsageDisplayData | null {
    try {
      if (!fs.existsSync(CACHE_FILE)) {
        this.logger.debug('Usage cache file not found');
        return null;
      }

      const stat = fs.statSync(CACHE_FILE);
      const cacheAge = Date.now() - stat.mtimeMs;
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      const raw = JSON.parse(content) as UsageCacheData;

      return {
        fiveHour: raw.five_hour ?? EMPTY_ENTRY,
        sevenDay: raw.seven_day ?? EMPTY_ENTRY,
        sevenDaySonnet: raw.seven_day_sonnet ?? null,
        extraUsage: raw.extra_usage ?? null,
        cacheAge,
        isStale: cacheAge > STALE_THRESHOLD_MS,
      };
    } catch (err) {
      this.logger.warn({ err }, 'Failed to read usage cache');
      return null;
    }
  }

  private async updatePresence(): Promise<void> {
    if (!this.cachedData) return;

    const fiveHourUtil = this.cachedData.fiveHour.utilization ?? 0;
    const sevenDayUtil = this.cachedData.sevenDay.utilization ?? 0;
    const maxUtil = Math.max(fiveHourUtil, sevenDayUtil);

    const presence = maxUtil >= PRESENCE_THRESHOLD ? 'away' : 'auto';

    try {
      await this.slackClient.users.setPresence({ presence });
      this.logger.debug({ presence, maxUtil }, 'Presence updated');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to update presence');
    }
  }
}
