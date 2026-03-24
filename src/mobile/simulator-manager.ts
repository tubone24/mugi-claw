import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

interface SimctlListResult {
  devices: Record<string, SimctlDevice[]>;
}

export class SimulatorManager {
  constructor(private logger: Logger) {}

  /** 利用可能なデバイス一覧を取得 */
  async listDevices(): Promise<SimDevice[]> {
    const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
    const result = JSON.parse(stdout) as SimctlListResult;
    const devices: SimDevice[] = [];

    for (const [runtime, deviceList] of Object.entries(result.devices)) {
      for (const device of deviceList) {
        if (device.isAvailable) {
          devices.push({
            udid: device.udid,
            name: device.name,
            state: device.state,
            runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', ''),
          });
        }
      }
    }

    return devices;
  }

  /** デバイスを起動 */
  async boot(udid?: string): Promise<string> {
    const target = udid ?? (await this.findDefaultDevice());
    if (!target) {
      throw new Error('利用可能な iOS Simulator が見つからない');
    }

    const devices = await this.listDevices();
    const device = devices.find((d) => d.udid === target);
    if (device?.state === 'Booted') {
      this.logger.info({ udid: target, name: device.name }, 'Simulator は既に起動中');
      return target;
    }

    this.logger.info({ udid: target }, 'Simulator 起動中...');
    await execFileAsync('xcrun', ['simctl', 'boot', target]);

    // Simulator.app も開く
    await execFileAsync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', target]);

    this.logger.info({ udid: target }, 'Simulator 起動完了');
    return target;
  }

  /** 起動中のシミュレータを停止 */
  async shutdown(): Promise<void> {
    try {
      await execFileAsync('xcrun', ['simctl', 'shutdown', 'booted']);
      this.logger.info('Simulator 停止');
    } catch {
      this.logger.info('停止する Simulator なし');
    }
  }

  /** 起動中かチェック */
  async isBooted(): Promise<boolean> {
    const devices = await this.listDevices();
    return devices.some((d) => d.state === 'Booted');
  }

  /** 起動中のデバイスUDIDを取得 */
  async getBootedDeviceUdid(): Promise<string | null> {
    const devices = await this.listDevices();
    return devices.find((d) => d.state === 'Booted')?.udid ?? null;
  }

  /** デフォルトデバイスを探す（iPhone優先） */
  private async findDefaultDevice(): Promise<string | null> {
    const devices = await this.listDevices();

    // 既に起動中のデバイスがあればそれを返す
    const booted = devices.find((d) => d.state === 'Booted');
    if (booted) return booted.udid;

    // iPhone を優先的に探す
    const iphone = devices.find((d) => d.name.includes('iPhone') && d.runtime.includes('iOS'));
    if (iphone) return iphone.udid;

    // 何でもいいので返す
    return devices[0]?.udid ?? null;
  }
}
