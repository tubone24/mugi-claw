import { spawn, type ChildProcess } from 'node:child_process';
import { platform, homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Logger } from 'pino';

export class ChromeLauncher {
  private chromeProcess: ChildProcess | null = null;

  constructor(
    private port: number,
    private userDataDir: string,
    private logger: Logger,
  ) {
    // ~ をホームディレクトリに展開
    if (this.userDataDir.startsWith('~')) {
      this.userDataDir = resolve(homedir(), this.userDataDir.slice(2));
    }
  }

  /** Chrome起動（既存プロセスがあれば再利用） */
  async launch(): Promise<void> {
    if (await this.isRunning()) {
      this.logger.info('Chrome は既に起動中');
      return;
    }

    const chromePath = this.findChromePath();
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ];

    this.logger.info({ chromePath, port: this.port }, 'Chrome 起動中...');

    this.chromeProcess = spawn(chromePath, args, {
      stdio: 'ignore',
      detached: true,
    });
    this.chromeProcess.unref();

    // 起動待ち
    await this.waitForReady(10000);
    this.logger.info('Chrome 起動完了');
  }

  /** ヘルスチェック */
  async isRunning(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** CDP WebSocket URL取得 */
  async getWebSocketUrl(): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
    const data = (await res.json()) as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }

  /** 停止 */
  async stop(): Promise<void> {
    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
      this.logger.info('Chrome 停止');
    }
  }

  private findChromePath(): string {
    const os = platform();
    if (os === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }
    if (os === 'linux') {
      return 'google-chrome-stable';
    }
    // Windows
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isRunning()) return;
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    throw new Error(`Chrome が ${timeoutMs}ms 以内に起動しなかった`);
  }
}
