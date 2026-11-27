// Shared by the /stream entry and the CLI, not exported by the package:
// byte chunks to text, and text chunks to lines.
import { fail } from './error.js';

const STREAM = { stream: true };

/**
 * A string chunk as it is, bytes through `o`'s own UTF-8 TextDecoder in
 * stream mode, so a character split between chunks comes out whole. It's
 * the text `await response.text()` would give: a BOM at the start is
 * dropped and bad UTF-8 becomes U+FFFD.
 */
export function toText(o, x) {
  if (typeof x == 'string') return x;
  if (x == null || typeof x != 'object' || !(x.byteLength >= 0)) fail('input', 'Expected a string or bytes');
  const b = x.buffer ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x), last = b[b.length - 1];
  if (!b.length) return '';
  // After a chunk that ended on an ASCII byte, the stream-mode decoder holds
  // nothing back, so a plain decode() of a chunk that also ends on one gives
  // the same text. That's most chunks, and it was faster: stream mode made
  // 1,000,000 points in 64 KB chunks 14% slower than decoding the whole body
  // at once on Node 25. ignoreBOM, so a BOM after the start stays a character.
  const s = o.td && o.clean && last < 128 ? (o.ta ||= new TextDecoder('utf-8', { ignoreBOM: true })).decode(b) : (o.td ||= new TextDecoder()).decode(b, STREAM);
  o.clean = last < 128;
  return s;
}

/** What toText still holds at the end: an incomplete UTF-8 sequence, as U+FFFD. */
export const flushText = (o) => {
  const s = o.td && !o.clean ? o.td.decode() : '';
  o.td = null;
  return s;
};

/**
 * Splits text or byte chunks into lines without their \n or \r\n. A line
 * split between chunks is kept as parts and joined once, so a long line
 * costs one copy, not one per chunk.
 */
export class Lines {
  constructor() {
    this.parts = [];
    this.td = null;
  }

  /** Calls fn with every line this chunk completes. */
  push(chunk, fn) {
    const s = toText(this, chunk);
    let i = 0, j;
    while ((j = s.indexOf('\n', i)) >= 0) {
      let line = s.slice(i, j);
      if (this.parts.length) {
        this.parts.push(line);
        line = this.parts.join('');
        this.parts = [];
      }
      fn(line.endsWith('\r') ? line.slice(0, -1) : line);
      i = j + 1;
    }
    if (i < s.length) this.parts.push(i ? s.slice(i) : s);
  }

  /** Calls fn with the last line, if the text didn't end with a line break. */
  end(fn) {
    const rest = flushText(this);
    if (rest) this.push(rest, fn);
    if (this.parts.length) {
      const line = this.parts.join('');
      this.parts = [];
      fn(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
  }
}
