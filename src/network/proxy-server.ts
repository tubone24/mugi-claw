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
    const urlParts = (req.url ?? '').split(':');
    const hostname = urlParts[0] ?? '';
    const port = parseInt(urlParts[1] ?? '', 10) || 443;

    this.logger.debug({ hostname, port, method: 'CONNECT' }, 'Proxy CONNECT request');

    const allowed = await this.checkOrApprove(hostname, port);

    if (!allowed) {
      this.logger.warn({ hostname, port }, 'Network access denied');
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    this.logger.info({ hostname, port }, 'Network access allowed - establishing tunnel');

    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      this.logger.error({ err, hostname, port }, 'Tunnel connection error');
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      this.logger.error({ err, hostname, port }, 'Client socket error');
      serverSocket.end();
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end('Bad Request: Invalid URL');
      return;
    }

    const hostname = targetUrl.hostname;
    const port = parseInt(targetUrl.port, 10) || 80;

    this.logger.debug({ hostname, port, method: req.method, url: req.url }, 'Proxy HTTP request');

    const allowed = await this.checkOrApprove(hostname, port);

    if (!allowed) {
      this.logger.warn({ hostname, port }, 'Network access denied');
      res.writeHead(403);
      res.end('Forbidden: Network access not approved');
      return;
    }

    this.logger.info({ hostname, port, method: req.method }, 'Network access allowed - proxying');

    const proxyReq = http.request(
      {
        hostname,
        port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: req.headers,
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

    req.pipe(proxyReq);
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
