import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClaudeRunner } from './claude-runner.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

const mockConfig = {
  claude: {
    cliPath: 'claude',
    maxConcurrent: 3,
    maxTurns: 50,
    maxRetries: 3,
  },
  sandbox: { enabled: false, profile: '' },
  network: { proxyPort: 18080, defaultWhitelist: [] },
  approval: { port: 3456 },
  credential: { port: 3457 },
  browser: { debuggingPort: 9222, userDataDir: '' },
  db: { path: '' },
  slack: { botToken: '', appToken: '', signingSecret: '' },
  owner: { slackUserId: '' },
  logLevel: 'info',
} as any;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

/**
 * Create a mock ChildProcess that emits close or error after a short delay.
 * The setTimeout is scheduled at creation time, so when using fake timers
 * with multiple retries, use mockSpawnSequence() instead to create children lazily.
 */
function createMockChild(
  exitCode: number | null = 0,
  signal: string | null = null,
  spawnError?: Error,
) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = null;

  if (spawnError) {
    setTimeout(() => child.emit('error', spawnError), 10);
  } else {
    setTimeout(() => child.emit('close', exitCode, signal), 10);
  }

  return child;
}

interface MockChildSpec {
  exitCode?: number | null;
  signal?: string | null;
  spawnError?: Error;
}

/**
 * Set up mockSpawn to create mock children lazily in sequence.
 * This ensures each child's setTimeout is scheduled only when spawn() is called,
 * which is critical for fake timer tests with retries.
 */
function mockSpawnSequence(specs: MockChildSpec[]): void {
  let callIndex = 0;
  mockSpawn.mockImplementation((() => {
    const spec = specs[callIndex++] ?? { exitCode: 0 };
    return createMockChild(
      spec.exitCode ?? (spec.signal ? null : 0),
      spec.signal ?? null,
      spec.spawnError,
    );
  }) as any);
}

describe('ClaudeRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // Basic behavior
  // =========================================================================

  describe('basic behavior', () => {
    it('run returns a StreamParser', () => {
      mockSpawnSequence([{ exitCode: 0 }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      expect(parser).toBeDefined();
      expect(typeof parser.on).toBe('function');
      expect(typeof parser.emit).toBe('function');
    });

    it('normal exit (code 0) - no retry, no error', async () => {
      mockSpawnSequence([{ exitCode: 0 }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let the close event fire
      await vi.advanceTimersByTimeAsync(20);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('passes resumeSessionId as --resume arg', async () => {
      mockSpawnSequence([{ exitCode: 0 }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      runner.run('test prompt', 'session-123');

      await vi.advanceTimersByTimeAsync(20);

      const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
      expect(spawnArgs).toContain('--resume');
      expect(spawnArgs).toContain('session-123');
    });

    it('passes model mapped to full model ID', async () => {
      mockSpawnSequence([{ exitCode: 0 }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      runner.run('test prompt', undefined, 'opus');

      await vi.advanceTimersByTimeAsync(20);

      const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
      expect(spawnArgs).toContain('--model');
      expect(spawnArgs).toContain('claude-opus-4-6');
    });

    it('attaches stdout to parser for stream processing', async () => {
      mockSpawnSequence([{ exitCode: 0 }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      const textHandler = vi.fn();
      parser.on('text', textHandler);

      // Get the child that was created by spawn
      const child = mockSpawn.mock.results[0]!.value;

      // Simulate stdout data from the mock child
      const jsonLine = JSON.stringify({
        type: 'assistant',
        subtype: 'text',
        message: 'hello from claude',
      });
      child.stdout.emit('data', Buffer.from(jsonLine + '\n'));

      expect(textHandler).toHaveBeenCalledWith({ message: 'hello from claude' });
    });
  });

  // =========================================================================
  // Retry behavior
  // =========================================================================

  describe('retry behavior', () => {
    it('spawn error triggers retry and eventually succeeds', async () => {
      mockSpawnSequence([
        { spawnError: new Error('spawn ENOENT') },
        { exitCode: 0 },
      ]);

      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 3 } };
      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const errorHandler = vi.fn();
      const retryHandler = vi.fn();
      parser.on('error', errorHandler);
      parser.on('retry', retryHandler);

      // Let the first spawn error fire
      await vi.advanceTimersByTimeAsync(20);

      // Advance past the first retry backoff (2^(0+1) * 1000 = 2000ms)
      await vi.advanceTimersByTimeAsync(2100);

      // Let the success child close
      await vi.advanceTimersByTimeAsync(20);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(retryHandler).toHaveBeenCalledTimes(1);
      expect(retryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxRetries: 3,
          delayMs: 2000,
        }),
      );
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('non-zero exit code triggers retry', async () => {
      mockSpawnSequence([
        { exitCode: 1 },
        { exitCode: 0 },
      ]);

      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 3 } };
      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let exit code 1 fire
      await vi.advanceTimersByTimeAsync(20);

      // Advance past first retry backoff (2s)
      await vi.advanceTimersByTimeAsync(2100);

      // Let success child close
      await vi.advanceTimersByTimeAsync(20);

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('SIGTERM does not retry', async () => {
      mockSpawnSequence([{ signal: 'SIGTERM' }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let the close event fire
      await vi.advanceTimersByTimeAsync(20);

      // Wait well beyond any potential retry backoff
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0]![0].message).toContain('SIGTERM');
    });

    it('SIGKILL does not retry', async () => {
      mockSpawnSequence([{ signal: 'SIGKILL' }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let the close event fire
      await vi.advanceTimersByTimeAsync(20);

      // Wait well beyond any potential retry backoff
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0]![0].message).toContain('SIGKILL');
    });

    it('SIGINT does not retry', async () => {
      mockSpawnSequence([{ signal: 'SIGINT' }]);

      const runner = new ClaudeRunner(mockConfig, mockLogger);
      const parser = runner.run('test prompt');

      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let the close event fire
      await vi.advanceTimersByTimeAsync(20);

      // Wait well beyond any potential retry backoff
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0]![0].message).toContain('SIGINT');
    });

    it('all retries exhausted emits error', async () => {
      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 2 } };

      // initial + 2 retries = 3 calls, all fail with exit code 1
      mockSpawnSequence([
        { exitCode: 1 },
        { exitCode: 1 },
        { exitCode: 1 },
      ]);

      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Initial attempt fails (exit code 1)
      await vi.advanceTimersByTimeAsync(20);

      // First retry backoff (2s) + execute + close
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(20);

      // Second retry backoff (4s) + execute + close
      await vi.advanceTimersByTimeAsync(4100);
      await vi.advanceTimersByTimeAsync(20);

      expect(mockSpawn).toHaveBeenCalledTimes(3);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0]![0].message).toContain('code 1');
    });

    it('backoff timing: 2s, 4s, 8s', async () => {
      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 3 } };

      // 4 calls: initial + 3 retries. First 3 fail, last succeeds.
      mockSpawnSequence([
        { exitCode: 1 },
        { exitCode: 1 },
        { exitCode: 1 },
        { exitCode: 0 },
      ]);

      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const errorHandler = vi.fn();
      const retryHandler = vi.fn();
      parser.on('error', errorHandler);
      parser.on('retry', retryHandler);

      // Timeline:
      // T=0:    spawn#1 called, child setTimeout(close, 10ms) scheduled
      // T=10:   child#1 close(1). reject(). retry emit. delay(2000ms) starts.
      // T=2010: delay done. reset(). spawn#2 called. child setTimeout(close, 10ms).
      // T=2020: child#2 close(1). reject(). retry emit. delay(4000ms) starts.
      // T=6020: delay done. reset(). spawn#3 called. child setTimeout(close, 10ms).
      // T=6030: child#3 close(1). reject(). retry emit. delay(8000ms) starts.
      // T=14030: delay done. reset(). spawn#4 called. child setTimeout(close, 10ms).
      // T=14040: child#4 close(0). resolve(). done.

      // T=0 -> T=10: child#1 close fires
      await vi.advanceTimersByTimeAsync(10);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // 1st backoff (2000ms). Verify NOT retried at T=1800 (1790ms after close)
      await vi.advanceTimersByTimeAsync(1790);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Cross the 2000ms threshold: need 210 more ms to reach T=2010
      await vi.advanceTimersByTimeAsync(210);
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      // Let child#2 close fire at T=2020
      await vi.advanceTimersByTimeAsync(10);

      // 2nd backoff (4000ms) from T=2020. At T=5900 (3880ms later) should not retry
      await vi.advanceTimersByTimeAsync(3880);
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      // Cross to T=6020 (140ms later)
      await vi.advanceTimersByTimeAsync(140);
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Let child#3 close fire at T=6030
      await vi.advanceTimersByTimeAsync(10);

      // 3rd backoff (8000ms) from T=6030. At T=13900 (7870ms later) should not retry
      await vi.advanceTimersByTimeAsync(7870);
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Cross to T=14030 (160ms later)
      await vi.advanceTimersByTimeAsync(160);
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      // Let child#4 close fire (success)
      await vi.advanceTimersByTimeAsync(10);

      // Final attempt succeeds - no error emitted
      expect(errorHandler).not.toHaveBeenCalled();
      // 3 retries emitted
      expect(retryHandler).toHaveBeenCalledTimes(3);
    });

    it('retry event includes attempt info', async () => {
      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 2 } };

      mockSpawnSequence([
        { exitCode: 1 },
        { exitCode: 1 },
        { exitCode: 0 },
      ]);

      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const retryHandler = vi.fn();
      const errorHandler = vi.fn();
      parser.on('retry', retryHandler);
      parser.on('error', errorHandler);

      // Initial attempt fails
      await vi.advanceTimersByTimeAsync(20);

      // First retry (backoff 2s)
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(20);

      // Second retry (backoff 4s)
      await vi.advanceTimersByTimeAsync(4100);
      await vi.advanceTimersByTimeAsync(20);

      expect(retryHandler).toHaveBeenCalledTimes(2);
      expect(retryHandler.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ attempt: 1, delayMs: 2000 }),
      );
      expect(retryHandler.mock.calls[1]![0]).toEqual(
        expect.objectContaining({ attempt: 2, delayMs: 4000 }),
      );
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('maxRetries 0 means no retry - error emitted immediately', async () => {
      const config = { ...mockConfig, claude: { ...mockConfig.claude, maxRetries: 0 } };

      mockSpawnSequence([{ exitCode: 1 }]);

      const runner = new ClaudeRunner(config, mockLogger);

      const parser = runner.run('test prompt');
      const errorHandler = vi.fn();
      parser.on('error', errorHandler);

      // Let exit code 1 fire
      await vi.advanceTimersByTimeAsync(20);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0]![0].message).toContain('code 1');
    });
  });
});
