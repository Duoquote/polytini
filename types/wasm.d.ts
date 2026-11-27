// The /wasm entry: the same API as the main entry, after init.
/**
 * The opt-in WebAssembly build: the main entry's API plus decodeMany and
 * encodeMany for many lines in one call. Call init() once first. On
 * Cloudflare Workers, pass it the compiled module.
 *
 * ```js
 * import { init, decodeMany } from '@duoquote/polytini/wasm';
 * await init();
 * const { coords, starts } = decodeMany(lines);
 * ```
 *
 * @module
 */

import type * as P from './index.d.ts';

export type { Point, LatLngLike, Options, OptionsArg, ErrorCode, LineString, LineStringFeature } from './index.d.ts';
/** The main entry's encode. */
export declare const encode: typeof P.encode;
/** The main entry's decode. */
export declare const decode: typeof P.decode;
/** The main entry's encodeFlat. */
export declare const encodeFlat: typeof P.encodeFlat;
/** The main entry's decodeFlat. */
export declare const decodeFlat: typeof P.decodeFlat;
/** The main entry's decodeLatLng. */
export declare const decodeLatLng: typeof P.decodeLatLng;
/** The main entry's toGeoJSON. */
export declare const toGeoJSON: typeof P.toGeoJSON;
/** The main entry's fromGeoJSON. */
export declare const fromGeoJSON: typeof P.fromGeoJSON;
/** The main entry's PolylineError. */
export declare const PolylineError: typeof P.PolylineError;
/** The main entry's PolylineError type. */
export type PolylineError = P.PolylineError;

/**
 * What init and initSync take: a compiled WebAssembly.Module, or the .wasm
 * bytes. Typed with ES types only (WebAssembly's are in TypeScript's DOM
 * library), so these types don't need it.
 */
export type WasmSource = object | ArrayBuffer | ArrayBufferView;

/**
 * Compiles and instantiates the WASM module. Call once before anything else;
 * repeat calls are free. Where the runtime can't compile WebAssembly from
 * bytes (Cloudflare Workers), pass the compiled module:
 * `import wasm from '@duoquote/polytini/polytini.wasm'; await init(wasm)`.
 * Without it there, init throws a PolylineError with code 'init'.
 */
export function init(module?: WasmSource): Promise<void>;

/** The same, synchronously. Fine here because the module is under 1 KB. */
export function initSync(module?: WasmSource): void;

/** Many lines decoded in one call: all points in one array, plus where each line starts. */
export interface ManyLines {
  /** lat, lng pairs (lng, lat with order 'lnglat') of every line, back to back. */
  coords: Float64Array;
  /** The first point index of each line, then the total point count (length + 1 entries), as deck.gl's binary paths expect. */
  starts: Uint32Array;
}

/** Decodes many lines in one WASM call. Strict mode throws on the first bad line. */
export function decodeMany(lines: readonly string[], options?: P.OptionsArg): ManyLines;

/** Encodes many lines in one WASM call: arrays of points, or the { coords, starts } shape decodeMany returns. */
export function encodeMany(lines: readonly (readonly P.Point[])[] | ManyLines, options?: P.OptionsArg): string[];
