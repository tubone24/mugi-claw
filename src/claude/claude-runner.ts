import { spawn } from 'node:child_process';
import type { Logger } from 'pino';
import type { AppConfig } from '../types.js';
import { StreamParser } from './stream-parser.js';

const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash(*)', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'NotebookEdit',
  'mcp__browser__browser_navigate', 'mcp__browser__browser_click',
  'mcp__browser__browser_type', 'mcp__browser__browser_screenshot',
  'mcp__browser__browser_get_text', 'mcp__browser__browser_wait',
  'mcp__browser__browser_evaluate',
  'mcp__browser__browser_secure_input',
  'mcp__desktop__desktop_screenshot', 'mcp__desktop__desktop_click',
  'mcp__desktop__desktop_right_click', 'mcp__desktop__desktop_double_click',
  'mcp__desktop__desktop_type', 'mcp__desktop__desktop_key',
  'mcp__desktop__desktop_hotkey', 'mcp__desktop__desktop_mouse_move',
  'mcp__desktop__desktop_scroll', 'mcp__desktop__desktop_get_screen_info',
  'mcp__desktop__desktop_open_app', 'mcp__desktop__desktop_wait',
  // Mobile (mobile-mcp)
  'mcp__mobile__mobile_list_available_devices', 'mcp__mobile__mobile_get_screen_size',
  'mcp__mobile__mobile_get_orientation', 'mcp__mobile__mobile_set_orientation',
  'mcp__mobile__mobile_list_apps', 'mcp__mobile__mobile_launch_app',
  'mcp__mobile__mobile_terminate_app', 'mcp__mobile__mobile_install_app',
  'mcp__mobile__mobile_uninstall_app',
  'mcp__mobile__mobile_take_screenshot', 'mcp__mobile__mobile_save_screenshot',
  'mcp__mobile__mobile_list_elements_on_screen',
  'mcp__mobile__mobile_click_on_screen_at_coordinates',
  'mcp__mobile__mobile_double_tap_on_screen',
  'mcp__mobile__mobile_long_press_on_screen_at_coordinates',
  'mcp__mobile__mobile_swipe_on_screen',
  'mcp__mobile__mobile_type_keys', 'mcp__mobile__mobile_press_button',
  'mcp__mobile__mobile_open_url',
  // Mobile extra (mugi-claw補助)
  'mcp__mobile_extra__mobile_screenshot_slack',
  'mcp__mobile_extra__mobile_simulator_boot',
  'mcp__mobile_extra__mobile_simulator_shutdown',
  'mcp__mobile_extra__mobile_simulator_list_devices',
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'TaskOutput',
  'Skill', 'CronCreate', 'CronDelete', 'CronList',
];

const ALL_ALLOWED_TOOLS = [
  ...DEFAULT_ALLOWED_TOOLS,
  'Skill(gmail)', 'Skill(slack)', 'Skill(google-calendar)',
  'Skill(google-maps-timeline)', 'Skill(spotify)',
  'Agent',
  'ToolSearch',
  'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode',
  'EnterWorktree', 'ExitWorktree',
];

export interface ClaudeRunnerOptions {
  allowAllTools?: boolean;
}

export class ClaudeRunner {
  private activeProcesses = 0;
  private queue: Array<() => void> = [];

  constructor(
    private config: AppConfig,
    private logger: Logger,
  ) {}

  /** Claude CLI を実行し、StreamParser を返す */
  run(prompt: string, resumeSessionId?: string, model?: string, approvalContext?: { channel: string; threadTs: string }, options?: ClaudeRunnerOptions): StreamParser {
    const parser = new StreamParser();

    // 同時実行制御
    if (this.activeProcesses >= this.config.claude.maxConcurrent) {
      this.logger.info('同時実行数上限 - キューに追加');
      this.queue.push(() => void this.executeWithRetry(prompt, resumeSessionId, parser, model, approvalContext, options));
    } else {
      void this.executeWithRetry(prompt, resumeSessionId, parser, model, approvalContext, options);
    }

    return parser;
  }

  private async executeWithRetry(
    prompt: string,
    resumeSessionId: string | undefined,
    parser: StreamParser,
    model?: string,
    approvalContext?: { channel: string; threadTs: string },
    options?: ClaudeRunnerOptions,
  ): Promise<void> {
    this.activeProcesses++;
    const maxRetries = this.config.claude.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.execute(prompt, resumeSessionId, parser, model, approvalContext, options);
        this.onProcessEnd();
        return; // Success
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        // Don't retry on intentional signals
        if (this.isNonRetryable(error)) {
          parser.emit('error', error);
          this.onProcessEnd();
          return;
        }

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
          this.logger.warn(
            { attempt: attempt + 1, maxRetries, error: error.message, delayMs },
            'Claude CLI リトライ',
          );
          parser.emit('retry', {
            attempt: attempt + 1,
            maxRetries,
            error: error.message,
            delayMs,
          });
          await this.delay(delayMs);
          parser.reset(); // Reset buffer for retry
        } else {
          // All retries exhausted
          parser.emit('error', error);
          this.onProcessEnd();
          return;
        }
      }
    }
  }

  private isNonRetryable(error: Error): boolean {
    const msg = error.message;
    return msg.includes('SIGTERM') || msg.includes('SIGKILL') || msg.includes('SIGINT');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private execute(
    prompt: string,
    resumeSessionId: string | undefined,
    parser: StreamParser,
    model?: string,
    approvalContext?: { channel: string; threadTs: string },
    options?: ClaudeRunnerOptions,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--max-turns', String(this.config.claude.maxTurns),
        '--verbose',
      ];

      const tools = options?.allowAllTools ? ALL_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS;
      args.push('--allowedTools', ...tools);

      args.push('--mcp-config', '.mcp.json');

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

      // Sandbox mode: wrap with sandbox-exec
      const command = this.config.sandbox.enabled
        ? 'sandbox-exec'
        : this.config.claude.cliPath;

      const spawnArgs = this.config.sandbox.enabled
        ? ['-f', this.config.sandbox.profile, this.config.claude.cliPath, ...args]
        : args;

      // Add proxy env vars when sandbox is enabled
      const proxyEnv = this.config.sandbox.enabled
        ? {
            HTTP_PROXY: `http://localhost:${this.config.network.proxyPort}`,
            HTTPS_PROXY: `http://localhost:${this.config.network.proxyPort}`,
          }
        : {};

      const child = spawn(command, spawnArgs, {
        env: {
          ...process.env,
          ...proxyEnv,
          MUGI_CLAW_APPROVAL: '1',
          APPROVAL_PORT: String(this.config.approval.port),
          ...(approvalContext ? {
            APPROVAL_CHANNEL: approvalContext.channel,
            APPROVAL_THREAD_TS: approvalContext.threadTs,
          } : {}),
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
        reject(err);
      });

      child.on('close', (code, signal) => {
        this.logger.info({ code, signal }, 'Claude CLI プロセス終了');
        if (signal) {
          reject(new Error(`Claude CLI killed by signal ${signal}`));
        } else if (code !== 0 && code !== null) {
          reject(new Error(`Claude CLI exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  private onProcessEnd(): void {
    this.activeProcesses--;
    // キューから次のタスクを実行
    const next = this.queue.shift();
    if (next) next();
  }
}
