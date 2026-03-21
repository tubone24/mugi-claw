import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR_BASE = '/tmp/mugi-claw/screenshots';
const APPROVAL_PORT = process.env['APPROVAL_PORT'] ?? '3456';
const APPROVAL_CHANNEL = process.env['APPROVAL_CHANNEL'] ?? '';
const APPROVAL_THREAD_TS = process.env['APPROVAL_THREAD_TS'] ?? '';

// スレッドごとにスクリーンショットディレクトリを分離
const THREAD_ID = APPROVAL_THREAD_TS.replace(/\./g, '-') || 'default';
const SCREENSHOT_DIR = `${SCREENSHOT_DIR_BASE}/${THREAD_ID}`;

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

let browser: Browser | null = null;
let page: Page | null = null;

/** CDP経由でブラウザに接続し、このプロセス専用のPageを取得する */
async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) {
    return page;
  }

  if (!browser || !browser.isConnected()) {
    const cdpUrl = process.env['CDP_URL'] ?? DEFAULT_CDP_URL;
    browser = await chromium.connectOverCDP(cdpUrl);
  }

  // 各MCPプロセスは専用の新しいページ（タブ）を作成する
  // これにより複数スレッドが同時にブラウザを操作しても干渉しない
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  page = await context.newPage();
  return page;
}

/** MCP Server を構築する */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'mugi-claw-browser',
    version: '0.1.0',
  });

  // --- browser_navigate ---
  server.registerTool(
    'browser_navigate',
    {
      description: '指定URLにページ遷移する',
      inputSchema: {
        url: z.string().url().describe('遷移先のURL'),
      },
    },
    async ({ url }) => {
      const p = await getPage();
      const response = await p.goto(url, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      const title = await p.title();
      return {
        content: [
          {
            type: 'text' as const,
            text: `Navigated to ${url} (status: ${status}, title: "${title}")`,
          },
        ],
      };
    },
  );

  // --- browser_click ---
  server.registerTool(
    'browser_click',
    {
      description: '指定セレクタの要素をクリックする',
      inputSchema: {
        selector: z.string().describe('クリック対象のCSSセレクタ'),
      },
    },
    async ({ selector }) => {
      const p = await getPage();
      await p.click(selector);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Clicked: ${selector}`,
          },
        ],
      };
    },
  );

  // --- browser_type ---
  server.registerTool(
    'browser_type',
    {
      description: '指定セレクタの要素にテキストを入力する。パスワード等の機密情報の入力には browser_secure_input を使うこと。',
      inputSchema: {
        selector: z.string().describe('入力対象のCSSセレクタ'),
        text: z.string().describe('入力するテキスト'),
      },
    },
    async ({ selector, text }) => {
      const p = await getPage();
      await p.fill(selector, text);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Typed "${text}" into ${selector}`,
          },
        ],
      };
    },
  );

  // --- browser_screenshot ---
  server.registerTool(
    'browser_screenshot',
    {
      description: '現在のページのスクリーンショットを取得する。スクリーンショットは自動的にSlackスレッドにアップロードされるため、Bashでのアップロード操作は不要。',
    },
    async () => {
      const p = await getPage();
      const buffer = await p.screenshot({ fullPage: false });
      const base64 = buffer.toString('base64');

      // ファイルに保存してSlackにアップロード
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const filePath = `${SCREENSHOT_DIR}/browser-screenshot-${Date.now()}.png`;
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
    },
  );

  // --- browser_get_text ---
  server.registerTool(
    'browser_get_text',
    {
      description:
        'ページまたは指定セレクタのテキストを取得する（selector省略時はページ全体）',
      inputSchema: {
        selector: z
          .string()
          .optional()
          .describe('テキスト取得対象のCSSセレクタ（省略時はページ全体）'),
      },
    },
    async ({ selector }) => {
      const p = await getPage();
      let text: string;
      if (selector) {
        text = await p.textContent(selector) ?? '';
      } else {
        text = await p.textContent('body') ?? '';
      }
      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      };
    },
  );

  // --- browser_wait ---
  server.registerTool(
    'browser_wait',
    {
      description: '指定セレクタの要素が表示されるまで待機する',
      inputSchema: {
        selector: z.string().describe('待機対象のCSSセレクタ'),
        timeout: z
          .number()
          .optional()
          .default(30000)
          .describe('タイムアウト（ミリ秒、デフォルト30000）'),
      },
    },
    async ({ selector, timeout }) => {
      const p = await getPage();
      await p.waitForSelector(selector, { timeout });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Element found: ${selector}`,
          },
        ],
      };
    },
  );

  // --- browser_evaluate ---
  server.registerTool(
    'browser_evaluate',
    {
      description: 'ページ上でJavaScriptを実行し結果を返す',
      inputSchema: {
        script: z.string().describe('実行するJavaScriptコード'),
      },
    },
    async ({ script }) => {
      const p = await getPage();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await p.evaluate(script);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // --- browser_secure_input ---
  server.registerTool(
    'browser_secure_input',
    {
      description:
        'パスワードやOTP等の機密情報をユーザーに安全に入力してもらう。入力はローカルWeb UI経由で行われ、LLMのコンテキストには機密情報が含まれない。先にbrowser_screenshotやbrowser_get_textでフォーム構造を確認し、適切なCSSセレクタとラベルを指定すること。',
      inputSchema: {
        site: z.string().describe('ログイン対象のサイト名またはURL'),
        fields: z
          .array(
            z.object({
              selector: z.string().describe('入力対象のCSSセレクタ'),
              label: z.string().describe('フィールドのラベル（Web UIで表示）'),
              sensitive: z
                .boolean()
                .optional()
                .default(false)
                .describe('パスワード等の機密フィールドか'),
            }),
          )
          .describe('入力が必要なフィールドの一覧'),
      },
    },
    async ({ site, fields }) => {
      try {
        // AbortControllerで6分タイムアウト（ApprovalServer側は5分）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6 * 60 * 1000);

        let response: Response;
        try {
          // ApprovalServerにクレデンシャル入力リクエストを送信（ブロッキング）
          response = await fetch(
            `http://127.0.0.1:${APPROVAL_PORT}/api/credential-request`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                site,
                fields,
                approval_channel: APPROVAL_CHANNEL,
                approval_thread_ts: APPROVAL_THREAD_TS,
              }),
              signal: controller.signal,
            },
          );
        } finally {
          clearTimeout(timeoutId);
        }

        const result = (await response.json()) as {
          success: boolean;
          values?: Record<string, string>;
          error?: string;
        };

        if (!result.success || !result.values) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Secure input failed: ${result.error ?? 'unknown error'}`,
              },
            ],
          };
        }

        // ブラウザの各フィールドに値を入力
        const p = await getPage();
        let filledCount = 0;
        // result から値を取り出し、元の参照を切る
        let values: Record<string, string> | null = result.values;
        (result as { values?: unknown }).values = undefined;

        try {
          for (const field of fields) {
            const value = values[field.selector];
            if (value !== undefined) {
              await p.fill(field.selector, value);
              filledCount++;
            }
          }
        } finally {
          // 値を即座に破棄（GC対象にする）
          values = null;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Secure input completed: ${filledCount} field(s) filled on ${site}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Secure input error: ${message}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

/** MCP Server を起動する */
export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // プロセス終了時に専用ページを閉じてブラウザを切断
  const cleanup = async (): Promise<void> => {
    // 先にこのプロセスが作成したページ（タブ）を閉じる
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
      page = null;
    }
    if (browser) {
      // connectOverCDP の場合は close ではなく disconnect で切断
      // （Chromeプロセスは終了させない）
      browser.close().catch(() => {});
      browser = null;
    }
  };

  process.on('SIGINT', () => {
    void cleanup();
  });
  process.on('SIGTERM', () => {
    void cleanup();
  });
}

// 直接実行された場合はサーバーを起動
const isDirectRun =
  process.argv[1]?.endsWith('mcp-server.js') ||
  process.argv[1]?.endsWith('mcp-server.ts');

if (isDirectRun) {
  startMcpServer().catch((err: unknown) => {
    console.error('MCP Server 起動エラー:', err);
    process.exit(1);
  });
}
