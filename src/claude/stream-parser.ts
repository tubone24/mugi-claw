import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

// イベント型定義
interface StreamParserEvents {
  system_init: (event: { session_id: string; tools: string[]; mcp_servers: string[] }) => void;
  text: (event: { message: string }) => void;
  tool_use: (event: { tool: string; input: Record<string, unknown> }) => void;
  tool_result: (event: { tool: string; output: string; success: boolean }) => void;
  result: (event: { result: string; session_id: string; cost_usd: number; duration_ms: number; num_turns: number }) => void;
  error: (error: Error) => void;
}

export class StreamParser extends EventEmitter {
  private buffer = '';

  constructor() {
    super();
  }

  // EventEmitter の型付け
  override on<K extends keyof StreamParserEvents>(event: K, listener: StreamParserEvents[K]): this {
    return super.on(event, listener);
  }
  override emit<K extends keyof StreamParserEvents>(event: K, ...args: Parameters<StreamParserEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  /** Readable ストリーム（stdout）を接続してパースを開始 */
  attach(stream: Readable): void {
    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    stream.on('end', () => {
      // 残りバッファを処理
      if (this.buffer.trim()) {
        this.processLine(this.buffer.trim());
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // 最後の要素は不完全行の可能性があるので保持
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.processLine(trimmed);
      }
    }
  }

  private processLine(line: string): void {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      this.routeEvent(event);
    } catch {
      // JSON パースエラーは無視（ログ出力などの非JSON行）
    }
  }

  private routeEvent(event: Record<string, unknown>): void {
    const type = event['type'] as string | undefined;
    const subtype = event['subtype'] as string | undefined;

    switch (type) {
      case 'system':
        if (subtype === 'init') {
          this.emit('system_init', {
            session_id: event['session_id'] as string,
            tools: (event['tools'] as string[]) ?? [],
            mcp_servers: (event['mcp_servers'] as string[]) ?? [],
          });
        }
        break;

      case 'assistant':
        if (subtype === 'text') {
          this.emit('text', {
            message: event['message'] as string,
          });
        } else if (subtype === 'tool_use') {
          this.emit('tool_use', {
            tool: event['tool'] as string,
            input: (event['input'] as Record<string, unknown>) ?? {},
          });
        }
        break;

      case 'tool_result':
        this.emit('tool_result', {
          tool: event['tool'] as string,
          output: event['output'] as string,
          success: subtype === 'success',
        });
        break;

      case 'result':
        this.emit('result', {
          result: event['result'] as string,
          session_id: event['session_id'] as string,
          cost_usd: (event['cost_usd'] as number) ?? 0,
          duration_ms: (event['duration_ms'] as number) ?? 0,
          num_turns: (event['num_turns'] as number) ?? 0,
        });
        break;
    }
  }
}
