import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { Monitor } from 'node-screenshots';

const SCREENSHOT_DIR = '/tmp/mugi-claw/screenshots';
const APPROVAL_PORT = process.env['APPROVAL_PORT'] ?? '3456';
const APPROVAL_CHANNEL = process.env['APPROVAL_CHANNEL'] ?? '';
const APPROVAL_THREAD_TS = process.env['APPROVAL_THREAD_TS'] ?? '';

const execFileAsync = promisify(execFile);
const CLICLICK_PATH = process.env['CLICLICK_PATH'] ?? 'cliclick';

/** スクリーンショットを内部APIでSlackにアップロードする */
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
    // アップロード失敗は致命的ではないので無視
  }
}

/** cliclick のモディファイアキー名に変換する */
function toCliclickModifier(mod: string): string {
  switch (mod) {
    case 'cmd':
      return 'cmd';
    case 'ctrl':
      return 'ctrl';
    case 'alt':
      return 'alt';
    case 'shift':
      return 'shift';
    case 'fn':
      return 'fn';
    default:
      return mod;
  }
}

/** MCP Server を構築する */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'mugi-claw-desktop',
    version: '0.1.0',
  });

  // --- desktop_screenshot ---
  server.registerTool(
    'desktop_screenshot',
    {
      description: 'デスクトップ全体のスクリーンショットを取得する。スクリーンショットは自動的にSlackスレッドにアップロードされるため、Bashでのアップロード操作は不要。',
    },
    async () => {
      try {
        const monitors = Monitor.all();
        if (monitors.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'スクリーンショット取得エラー: モニターが見つかりません',
              },
            ],
          };
        }
        const image = await monitors[0]!.captureImage();
        const pngBuffer = await image.toPng();
        const buffer = Buffer.from(pngBuffer);
        const base64 = buffer.toString('base64');

        // ファイルに保存してSlackにアップロード
        await mkdir(SCREENSHOT_DIR, { recursive: true });
        const filePath = `${SCREENSHOT_DIR}/screenshot-${Date.now()}.png`;
        await writeFile(filePath, buffer);
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
              text: `スクリーンショット取得エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_click ---
  server.registerTool(
    'desktop_click',
    {
      description: '指定座標をクリックする',
      inputSchema: {
        x: z.number().int().describe('クリック位置のX座標'),
        y: z.number().int().describe('クリック位置のY座標'),
      },
    },
    async ({ x, y }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`c:${x},${y}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `クリック: (${x}, ${y})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `クリックエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_right_click ---
  server.registerTool(
    'desktop_right_click',
    {
      description: '指定座標を右クリックする',
      inputSchema: {
        x: z.number().int().describe('右クリック位置のX座標'),
        y: z.number().int().describe('右クリック位置のY座標'),
      },
    },
    async ({ x, y }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`rc:${x},${y}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `右クリック: (${x}, ${y})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `右クリックエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_double_click ---
  server.registerTool(
    'desktop_double_click',
    {
      description: '指定座標をダブルクリックする',
      inputSchema: {
        x: z.number().int().describe('ダブルクリック位置のX座標'),
        y: z.number().int().describe('ダブルクリック位置のY座標'),
      },
    },
    async ({ x, y }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`dc:${x},${y}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `ダブルクリック: (${x}, ${y})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `ダブルクリックエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_type ---
  server.registerTool(
    'desktop_type',
    {
      description: 'テキストをタイプ入力する',
      inputSchema: {
        text: z.string().describe('入力するテキスト'),
      },
    },
    async ({ text }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`t:${text}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `テキスト入力: "${text}"`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `テキスト入力エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_key ---
  server.registerTool(
    'desktop_key',
    {
      description:
        'キーを押下する。利用可能なキー: return, tab, escape, arrow-up, arrow-down, arrow-left, arrow-right, space, delete, home, end, page-up, page-down, fwd-delete',
      inputSchema: {
        key: z.string().describe('押下するキー名'),
      },
    },
    async ({ key }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`kp:${key}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `キー押下: ${key}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `キー押下エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_hotkey ---
  server.registerTool(
    'desktop_hotkey',
    {
      description:
        'モディファイアキーとキーの組み合わせを実行する（例: cmd+c, ctrl+shift+s）',
      inputSchema: {
        modifiers: z
          .array(z.enum(['cmd', 'ctrl', 'alt', 'shift', 'fn']))
          .describe('モディファイアキーの配列'),
        key: z.string().describe('押下するキー名'),
      },
    },
    async ({ modifiers, key }) => {
      try {
        const args: string[] = [];
        // モディファイアキーを順に押下
        for (const mod of modifiers) {
          args.push(`kd:${toCliclickModifier(mod)}`);
        }
        // キーを押下
        args.push(`kp:${key}`);
        // モディファイアキーを逆順で解放
        for (let i = modifiers.length - 1; i >= 0; i--) {
          args.push(`ku:${toCliclickModifier(modifiers[i]!)}`);
        }
        await execFileAsync(CLICLICK_PATH, args);
        return {
          content: [
            {
              type: 'text' as const,
              text: `ホットキー: ${modifiers.join('+')}+${key}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `ホットキーエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_mouse_move ---
  server.registerTool(
    'desktop_mouse_move',
    {
      description: 'マウスカーソルを指定座標に移動する',
      inputSchema: {
        x: z.number().int().describe('移動先のX座標'),
        y: z.number().int().describe('移動先のY座標'),
      },
    },
    async ({ x, y }) => {
      try {
        await execFileAsync(CLICLICK_PATH, [`m:${x},${y}`]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `マウス移動: (${x}, ${y})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `マウス移動エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_scroll ---
  server.registerTool(
    'desktop_scroll',
    {
      description:
        '指定座標でスクロールする（正の値で上スクロール、負の値で下スクロール）',
      inputSchema: {
        x: z.number().int().describe('スクロール位置のX座標'),
        y: z.number().int().describe('スクロール位置のY座標'),
        amount: z
          .number()
          .int()
          .describe('スクロール量（行数）。正=上、負=下'),
      },
    },
    async ({ x, y, amount }) => {
      try {
        // マウスをスクロール位置に移動
        await execFileAsync(CLICLICK_PATH, [`m:${x},${y}`]);
        // CGEvent を使ってスクロール実行
        const script = `
ObjC.import("CoreGraphics");
var e = $.CGEventCreateScrollWheelEvent(null, 1, 1, ${amount});
$.CGEventPost(0, e);
`;
        await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script]);
        return {
          content: [
            {
              type: 'text' as const,
              text: `スクロール: (${x}, ${y}) amount=${amount}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `スクロールエラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_get_screen_info ---
  server.registerTool(
    'desktop_get_screen_info',
    {
      description: 'メインスクリーンの解像度情報を取得する',
    },
    async () => {
      try {
        const script = `
ObjC.import("AppKit");
var screen = $.NSScreen.mainScreen;
var frame = screen.frame;
JSON.stringify({ width: frame.size.width, height: frame.size.height });
`;
        const { stdout } = await execFileAsync('osascript', [
          '-l',
          'JavaScript',
          '-e',
          script,
        ]);
        return {
          content: [
            {
              type: 'text' as const,
              text: stdout.trim(),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `スクリーン情報取得エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_open_app ---
  server.registerTool(
    'desktop_open_app',
    {
      description: '指定したアプリケーションを起動する',
      inputSchema: {
        appName: z.string().describe('起動するアプリケーション名'),
      },
    },
    async ({ appName }) => {
      try {
        await execFileAsync('open', ['-a', appName]);
        // アプリ起動を待つ
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          content: [
            {
              type: 'text' as const,
              text: `アプリ起動: ${appName}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `アプリ起動エラー: ${message}`,
            },
          ],
        };
      }
    },
  );

  // --- desktop_wait ---
  server.registerTool(
    'desktop_wait',
    {
      description: '指定ミリ秒間待機する',
      inputSchema: {
        ms: z
          .number()
          .int()
          .min(100)
          .max(10000)
          .describe('待機時間（ミリ秒、100〜10000）'),
      },
    },
    async ({ ms }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return {
        content: [
          {
            type: 'text' as const,
            text: `${ms}ミリ秒待機完了`,
          },
        ],
      };
    },
  );

  return server;
}

/** Desktop MCP Server を起動する */
export async function startDesktopMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// 直接実行された場合はサーバーを起動
const isDirectRun =
  process.argv[1]?.endsWith('mcp-server.js') ||
  process.argv[1]?.endsWith('mcp-server.ts');

if (isDirectRun) {
  startDesktopMcpServer().catch((err: unknown) => {
    console.error('Desktop MCP Server 起動エラー:', err);
    process.exit(1);
  });
}
