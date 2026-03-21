import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { CredentialManager, CredentialRequest } from './credential-manager.js';

export class CredentialServer {
  private server: Server;

  constructor(
    private credentialManager: CredentialManager,
    private port: number,
    private logger: Logger,
  ) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        this.logger.info({ port: this.port }, 'Credential HTTP server 起動 (0.0.0.0)');
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
    const url = req.url ?? '';

    // CORSヘッダー（同一ネットワーク内からのアクセス用）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.startsWith('/credential/')) {
      this.serveCredentialForm(url, res);
    } else if (req.method === 'POST' && url.startsWith('/api/credential/')) {
      this.readBody(req, (body) => { this.processCredentialSubmit(url, body, res); });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private readBody(req: IncomingMessage, callback: (body: string) => void): void {
    let body = '';
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        req.destroy();
      }
    });
    req.on('end', () => { callback(body); });
  }

  private serveCredentialForm(url: string, res: ServerResponse): void {
    const rawId = url.replace('/credential/', '');
    const requestId = rawId.split('?')[0]!.split('/')[0]!;
    if (!/^[A-Za-z0-9_-]+$/.test(requestId)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid request ID');
      return;
    }

    const request = this.credentialManager.getPendingRequest(requestId);
    if (!request) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.generateExpiredHtml());
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.generateCredentialFormHtml(request));
  }

  private processCredentialSubmit(url: string, body: string, res: ServerResponse): void {
    const rawId = url.replace('/api/credential/', '');
    const requestId = rawId.split('?')[0]!.split('/')[0]!;
    if (!/^[A-Za-z0-9_-]+$/.test(requestId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request ID' }));
      return;
    }

    try {
      const data = JSON.parse(body) as { values: Record<string, string> };
      const resolved = this.credentialManager.resolve(requestId, data.values);

      if (resolved) {
        this.logger.info({ requestId }, 'クレデンシャル入力受理');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'リクエストが見つかりません（期限切れの可能性があります）' }));
      }
    } catch (err) {
      this.logger.error({ err }, 'クレデンシャル送信処理エラー');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }

  private generateCredentialFormHtml(request: CredentialRequest): string {
    const fieldsHtml = request.fields.map((field, i) => {
      const inputType = field.sensitive ? 'password' : 'text';
      return `
      <div class="field">
        <label for="field_${i}">${this.escapeHtml(field.label)}</label>
        <input id="field_${i}" name="field_${i}" type="${inputType}" required autocomplete="off">
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mugi-claw 認証入力</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; color: #333; background: #f8f9fa; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 1.4em; margin-bottom: 8px; }
    .site-name { color: #1a73e8; font-size: 1.1em; margin-bottom: 24px; word-break: break-all; }
    .field { margin-bottom: 16px; }
    label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.95em; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #dadce0; border-radius: 6px; font-size: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.2); }
    .submit-btn { width: 100%; margin-top: 24px; padding: 12px; background: #1a73e8; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    .submit-btn:hover { background: #1557b0; }
    .submit-btn:disabled { background: #94b8e0; cursor: not-allowed; }
    .result { margin-top: 16px; padding: 12px; border-radius: 6px; font-weight: 500; }
    .result.success { background: #e6f4ea; color: #137333; }
    .result.error { background: #fce8e6; color: #c5221f; }
    .timer { text-align: center; color: #5f6368; font-size: 0.85em; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>&#x1f510; 認証情報の入力</h1>
    <div class="site-name">${this.escapeHtml(request.site)}</div>
    <form id="credForm">
      ${fieldsHtml}
      <button type="submit" class="submit-btn" id="submitBtn">送信</button>
    </form>
    <div id="result"></div>
    <div class="timer" id="timer"></div>
  </div>
  <script>
    (function() {
      var deadline = ${request.timestamp + 5 * 60 * 1000};
      var timerEl = document.getElementById('timer');
      var interval = setInterval(function() {
        var remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
        var min = Math.floor(remaining / 60);
        var sec = remaining % 60;
        timerEl.textContent = '残り ' + min + ':' + (sec < 10 ? '0' : '') + sec;
        if (remaining <= 0) {
          clearInterval(interval);
          timerEl.textContent = '期限切れです';
          document.getElementById('submitBtn').disabled = true;
        }
      }, 1000);

      document.getElementById('credForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = '送信中...';
        var values = {};
        this.querySelectorAll('input').forEach(function(input) {
          values[input.name] = input.value;
        });
        fetch('/api/credential/${request.requestId}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: values }),
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          clearInterval(interval);
          if (data.success) {
            document.getElementById('credForm').style.display = 'none';
            timerEl.style.display = 'none';
            document.getElementById('result').className = 'result success';
            document.getElementById('result').textContent = '入力を受け付けました。このタブを閉じてください。';
          } else {
            document.getElementById('result').className = 'result error';
            document.getElementById('result').textContent = data.error || 'エラーが発生しました';
            btn.disabled = false;
            btn.textContent = '送信';
          }
        })
        .catch(function() {
          document.getElementById('result').className = 'result error';
          document.getElementById('result').textContent = '送信に失敗しました';
          btn.disabled = false;
          btn.textContent = '送信';
        });
      });
    })();
  </script>
</body>
</html>`;
  }

  private generateExpiredHtml(): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mugi-claw 認証入力</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; text-align: center; color: #333; background: #f8f9fa; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .expired { color: #5f6368; font-size: 1.1em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>&#x1f510; 認証入力</h1>
    <p class="expired">このリクエストは期限切れか、既に処理済みです。</p>
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
