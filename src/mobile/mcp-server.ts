import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const SCREENSHOT_DIR = '/tmp/mugi-claw/screenshots';
const APPROVAL_PORT = process.env['APPROVAL_PORT'] ?? '3456';
const APPROVAL_CHANNEL = process.env['APPROVAL_CHANNEL'] ?? '';
const APPROVAL_THREAD_TS = process.env['APPROVAL_THREAD_TS'] ?? '';

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
    version: '0.1.0',
  });

  // --- スクリーンショット撮影 + Slackアップロード ---
  server.registerTool(
    'mobile_screenshot_slack',
    {
      description:
        'iOS Simulatorのスクリーンショットを撮影し、Slackスレッドに自動アップロードする。スクリーンショットはLLMコンテキストにも画像として返される。',
    },
    async () => {
      try {
        await mkdir(SCREENSHOT_DIR, { recursive: true });
        const filePath = `${SCREENSHOT_DIR}/mobile-${Date.now()}.png`;

        await execFileAsync('xcrun', ['simctl', 'io', 'booted', 'screenshot', filePath]);

        const { readFile } = await import('node:fs/promises');
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

  // --- Simulator 起動 ---
  server.registerTool(
    'mobile_simulator_boot',
    {
      description: 'iOS Simulatorを起動する。UDIDを省略するとiPhoneデバイスを自動選択する。',
      inputSchema: {
        udid: z.string().optional().describe('起動するデバイスのUDID（省略時は自動選択）'),
      },
    },
    async ({ udid }) => {
      try {
        if (udid) {
          await execFileAsync('xcrun', ['simctl', 'boot', udid]);
          await execFileAsync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid]);
        } else {
          // デフォルトデバイスを探す
          const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
          const result = JSON.parse(stdout) as {
            devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable: boolean }>>;
          };

          let targetUdid: string | null = null;

          for (const [runtime, deviceList] of Object.entries(result.devices)) {
            if (!runtime.includes('iOS')) continue;
            for (const device of deviceList) {
              if (device.isAvailable && device.state !== 'Booted' && device.name.includes('iPhone')) {
                targetUdid = device.udid;
                break;
              }
            }
            if (targetUdid) break;
          }

          if (!targetUdid) {
            return {
              content: [{ type: 'text' as const, text: '利用可能なiPhoneシミュレータが見つからない' }],
            };
          }

          await execFileAsync('xcrun', ['simctl', 'boot', targetUdid]);
          await execFileAsync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', targetUdid]);
          udid = targetUdid;
        }

        return {
          content: [{ type: 'text' as const, text: `Simulator 起動完了 (UDID: ${udid})` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Simulator 起動エラー: ${message}` }],
        };
      }
    },
  );

  // --- Simulator 停止 ---
  server.registerTool(
    'mobile_simulator_shutdown',
    {
      description: '起動中のiOS Simulatorを停止する。',
    },
    async () => {
      try {
        await execFileAsync('xcrun', ['simctl', 'shutdown', 'booted']);
        return {
          content: [{ type: 'text' as const, text: 'Simulator 停止完了' }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Simulator 停止エラー: ${message}` }],
        };
      }
    },
  );

  // --- デバイス一覧 ---
  server.registerTool(
    'mobile_simulator_list_devices',
    {
      description: '利用可能なiOS Simulatorデバイス一覧を取得する。',
    },
    async () => {
      try {
        const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
        const result = JSON.parse(stdout) as {
          devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable: boolean }>>;
        };

        const lines: string[] = [];
        for (const [runtime, deviceList] of Object.entries(result.devices)) {
          const available = deviceList.filter((d) => d.isAvailable);
          if (available.length === 0) continue;

          const runtimeName = runtime.replace('com.apple.CoreSimulator.SimRuntime.', '');
          lines.push(`\n## ${runtimeName}`);
          for (const device of available) {
            const status = device.state === 'Booted' ? ' [起動中]' : '';
            lines.push(`- ${device.name} (${device.udid})${status}`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') || 'デバイスなし' }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `デバイス一覧取得エラー: ${message}` }],
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

if (process.argv[1]?.endsWith('mcp-server.ts') || process.argv[1]?.endsWith('mcp-server.js')) {
  startMobileMcpServer().catch((err: unknown) => {
    console.error('Mobile MCP Server 起動エラー:', err);
    process.exit(1);
  });
}
