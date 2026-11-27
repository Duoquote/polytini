# Streaming

`@duoquote/polytini/stream` encodes and decodes input that arrives in pieces:

- one long polyline in chunks, like a fetch body or a file read
- points that arrive a few at a time, encoded as they come
- many polylines, one per line, or NDJSON with a polyline field

Every class here gives exactly what `decode` and `encode` give on the whole input, wherever the chunks are cut: the same numbers, the same string, and the same `PolylineError` with the same `code`, `index` and message. It's its own entry, so the other entries didn't get bigger.

```js
import {
  PolylineDecoder, PolylineEncoder,      // write(chunk) and end(), no streams needed
  DecodeStream, EncodeStream,            // TransformStreams
  DecodeLinesStream, EncodeLinesStream,  // one polyline per line, NDJSON
  decodeIterable, encodeIterable,        // for await
  decodeLines, encodeLines,
} from '@duoquote/polytini/stream';
```

They take the same options as `decode` and `encode` (`precision`, `factor`, `order`, `strict`, `dimensions`, `zFactor`, `onIssue`, and the presets), plus `flat`.

## One long polyline in chunks

```js
const res = await fetch(url);
for await (const points of res.body.pipeThrough(new DecodeStream({ precision: 6 }))) {
  draw(points); // the points each chunk completed
}
```

`DecodeStream` takes strings or bytes and gives one array of points per chunk that completed any. Bytes are read as UTF-8, so the result is what `decode(await res.text())` would give. With `flat: true` each batch is a `Float64Array` of `[lat0, lng0, lat1, lng1, ...]`.

Without streams, `PolylineDecoder` does the same with two calls:

```js
const d = new PolylineDecoder();
d.write('_p~iF~ps|U_ul'); // [[38.5, -120.2]]
d.write('LnnqC');         // [[40.7, -120.95]]
d.end();                  // [], or throws if the input was cut off
```

A chunk can end anywhere, even inside a value. The decoder keeps only the sums so far and the value it's in the middle of.

Strict mode works the way it does in `decode`:

- An invalid character throws a `PolylineError` with code `'char'` from the `write` that reads it. The `index` is the position in the whole input, not in the chunk.
- A string that ends inside a value or a point throws `'truncated'` from `end()`, with the same index `decode` reports: the length of the input.
- A value past 2^53 throws `'overflow'`.
- Points from earlier chunks have already been returned by then. To use all of them or none, collect them and use them after `end()`.
- After an error, every call throws it again. After `end()`, the decoder starts on a new polyline.

With `strict: false` it never throws on bad data and gives what lenient `decode` gives: invalid characters are skipped and an incomplete last point is dropped. `onIssue` gets the same issues `decode` reports for the whole string, with the index in the whole input, from the `write` that reads each one (the cut-off end from `end`). See [api.md](api.md#reporting-what-lenient-mode-skipped).

Polylines don't contain whitespace, so a file that ends with a newline fails in strict mode, like `decode` does on it. For text with one polyline per line, use `DecodeLinesStream`.

## Points to a string

```js
const e = new PolylineEncoder({ precision: 6 });
let s = e.write([38.5, -120.2]);             // one point
s += e.write([[40.7, -120.95], [43.252, -126.453]]); // or an array of them
s += e.end();
// s === encode(allPoints, 6)
```

`write` takes one point (a tuple or a `{ lat, lng }` object) or an array of points, and returns the string for them. An array whose first item isn't an object is one tuple. With `flat: true` it takes flat arrays of numbers, and a point can be split between two writes. Errors are `encode`'s, with the point's index in the whole input.

`EncodeStream` is the same as a TransformStream:

```js
points.pipeThrough(new EncodeStream()).pipeTo(writable);
```

## Many polylines, one per line

```js
const res = await fetch('/routes.ndjson');
const lines = res.body.pipeThrough(new DecodeLinesStream({ field: 'shape', precision: 6, errors: 'skip', onError: (err, line) => console.warn(line, err.message) }));
for await (const route of lines) show(route.id, route.shape);
```

`DecodeLinesStream` reads text or bytes with one polyline per line (`\n` or `\r\n`) and gives one result per line: its points, or with `field` the line's JSON object with that field decoded. Blank lines are skipped, and whitespace around a polyline is ignored. A line can be split between chunks anywhere.

A bad line errors the stream by default, with the `PolylineError` (or `SyntaxError` for bad JSON) and the 1-based line number as `err.line`; `err.index` is the position in the line. With `errors: 'skip'` the line is left out and the error goes to `onError(err, line)`. With `strict: false`, `onIssue` gets each line's issues with the index in the line and the line number as `line`.

`EncodeLinesStream` goes the other way: one array of points (or one object, with `field`) per chunk in, one line of text out, with a `\n`.

## Async iterables

For sources that aren't web streams: async generators, Node Readables, arrays.

```js
for await (const [lat, lng] of decodeIterable(fs.createReadStream('route.txt'))) { /* ... */ }
for await (const piece of encodeIterable(points)) out.write(piece);
for await (const route of decodeLines(fs.createReadStream('routes.txt'))) { /* ... */ }
```

- `decodeIterable(chunks, options)` yields one point at a time. That's convenient but costs an `await` per point; `DecodeStream` and `PolylineDecoder` give whole batches.
- `encodeIterable(points, options)` takes points or arrays of points and yields the string in pieces of about 64 KB. For a piece as soon as each point arrives, use `PolylineEncoder`.
- `decodeLines` and `encodeLines` are the line streams as async generators.

They also take a ReadableStream, and read it with a reader where `for await` on streams isn't supported (older Safari versions). The `for await` loops over `pipeThrough` in this page need that support; `decodeIterable(res.body)` doesn't.

## Node streams

Node 18 and up have the web streams as globals, so the classes work as they are. To connect them to Node streams:

```js
import { Readable, Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// A Node Readable into a web stream
Readable.toWeb(fs.createReadStream('routes.txt')).pipeThrough(new DecodeLinesStream());

// A web TransformStream as a Node Duplex, in a pipeline
await pipeline(fs.createReadStream('route.txt'), Duplex.fromWeb(new DecodeStream(), { objectMode: true }), sink);

// Or an async generator, which pipeline takes as a step
await pipeline(fs.createReadStream('route.txt'), (src) => decodeIterable(src), sink);
```

All three work on Node 22 to 26 and Bun 1.4. In Deno, use its web streams directly: its `Duplex.fromWeb` threw an internal error after a failed pipeline when I tried it. This entry doesn't import `node:stream`, so browser bundles stay clean.

React Native has no TransformStream. There `PolylineDecoder`, `PolylineEncoder` and the iterables work, and constructing a `DecodeStream` throws a TypeError that says so.

## Speed

The decoder uses the same 2D loop as `decode` for whole points and falls back to the exact per-character code only for a point split between chunks, other dimensions and bad input. The tuple loop stops 12 characters before the end of each chunk, since a point it reads is at most 12 characters long, so it never reads past the chunk and needs no count. The flat one counts the points first, like `decodeFlat`, to size its array.

Measured with `bench/ab.js` (paired, separate processes, 8 rounds, high priority on 4 pinned cores) on 1,000,000 points cut into 64 KB chunks, against one call on the whole input. B/A below 1 means streaming was faster. A against itself gave 0.97 (0.93 to 1.02) and 0.96 (0.93 to 0.99) on Node 25, so differences of a few percent are noise.

String chunks against `decode` (or `encode`) on the whole string. Encoding writes 4,096 points at a time:

| Runtime | decode | decodeFlat | encode | encodeFlat |
|---|--:|--:|--:|--:|
| Node 22.9 | 1.066 (1.019 to 1.116) | 1.125 (0.992 to 1.276) | 0.355 (0.331 to 0.381) | 0.351 (0.334 to 0.369) |
| Node 24.10 | 1.009 (0.961 to 1.061) | 0.953 (0.901 to 1.008) | 1.117 (1.106 to 1.129) | 1.020 (0.989 to 1.052) |
| Node 25.2 | 1.034 (1.011 to 1.057) | 1.041 (1.026 to 1.056) | 1.089 (1.062 to 1.117) | 1.031 (1.016 to 1.046) |
| Bun 1.4.3 | 0.914 (0.891 to 0.938) | 0.803 (0.788 to 0.818) | 1.146 (1.098 to 1.196) | 1.152 (1.091 to 1.217) |
| Deno 2.5.4 | 1.072 (1.052 to 1.092) | 0.997 (0.941 to 1.056) | 1.061 (1.039 to 1.084) | 1.015 (0.992 to 1.039) |

Byte chunks, the way a fetch body or a file read comes, against `decode(await res.text())`, which turns all the bytes into one string first:

| Runtime | decode | decodeFlat |
|---|--:|--:|
| Node 22.9 | 1.083 (1.048 to 1.119) | 1.187 (1.159 to 1.217) |
| Node 24.10 | 1.000 (0.928 to 1.078) | 0.987 (0.917 to 1.062) |
| Node 25.2 | 1.042 (1.029 to 1.055) | 1.034 (0.999 to 1.071) |
| Bun 1.4.3 | 0.933 (0.916 to 0.950) | 0.868 (0.835 to 0.901) |
| Deno 2.5.4 | 1.040 (1.018 to 1.063) | 1.010 (0.973 to 1.049) |

In headless Chrome 157, timed in the page (10 rounds, A and B alternating first, the fastest of 15 calls each): 0.943 (0.894 to 0.995) for `decode`, 1.116 (1.098 to 1.133) for `decodeFlat`, and 0.727 (0.549 to 0.963) for byte chunks against `res.text()`.

So decoding through the stream costs 0 to 8% on V8 and is faster on Bun; flat output costs up to 19% on Node 22. Encoding on Node 22 is almost three times as fast in pieces, because one 1,000,000-point string built with `+=` is slow to flatten there. The numbers include reading each output piece once (`--consume full`) and, for decoding, not copying the batches into one array, since a consumer uses them as they come. The commands:

```sh
node bench/ab.js --a src/web.js --b bench/stream.js --cases decode:1000000,decodeFlat:1000000,encode:1000000,encodeFlat:1000000 --rounds 8 --samples 20 --warm 500 --consume full --prio high --affinity 0xF000
STREAM_CHUNKS=bytes node bench/ab.js --a bench/stream-text.js --b bench/stream.js --cases decode:1000000,decodeFlat:1000000 --rounds 8 --samples 20 --warm 500 --consume full --prio high --affinity 0xF000
```

with `--exe` for the other runtimes. On the 1000 real-world lines, one `PolylineDecoder` per line (write, then end) took 2.93 ms against 2.73 ms for `decode`, the fastest of 40 interleaved runs in one Node 25 process: about 7% more, most of it the decoder's setup.

## Size

Gzipped with `node scripts/size.js`: 3,624 bytes for the whole entry, 1,717 for `PolylineDecoder` alone. The CLI, which uses it, is 6,918.

## How it's tested

`test/stream.test.js` checks the property above directly. For random valid polylines (any precision, order, 1 to 3 dimensions, strict and lenient), broken ones (cut, a bad character, a value past 2^53, characters outside ASCII), random strings, the 183 decode vectors, the 380 PostGIS decode cases in both coordinate orders and the 1,000 real-world lines, it cuts the input at every position, as a string and as UTF-8 bytes, and at random chunk sizes, and compares the points and the error with `decode` and `decodeFlat` on every entry. Encoding is checked the same way with the points split into every two batches, random batches, one point per write and flat values cut anywhere. It runs on Node 22 to 26, Bun, Deno, headless Chrome and workerd.
