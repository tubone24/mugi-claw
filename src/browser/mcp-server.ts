import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR = '/tmp/mugi-claw/screenshots';
const APPROVAL_PORT = process.env['APPROVAL_PORT'] ?? '3456';
const APPROVAL_CHANNEL = process.env['APPROVAL_CHANNEL'] ?? '';
const APPROVAL_THREAD_TS = process.env['APPROVAL_THREAD_TS'] ?? '';

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

/** CDP経由でブラウザに接続し、操作用のPageを取得する */
async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) {
    return page;
  }

  if (!browser || !browser.isConnected()) {
    const cdpUrl = process.env['CDP_URL'] ?? DEFAULT_CDP_URL;
    browser = await chromium.connectOverCDP(cdpUrl);
  }

  // 既存のコンテキストの最初のページを使用。なければ新規作成
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    const pages = contexts[0]!.pages();
    if (pages.length > 0) {
      page = pages[0]!;
      return page;
    }
  }

  // ページがなければ新規作成
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
      description: '指定セレクタの要素にテキストを入力する',
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

  return server;
}

/** MCP Server を起動する */
export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // プロセス終了時にブラウザを切断
  const cleanup = async (): Promise<void> => {
    if (browser) {
      // connectOverCDP の場合は close ではなく disconnect で切断
      // （Chromeプロセスは終了させない）
      browser.close().catch(() => {});
      browser = null;
      page = null;
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
