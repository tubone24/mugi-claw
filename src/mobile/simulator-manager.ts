import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

export interface EmulatorDevice {
  id: string;
  name: string;
  state: string;
  platform: 'android';
}

const ANDROID_SDK_ROOT =
  process.env['ANDROID_SDK_ROOT'] ??
  process.env['ANDROID_HOME'] ??
  '/usr/local/share/android-commandlinetools';

function adbPath(): string {
  return process.env['ADB_PATH'] ?? 'adb';
}

function emulatorPath(): string {
  return `${ANDROID_SDK_ROOT}/emulator/emulator`;
}

export class EmulatorManager {
  constructor(private logger: Logger) {}

  /** 利用可能なAVD一覧を取得 */
  async listAvds(): Promise<string[]> {
    const { stdout } = await execFileAsync(emulatorPath(), ['-list-avds']);
    return stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0);
  }

  /** 接続中デバイス一覧を取得 */
  async listDevices(): Promise<EmulatorDevice[]> {
    const { stdout } = await execFileAsync(adbPath(), ['devices', '-l']);
    const devices: EmulatorDevice[] = [];

    for (const line of stdout.split('\n')) {
      const match = line.match(/^([\w\-.:]+)\s+device\s+(.*)$/);
      if (!match?.[1]) continue;

      const id = match[1];
      const props = match[2] ?? '';

      // デバイス名を取得
      let name = id;
      const modelMatch = props.match(/model:(\S+)/);
      if (modelMatch?.[1]) {
        name = modelMatch[1].replace(/_/g, ' ');
      }

      devices.push({
        id,
        name,
        state: 'online',
        platform: 'android',
      });
    }

    return devices;
  }

  /** エミュレータを起動 */
  async boot(avdName?: string): Promise<string> {
    const target = avdName ?? (await this.findDefaultAvd());
    if (!target) {
      throw new Error('利用可能な Android AVD が見つからない');
    }

    // 既に起動中か確認
    const devices = await this.listDevices();
    if (devices.some((d) => d.id.startsWith('emulator-'))) {
      this.logger.info('Emulator は既に起動中');
      return target;
    }

    this.logger.info({ avd: target }, 'Emulator 起動中...');
    const child = execFile(
      emulatorPath(),
      ['-avd', target, '-no-snapshot-load', '-gpu', 'auto'],
      { timeout: 0 },
    );
    child.unref();

    // 起動待ち（最大60秒）
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { stdout } = await execFileAsync(adbPath(), [
          'shell',
          'getprop',
          'sys.boot_completed',
        ]);
        if (stdout.trim() === '1') {
          this.logger.info({ avd: target }, 'Emulator 起動完了');
          return target;
        }
      } catch {
        // まだ起動中
      }
    }

    throw new Error(`Emulator 起動タイムアウト: ${target}`);
  }

  /** 起動中のエミュレータを停止 */
  async shutdown(): Promise<void> {
    try {
      await execFileAsync(adbPath(), ['emu', 'kill']);
      this.logger.info('Emulator 停止');
    } catch {
      this.logger.info('停止する Emulator なし');
    }
  }

  /** 起動中かチェック */
  async isBooted(): Promise<boolean> {
    const devices = await this.listDevices();
    return devices.some((d) => d.id.startsWith('emulator-'));
  }

  /** デフォルトAVDを探す（PlayStore付き優先） */
  private async findDefaultAvd(): Promise<string | null> {
    const avds = await this.listAvds();
    if (avds.length === 0) return null;

    // PlayStore付きを優先
    const playStore = avds.find((a) =>
      a.toLowerCase().includes('playstore'),
    );
    if (playStore) return playStore;

    return avds[0] ?? null;
  }
}
