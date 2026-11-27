// Types for @duoquote/polytini/stream.
/**
 * Streaming encode and decode, for input that arrives in pieces: one long
 * polyline in chunks (a fetch body, a file), points a few at a time, or many
 * polylines, one per line (NDJSON included). Every class gives exactly what
 * `decode` and `encode` give on the whole input, with the same
 * `PolylineError` code and index, wherever the chunks are cut. Web Streams,
 * so it runs in browsers, Node, Bun, Deno and Cloudflare Workers.
 *
 * ```js
 * import { DecodeStream, PolylineDecoder } from '@duoquote/polytini/stream';
 *
 * const res = await fetch(url);
 * for await (const points of res.body.pipeThrough(new DecodeStream({ precision: 6 }))) draw(points);
 *
 * const d = new PolylineDecoder();
 * d.write('_p~iF~ps|U_ul'); // [[38.5, -120.2]]
 * d.write('LnnqC');         // [[40.7, -120.95]]
 * d.end();                  // [], or throws PolylineError 'truncated'
 * ```
 *
 * @module
 */
import type { Options, OptionsArg, Point, LatLngLike, ErrorCode } from './index.d.ts';

export type { Options, OptionsArg, Point, LatLngLike, ErrorCode } from './index.d.ts';

/** The same class as the main entry's PolylineError. */
export class PolylineError extends Error {
  /** Always "PolylineError". */
  readonly name: 'PolylineError';
  /** What went wrong. */
  readonly code: ErrorCode;
  /** Character index (decode) or point index (encode) in the whole input, when there is one. */
  readonly index: number | undefined;
  /** Makes an error; the message gets " at <index>" appended when there's an index. */
  constructor(code: ErrorCode, message: string, index?: number);
}

/** A chunk of input: text, or UTF-8 bytes such as a fetch body or a Node Buffer gives. */
export type Chunk = string | ArrayBuffer | ArrayBufferView;

/** Options of decode and encode, plus `flat`. */
export interface StreamOptions extends Options {
  /**
   * Decode to Float64Array batches ([lat0, lng0, lat1, lng1, ...]) instead
   * of a tuple per point, or encode from flat arrays of numbers. A point
   * may be split between two flat writes.
   */
  flat?: boolean;
}

/** Options with `flat: true`. */
export interface FlatOptions extends StreamOptions {
  /** Float64Array batches, or flat arrays of numbers in. */
  flat: true;
}

/** Options with `flat` false or left out. */
export interface TupleOptions extends StreamOptions {
  /** Tuples, the default. */
  flat?: false;
}

/** One point (a tuple or a {lat, lng} object) or an array of them. An empty array is no points. */
export type PointsChunk = ArrayLike<number> | LatLngLike | ArrayLike<ArrayLike<number> | LatLngLike>;

/**
 * Decodes one polyline that arrives in chunks of text or bytes. A chunk can
 * end anywhere, even inside a value. Bytes are read as UTF-8, so the result
 * is what `decode(await response.text())` gives.
 *
 * Errors are exactly those of `decode` on the whole string: an invalid
 * character throws from the `write` that reads it, with the index in the
 * whole input, and a cut-off string throws `'truncated'` from `end`. After
 * an error, every call throws it again. With `strict: false`, `onIssue`
 * gets the issues decode would report, with indexes in the whole input.
 * After `end`, the decoder starts a new polyline.
 */
export class PolylineDecoder<O extends StreamOptions | number = TupleOptions> {
  /** Reads the options, the same ones decode takes; throws PolylineError `'option'` on a bad one. */
  constructor(options?: O);
  /** Reads a chunk. Returns the points it completed, possibly none. */
  write(chunk: Chunk): O extends FlatOptions ? Float64Array : Point[];
  /** Checks that the input didn't end inside a value or a point (in strict mode), and starts over. Always returns no points. */
  end(): O extends FlatOptions ? Float64Array : Point[];
}

/**
 * Encodes points that arrive a few at a time. Each `write` returns the
 * string for its points; the pieces joined are what `encode` gives for all
 * of them. Errors are those of `encode`, with the point's index in the whole
 * input.
 */
export class PolylineEncoder<O extends StreamOptions | number = TupleOptions> {
  /** Reads the options, the same ones encode takes; throws PolylineError `'option'` on a bad one. */
  constructor(options?: O);
  /**
   * Encodes one point or an array of points, or with `flat` an array of
   * numbers, which doesn't have to end on a whole point.
   */
  write(points: O extends FlatOptions ? ArrayLike<number> : PointsChunk): string;
  /** Checks that no flat point was left incomplete (in strict mode), and starts over. Returns ''. */
  end(): string;
}

/**
 * A TransformStream from text or bytes to points: one array of points per
 * chunk that completed any, or a Float64Array with `flat: true`.
 *
 * ```js
 * const points = response.body.pipeThrough(new DecodeStream(osrm6));
 * ```
 */
export class DecodeStream<O extends StreamOptions | number = TupleOptions> extends TransformStream<Chunk, O extends FlatOptions ? Float64Array : Point[]> {
  /** Takes the options decode takes, plus `flat`. */
  constructor(options?: O);
}

/** A TransformStream from points (one or an array per chunk) to pieces of the polyline. */
export class EncodeStream<O extends StreamOptions | number = TupleOptions> extends TransformStream<O extends FlatOptions ? ArrayLike<number> : PointsChunk, string> {
  /** Takes the options encode takes, plus `flat`. */
  constructor(options?: O);
}

/** Options for one polyline per line. */
export interface LinesOptions extends StreamOptions {
  /**
   * Each line is a JSON object (NDJSON) and this field holds the polyline.
   * Decoding replaces it with the points, encoding with the string.
   */
  field?: string;
  /**
   * What a bad line does. `'throw'` (default) errors the stream with the
   * PolylineError or SyntaxError, which gets the 1-based line number as
   * `line`. `'skip'` leaves the line out and passes the error to `onError`.
   */
  errors?: 'throw' | 'skip';
  /**
   * With `strict: false`, as for decode, with the index in that line and
   * the 1-based line number as `line` on each issue.
   */
  onIssue?(issue: PolylineError & { line: number }): void;
  /** Called with each skipped line's error and its line number, with `errors: 'skip'`. */
  onError?: (error: Error & { line: number }, line: number) => void;
}

/**
 * A TransformStream from text or bytes with one polyline per line (\n or
 * \r\n) to one result per line: its points, or with `field` the line's JSON
 * object with that field decoded. Blank lines are skipped, and a line can be
 * split between chunks anywhere.
 */
export class DecodeLinesStream extends TransformStream<Chunk, any> {
  /** Takes the options decode takes, plus `flat`, `field`, `errors` and `onError`. */
  constructor(options?: LinesOptions | number);
}

/**
 * A TransformStream from one line's points per chunk (or with `field`, an
 * object whose field holds them) to one line of text: the polyline, or the
 * object as JSON with the field encoded, and a \n.
 */
export class EncodeLinesStream extends TransformStream<any, string> {
  /** Takes the options encode takes, plus `flat`, `field`, `errors` and `onError`. */
  constructor(options?: LinesOptions | number);
}

/** Anything `for await` reads, or a ReadableStream (read with a reader where it isn't async iterable, as in older Safari versions). */
export type Source<T> = AsyncIterable<T> | Iterable<T> | ReadableStream<T>;

/**
 * Yields the points of one polyline read from chunks of text or bytes: a
 * fetch body, a Node Readable, an async generator. One point at a time;
 * DecodeStream and PolylineDecoder give whole batches, which is faster.
 *
 * ```js
 * for await (const [lat, lng] of decodeIterable(fs.createReadStream('route.txt'))) { ... }
 * ```
 */
export function decodeIterable(chunks: Source<Chunk> | Chunk, options?: OptionsArg): AsyncGenerator<Point, void, undefined>;

/**
 * Yields the polyline for points (or arrays of points) from any source, in
 * pieces of about 64 KB. For a piece per input as soon as it arrives, use
 * PolylineEncoder or EncodeStream.
 */
export function encodeIterable<O extends StreamOptions | number = TupleOptions>(points: Source<O extends FlatOptions ? ArrayLike<number> : PointsChunk>, options?: O): AsyncGenerator<string, void, undefined>;

/** Yields one result per line of text or bytes, like DecodeLinesStream. */
export function decodeLines(chunks: Source<Chunk> | Chunk, options?: LinesOptions | number): AsyncGenerator<any, void, undefined>;

/** Yields one line of text per array of points (or object, with `field`), like EncodeLinesStream. */
export function encodeLines(items: Source<any>, options?: LinesOptions | number): AsyncGenerator<string, void, undefined>;
