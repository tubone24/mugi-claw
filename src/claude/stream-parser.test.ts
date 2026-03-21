import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { StreamParser } from './stream-parser.js';

/** Helper: create a Readable stream from an array of JSON event objects */
function createStream(events: object[]): Readable {
  const data = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  return Readable.from([data]);
}

describe('StreamParser', () => {
  it('emits system_init on system/init event', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('system_init', handler);

    const stream = createStream([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-abc',
        tools: ['Bash', 'Read'],
        mcp_servers: ['browser'],
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      session_id: 'sess-abc',
      tools: ['Bash', 'Read'],
      mcp_servers: ['browser'],
    });
  });

  it('emits text on assistant/text event', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('text', handler);

    const stream = createStream([
      {
        type: 'assistant',
        subtype: 'text',
        message: 'Hello, world!',
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ message: 'Hello, world!' });
  });

  it('emits tool_use on assistant/tool_use event', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('tool_use', handler);

    const stream = createStream([
      {
        type: 'assistant',
        subtype: 'tool_use',
        tool: 'Bash',
        input: { command: 'ls' },
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      tool: 'Bash',
      input: { command: 'ls' },
    });
  });

  it('emits tool_result on tool_result event', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('tool_result', handler);

    const stream = createStream([
      {
        type: 'tool_result',
        subtype: 'success',
        tool: 'Bash',
        output: 'file1.ts\nfile2.ts',
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      tool: 'Bash',
      output: 'file1.ts\nfile2.ts',
      success: true,
    });
  });

  it('emits result on result event', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('result', handler);

    const stream = createStream([
      {
        type: 'result',
        result: 'Task completed',
        session_id: 'sess-xyz',
        cost_usd: 0.05,
        duration_ms: 12345,
        num_turns: 3,
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      result: 'Task completed',
      session_id: 'sess-xyz',
      cost_usd: 0.05,
      duration_ms: 12345,
      num_turns: 3,
    });
  });

  it('handles incomplete lines split across chunks', async () => {
    const parser = new StreamParser();
    const handler = vi.fn();
    parser.on('text', handler);

    const fullJson = JSON.stringify({
      type: 'assistant',
      subtype: 'text',
      message: 'split message',
    });

    // Split the JSON line in the middle
    const splitPoint = Math.floor(fullJson.length / 2);
    const chunk1 = fullJson.slice(0, splitPoint);
    const chunk2 = fullJson.slice(splitPoint) + '\n';

    const stream = new Readable({
      read() {
        // Push chunks on next tick to simulate async delivery
      },
    });

    parser.attach(stream);

    // Push first chunk — should NOT emit yet (incomplete line)
    stream.push(Buffer.from(chunk1));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(handler).not.toHaveBeenCalled();

    // Push second chunk — now the line is complete and should emit
    stream.push(Buffer.from(chunk2));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ message: 'split message' });

    stream.push(null); // end stream
  });

  it('does not crash or emit error on non-JSON line', async () => {
    const parser = new StreamParser();
    const errorHandler = vi.fn();
    const textHandler = vi.fn();
    parser.on('error', errorHandler);
    parser.on('text', textHandler);

    const data = 'this is not json\n{"type":"assistant","subtype":"text","message":"ok"}\nmore garbage\n';
    const stream = Readable.from([data]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    expect(errorHandler).not.toHaveBeenCalled();
    expect(textHandler).toHaveBeenCalledOnce();
    expect(textHandler).toHaveBeenCalledWith({ message: 'ok' });
  });

  it('does not duplicate emit when subtype events arrive before full-message format', async () => {
    const parser = new StreamParser();
    const textHandler = vi.fn();
    parser.on('text', textHandler);

    const stream = createStream([
      // First: subtype-based text event
      {
        type: 'assistant',
        subtype: 'text',
        message: 'hello from subtype',
      },
      // Then: full-message format assistant event (should be ignored)
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hello from full message' },
          ],
        },
      },
    ]);

    parser.attach(stream);
    await new Promise(resolve => stream.on('end', resolve));

    // Only the subtype event should be emitted, not the full-message one
    expect(textHandler).toHaveBeenCalledOnce();
    expect(textHandler).toHaveBeenCalledWith({ message: 'hello from subtype' });
  });
});
