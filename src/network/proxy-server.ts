import * as http from 'node:http';
import * as net from 'node:net';
import { URL } from 'node:url';
import type { Logger } from 'pino';
import type { WhitelistStore } from './whitelist-store.js';
import type { NetworkApprovalManager } from './network-approval.js';

interface SessionContext {
  channel: string;
  threadTs: string;
}

export class ProxyServer {
  private server: http.Server;
  private sessionContext: SessionContext | null = null;
  private activeConnections = 0;
  private readonly MAX_CONNECTIONS = 50;
  private onDeniedCallback?: (hostname: string, port: number) => Promise<void> | void;
  private deniedNotifyTimes = new Map<string, number>();
  private readonly NOTIFY_COOLDOWN_MS = 60_000; // 1 minute cooldown per host

  constructor(
    private whitelistStore: WhitelistStore,
    private networkApproval: NetworkApprovalManager,
    private port: number,
    private logger: Logger,
  ) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.on('connect', (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => this.handleConnect(req, clientSocket, head));
    this.server.on('error', (err) => {
      this.logger.error({ err }, 'Proxy server error');
    });
  }

  setSessionContext(context: SessionContext): void {
    this.sessionContext = context;
  }

  clearSessionContext(): void {
    this.sessionContext = null;
  }

  setOnDenied(callback: (hostname: string, port: number) => Promise<void> | void): void {
    this.onDeniedCallback = callback;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        this.logger.info({ port: this.port }, 'Network proxy server started');
        resolve();
      });
      this.server.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('Network proxy server stopped');
        resolve();
      });
    });
  }

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    if (this.activeConnections >= this.MAX_CONNECTIONS) {
      clientSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      return;
    }
    this.activeConnections++;

    const urlParts = (req.url ?? '').split(':');
    const hostname = urlParts[0] ?? '';
    const port = parseInt(urlParts[1] ?? '', 10) || 443;

    this.logger.debug({ hostname, port, method: 'CONNECT' }, 'Proxy CONNECT request');

    let allowed = false;
    try {
      allowed = await this.checkOrApprove(hostname, port);
    } catch (err) {
      this.logger.error({ err, hostname, port }, 'checkOrApprove error - denying');
    }

    if (!allowed) {
      this.logger.warn({ hostname, port }, 'Network access denied');
      this.notifyDenied(hostname, port);
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      this.activeConnections--;
      return;
    }

    this.logger.info({ hostname, port }, 'Network access allowed - establishing tunnel');

    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.setTimeout(300_000);
    clientSocket.setTimeout(300_000);
    serverSocket.on('timeout', () => serverSocket.destroy());
    clientSocket.on('timeout', () => clientSocket.destroy());

    serverSocket.on('error', (err) => {
      this.logger.error({ err, hostname, port }, 'Tunnel connection error');
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      this.logger.error({ err, hostname, port }, 'Client socket error');
      serverSocket.end();
    });

    serverSocket.on('close', () => { this.activeConnections--; });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const socket = req.socket;
    if (this.activeConnections >= this.MAX_CONNECTIONS) {
      res.writeHead(503);
      res.end('Service Unavailable');
      return;
    }
    this.activeConnections++;

    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      this.activeConnections--;
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end('Bad Request: Invalid URL');
      this.activeConnections--;
      return;
    }

    const hostname = targetUrl.hostname;
    const port = parseInt(targetUrl.port, 10) || 80;

    this.logger.debug({ hostname, port, method: req.method, url: req.url }, 'Proxy HTTP request');

    let allowed = false;
    try {
      allowed = await this.checkOrApprove(hostname, port);
    } catch (err) {
      this.logger.error({ err, hostname, port }, 'checkOrApprove error - denying');
    }

    if (!allowed) {
      this.logger.warn({ hostname, port }, 'Network access denied');
      this.notifyDenied(hostname, port);
      res.writeHead(403);
      res.end('Forbidden: Network access not approved');
      this.activeConnections--;
      return;
    }

    this.logger.info({ hostname, port, method: req.method }, 'Network access allowed - proxying');

    socket.setTimeout(300_000);
    socket.on('timeout', () => socket.destroy());

    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    // hostヘッダーはそのまま維持

    const proxyReq = http.request(
      {
        hostname,
        port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      this.logger.error({ err, hostname, port }, 'Proxy request error');
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    res.on('close', () => { this.activeConnections--; });

    req.pipe(proxyReq);
  }

  private notifyDenied(hostname: string, port: number): void {
    const key = `${hostname}:${port}`;
    const now = Date.now();
    const last = this.deniedNotifyTimes.get(key);
    if (last && now - last < this.NOTIFY_COOLDOWN_MS) return;
    this.deniedNotifyTimes.set(key, now);

    const result = this.onDeniedCallback?.(hostname, port);
    // コールバックが失敗した場合、クールダウンをクリアして次回リトライ可能にする
    if (result instanceof Promise) {
      result.catch((err) => {
        this.logger.warn({ err, hostname, port }, 'Denied notification callback failed - clearing cooldown');
        this.deniedNotifyTimes.delete(key);
      });
    }
  }

  private async checkOrApprove(hostname: string, port: number): Promise<boolean> {
    if (this.whitelistStore.isAllowed(hostname, port)) {
      return true;
    }

    if (!this.sessionContext) {
      this.logger.warn({ hostname, port }, 'No session context - denying network access');
      return false;
    }

    const result = await this.networkApproval.requestNetworkApproval(
      hostname,
      port,
      this.sessionContext,
    );

    if (result.approved) {
      if (result.permanent) {
        this.whitelistStore.addPermanent(hostname, 'slack-approval', port);
      } else {
        this.whitelistStore.addTemporary(hostname, port);
      }
      return true;
    }

    return false;
  }
}
