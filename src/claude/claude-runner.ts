import { spawn } from 'node:child_process';
import type { Logger } from 'pino';
import type { AppConfig } from '../types.js';
import { StreamParser } from './stream-parser.js';

export class ClaudeRunner {
  private activeProcesses = 0;
  private queue: Array<() => void> = [];

  constructor(
    private config: AppConfig,
    private logger: Logger,
  ) {}

  /** Claude CLI を実行し、StreamParser を返す */
  run(prompt: string, resumeSessionId?: string, model?: string): StreamParser {
    const parser = new StreamParser();

    // 同時実行制御
    if (this.activeProcesses >= this.config.claude.maxConcurrent) {
      this.logger.info('同時実行数上限 - キューに追加');
      this.queue.push(() => this.execute(prompt, resumeSessionId, parser, model));
    } else {
      this.execute(prompt, resumeSessionId, parser, model);
    }

    return parser;
  }

  private execute(prompt: string, resumeSessionId: string | undefined, parser: StreamParser, model?: string): void {
    this.activeProcesses++;

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--max-turns', String(this.config.claude.maxTurns),
      '--verbose',
      '--allowedTools', 'Read,Write,Edit,Bash(*),Glob,Grep,WebSearch,WebFetch,NotebookEdit,mcp__*',
      '--mcp-config', '.mcp.json',
    ];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    if (model) {
      const modelIdMap: Record<string, string> = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      };
      const modelId = modelIdMap[model] ?? `claude-${model}-4-6`;
      args.push('--model', modelId);
    }

    this.logger.info({ args: args.filter((_, i) => i !== 1) }, 'Claude CLI 起動'); // promptは除外してログ

    const child = spawn(this.config.claude.cliPath, args, {
      env: {
        ...process.env,
        MUGI_CLAW_APPROVAL: '1',
        APPROVAL_PORT: String(this.config.approval.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      parser.attach(child.stdout);
    }

    child.stdout?.on('data', (data: Buffer) => {
      this.logger.debug({ stdout: data.toString().slice(0, 200) }, 'Claude CLI stdout chunk');
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.logger.warn({ stderr: data.toString() }, 'Claude CLI stderr');
    });

    child.on('error', (err) => {
      this.logger.error({ err }, 'Claude CLI spawn error');
      parser.emit('error', err);
      this.onProcessEnd();
    });

    child.on('close', (code) => {
      this.logger.info({ code }, 'Claude CLI プロセス終了');
      if (code !== 0 && code !== null) {
        parser.emit('error', new Error(`Claude CLI exited with code ${code}`));
      }
      this.onProcessEnd();
    });
  }

  private onProcessEnd(): void {
    this.activeProcesses--;
    // キューから次のタスクを実行
    const next = this.queue.shift();
    if (next) next();
  }
}
