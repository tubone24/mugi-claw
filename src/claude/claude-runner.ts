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
  run(prompt: string, resumeSessionId?: string): StreamParser {
    const parser = new StreamParser();

    // 同時実行制御
    if (this.activeProcesses >= this.config.claude.maxConcurrent) {
      this.logger.info('同時実行数上限 - キューに追加');
      this.queue.push(() => this.execute(prompt, resumeSessionId, parser));
    } else {
      this.execute(prompt, resumeSessionId, parser);
    }

    return parser;
  }

  private execute(prompt: string, resumeSessionId: string | undefined, parser: StreamParser): void {
    this.activeProcesses++;

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--max-turns', String(this.config.claude.maxTurns),
      '--verbose',
      '--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep,mcp__browser__*',
    ];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    this.logger.info({ args: args.filter((_, i) => i !== 1) }, 'Claude CLI 起動'); // promptは除外してログ

    const child = spawn(this.config.claude.cliPath, args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      parser.attach(child.stdout);
    }

    child.stderr?.on('data', (data: Buffer) => {
      this.logger.debug({ stderr: data.toString() }, 'Claude CLI stderr');
    });

    child.on('error', (err) => {
      parser.emit('error', err);
      this.onProcessEnd();
    });

    child.on('close', (code) => {
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
