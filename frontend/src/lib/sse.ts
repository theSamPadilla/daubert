export interface SseFrame {
  id: string | null;
  event: string;
  data: string;
}

/**
 * Incremental text/event-stream parser. Feed decoded chunks and get back the
 * frames each chunk completes. Comment lines (":") are skipped, data lines
 * join with "\n", and a blank line dispatches the frame.
 */
export function createSseParser() {
  let buf = '';
  let id: string | null = null;
  let event = '';
  let data: string[] = [];

  return {
    feed(chunk: string): SseFrame[] {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      const frames: SseFrame[] = [];
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '') {
          if (data.length > 0) frames.push({ id, event: event || 'message', data: data.join('\n') });
          id = null;
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
      return frames;
    },
  };
}
