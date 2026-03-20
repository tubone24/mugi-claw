import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename } from 'node:path';
import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import type { ApprovalManager } from './approval-manager.js';

export class ApprovalServer {
  private server: Server;

  constructor(
    private approvalManager: ApprovalManager,
    private slackClient: WebClient,
    private port: number,
    private logger: Logger,
  ) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        this.logger.info({ port: this.port }, 'Approval HTTP server 起動');
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'POST' && req.url === '/api/approval') {
      this.readBody(req, (body) => { void this.processApproval(body, res); });
    } else if (req.method === 'POST' && req.url === '/api/upload-screenshot') {
      this.readBody(req, (body) => { void this.processScreenshotUpload(body, res); });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private readBody(req: IncomingMessage, callback: (body: string) => void): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { callback(body); });
  }

  private async processApproval(body: string, res: ServerResponse): Promise<void> {
    try {
      const data = JSON.parse(body) as {
        tool_name?: string;
        tool_input?: Record<string, unknown>;
        session_id?: string;
        approval_channel?: string;
        approval_thread_ts?: string;
      };
      const toolName = data.tool_name ?? 'unknown';
      const toolInput = data.tool_input ?? {};
      const sessionId = data.session_id;
      const context = (data.approval_channel && data.approval_thread_ts)
        ? { channel: data.approval_channel, threadTs: data.approval_thread_ts }
        : undefined;

      this.logger.info({ toolName }, 'ツール承認リクエスト受信');
      const approved = await this.approvalManager.requestApproval(toolName, toolInput, sessionId, context);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approved }));
    } catch (err) {
      this.logger.error({ err }, '承認リクエスト処理エラー');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }

  private async processScreenshotUpload(body: string, res: ServerResponse): Promise<void> {
    try {
      const data = JSON.parse(body) as {
        file_path: string;
        channel: string;
        thread_ts: string;
      };

      await access(data.file_path);
      const fileStream = createReadStream(data.file_path);
      const filename = basename(data.file_path);

      await this.slackClient.filesUploadV2({
        channel_id: data.channel,
        thread_ts: data.thread_ts,
        file: fileStream,
        filename,
      });

      this.logger.info({ filePath: data.file_path, channel: data.channel }, 'スクリーンショットSlackアップロード完了');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.logger.error({ err }, 'スクリーンショットアップロードエラー');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Upload failed' }));
    }
  }
}
