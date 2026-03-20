import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { ApprovalManager } from './approval-manager.js';

export class ApprovalServer {
  private server: Server;

  constructor(
    private approvalManager: ApprovalManager,
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
      this.handleApproval(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private handleApproval(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { void this.processApproval(body, res); });
  }

  private async processApproval(body: string, res: ServerResponse): Promise<void> {
    try {
      const data = JSON.parse(body) as {
        tool_name?: string;
        tool_input?: Record<string, unknown>;
        session_id?: string;
      };
      const toolName = data.tool_name ?? 'unknown';
      const toolInput = data.tool_input ?? {};
      const sessionId = data.session_id;

      this.logger.info({ toolName }, 'ツール承認リクエスト受信');
      const approved = await this.approvalManager.requestApproval(toolName, toolInput, sessionId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approved }));
    } catch (err) {
      this.logger.error({ err }, '承認リクエスト処理エラー');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }
}
