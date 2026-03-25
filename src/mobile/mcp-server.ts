import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';

const execFileAsync = promisify(execFile);

const SCREENSHOT_DIR = '/tmp/mugi-claw/screenshots';
const APPROVAL_PORT = process.env['APPROVAL_PORT'] ?? '3456';
const APPROVAL_CHANNEL = process.env['APPROVAL_CHANNEL'] ?? '';
const APPROVAL_THREAD_TS = process.env['APPROVAL_THREAD_TS'] ?? '';

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

async function uploadScreenshotToSlack(filePath: string): Promise<void> {
  if (!APPROVAL_CHANNEL || !APPROVAL_THREAD_TS) return;
  try {
    await fetch(`http://127.0.0.1:${APPROVAL_PORT}/api/upload-screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_path: filePath,
        channel: APPROVAL_CHANNEL,
        thread_ts: APPROVAL_THREAD_TS,
      }),
    });
  } catch {
    // Slack アップロード失敗は無視
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'mugi-claw-mobile',
    version: '0.2.0',
  });

  // --- スクリーンショット撮影 + Slackアップロード ---
  server.registerTool(
    'mobile_screenshot_slack',
    {
      description:
        'Android Emulatorのスクリーンショットを撮影し、Slackスレッドに自動アップロードする。スクリーンショットはLLMコンテキストにも画像として返される。',
    },
    async () => {
      try {
        await mkdir(SCREENSHOT_DIR, { recursive: true });
        const filePath = `${SCREENSHOT_DIR}/mobile-${Date.now()}.png`;

        const { writeFile, readFile } = await import('node:fs/promises');
        const result = await execFileAsync(adbPath(), ['exec-out', 'screencap', '-p'], {
          encoding: 'buffer' as BufferEncoding,
          maxBuffer: 20 * 1024 * 1024,
        });
        await writeFile(filePath, result.stdout);

        const buffer = await readFile(filePath);
        const base64 = buffer.toString('base64');

        await uploadScreenshotToSlack(filePath);

        return {
          content: [
            {
              type: 'image' as const,
              data: base64,
              mimeType: 'image/png',
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `モバイルスクリーンショットエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- 機微情報のセキュア入力 ---
  server.registerTool(
    'mobile_secure_input',
    {
      description:
        'パスワードやOTP等の機密情報をAndroid Emulatorに安全に入力する。ローカルWebフォームを開き、ユーザーが入力した内容をadb shell input経由でエミュレータに送信する。LLMコンテキストに機密情報は載らない。',
      inputSchema: {
        label: z
          .string()
          .describe('入力フィールドの説明（例: "Googleパスワード", "OTPコード"）'),
        site: z
          .string()
          .optional()
          .describe('入力対象のサービス名/URL（表示用）'),
        submit: z
          .boolean()
          .optional()
          .describe('入力後にEnterキーを送信するか（デフォルト: false）'),
      },
    },
    async ({ label, site, submit }) => {
      try {
        const inputPromise = new Promise<string>((resolve, reject) => {
          const httpServer = createHttpServer((req, res) => {
            if (req.method === 'GET' && req.url === '/') {
              const siteDisplay = site ? `<p style="color:#666;margin:0 0 20px 0;">対象: ${site}</p>` : '';
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html>
<html><head><title>Secure Input - mugi-claw</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
  h2 { margin: 0 0 8px 0; color: #333; }
  input[type=password], input[type=text] { width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; box-sizing: border-box; margin: 12px 0; }
  input:focus { border-color: #4285f4; outline: none; }
  button { width: 100%; padding: 12px; background: #4285f4; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
  button:hover { background: #3367d6; }
  .toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 14px; color: #666; cursor: pointer; }
  .success { text-align: center; color: #34a853; }
</style></head>
<body><div class="card" id="form-card">
  <h2>${label}</h2>
  ${siteDisplay}
  <form id="f" onsubmit="return send()">
    <input type="password" id="val" placeholder="${label}" autofocus />
    <label class="toggle"><input type="checkbox" onchange="toggleVis()"> 表示する</label>
    <button type="submit">送信</button>
  </form>
</div>
<script>
function toggleVis() { const i = document.getElementById('val'); i.type = i.type === 'password' ? 'text' : 'password'; }
async function send() {
  const v = document.getElementById('val').value;
  if (!v) return false;
  try {
    const r = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: v }) });
    if (r.ok) {
      document.getElementById('form-card').innerHTML = '<div class="success"><h2>✓ 入力完了</h2><p>このタブは閉じて構いません</p></div>';
    }
  } catch(e) { alert('エラー: ' + e.message); }
  return false;
}
</script></body></html>`);
            } else if (req.method === 'POST' && req.url === '/submit') {
              let body = '';
              req.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              req.on('end', () => {
                try {
                  const parsed = JSON.parse(body) as { value: string };
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: true }));
                  httpServer.close();
                  resolve(parsed.value);
                } catch {
                  res.writeHead(400);
                  res.end('Bad request');
                }
              });
            } else {
              res.writeHead(404);
              res.end('Not found');
            }
          });

          // ランダムポートで起動
          httpServer.listen(0, '127.0.0.1', () => {
            const addr = httpServer.address();
            if (addr && typeof addr === 'object') {
              const url = `http://127.0.0.1:${addr.port}/`;
              // ブラウザでフォームを開く
              execFile('open', [url]);
            }
          });

          // 5分でタイムアウト
          setTimeout(() => {
            httpServer.close();
            reject(new Error('入力タイムアウト（5分）'));
          }, 300_000);
        });

        const value = await inputPromise;

        // adb shell input text でエミュレータに入力（特殊文字をエスケープ）
        const escaped = value.replace(/([\\'"$ `!#&|;(){}[\]<>*?~])/g, '\\$1');
        await execFileAsync(adbPath(), ['shell', 'input', 'text', escaped]);

        if (submit) {
          await execFileAsync(adbPath(), ['shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `セキュア入力完了: ${label}（内容はLLMコンテキストに含まれません）`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `セキュア入力エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- Android Emulator 起動 ---
  server.registerTool(
    'mobile_emulator_boot',
    {
      description:
        'Android Emulatorを起動する。AVD名を省略するとPlay Store付きデバイスを自動選択する。',
      inputSchema: {
        avd_name: z
          .string()
          .optional()
          .describe('起動するAVDの名前（省略時は自動選択）'),
      },
    },
    async ({ avd_name }) => {
      try {
        let targetAvd = avd_name;

        if (!targetAvd) {
          // AVD一覧から自動選択
          const { stdout } = await execFileAsync(emulatorPath(), ['-list-avds']);
          const avds = stdout
            .trim()
            .split('\n')
            .filter((l) => l.trim().length > 0);
          if (avds.length === 0) {
            return {
              content: [
                { type: 'text' as const, text: '利用可能なAVDが見つからない' },
              ],
            };
          }
          // PlayStore付きを優先
          targetAvd =
            avds.find((a) => a.toLowerCase().includes('playstore')) ?? avds[0];
        }

        // 既に起動中か確認
        try {
          const { stdout: devices } = await execFileAsync(adbPath(), ['devices']);
          if (devices.includes('emulator-')) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Emulatorは既に起動中。AVD: ${targetAvd}`,
                },
              ],
            };
          }
        } catch {
          // adb devices 失敗は無視
        }

        // バックグラウンドで起動（-no-window でヘッドレスも可能だが、UIが見えた方が便利）
        const avdArg = targetAvd as string;
        const child = execFile(
          emulatorPath(),
          ['-avd', avdArg, '-no-snapshot-load', '-gpu', 'auto'],
          { timeout: 0 },
        );
        child.unref();

        // 起動待ち（最大60秒）
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const { stdout: bootProp } = await execFileAsync(adbPath(), [
              'shell',
              'getprop',
              'sys.boot_completed',
            ]);
            if (bootProp.trim() === '1') {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Android Emulator 起動完了 (AVD: ${targetAvd})`,
                  },
                ],
              };
            }
          } catch {
            // まだ起動中
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Emulator 起動中（タイムアウト）。AVD: ${targetAvd} — しばらく待ってから再確認してください`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: 'text' as const, text: `Emulator 起動エラー: ${message}` },
          ],
        };
      }
    },
  );

  // --- Android Emulator 停止 ---
  server.registerTool(
    'mobile_emulator_shutdown',
    {
      description: '起動中のAndroid Emulatorを停止する。',
    },
    async () => {
      try {
        await execFileAsync(adbPath(), ['emu', 'kill']);
        return {
          content: [
            { type: 'text' as const, text: 'Android Emulator 停止完了' },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: 'text' as const, text: `Emulator 停止エラー: ${message}` },
          ],
        };
      }
    },
  );

  // --- AVD 一覧 ---
  server.registerTool(
    'mobile_emulator_list_devices',
    {
      description: '利用可能なAndroid Emulator AVD一覧を取得する。',
    },
    async () => {
      try {
        // AVD一覧
        const { stdout: avdList } = await execFileAsync(emulatorPath(), [
          '-list-avds',
        ]);

        // 起動中デバイス
        let runningDevices = '';
        try {
          const { stdout } = await execFileAsync(adbPath(), ['devices', '-l']);
          runningDevices = stdout;
        } catch {
          // ignore
        }

        const avds = avdList
          .trim()
          .split('\n')
          .filter((l) => l.trim().length > 0);

        if (avds.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: '利用可能なAVDなし' },
            ],
          };
        }

        const lines = ['## 利用可能なAVD'];
        for (const avd of avds) {
          const isRunning = runningDevices.includes('emulator-');
          const status = isRunning ? ' [起動中]' : '';
          lines.push(`- ${avd}${status}`);
        }

        if (runningDevices.trim()) {
          lines.push('', '## 接続中デバイス', runningDevices.trim());
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `AVD一覧取得エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

export async function startMobileMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (
  process.argv[1]?.endsWith('mcp-server.ts') ||
  process.argv[1]?.endsWith('mcp-server.js')
) {
  startMobileMcpServer().catch((err: unknown) => {
    console.error('Mobile MCP Server 起動エラー:', err);
    process.exit(1);
  });
}
