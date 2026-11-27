// JSR copy of google.d.ts. JSR's type output can't carry the
// @types/google.maps reference, so the Maps shapes are described
// structurally here: anything with lat() and lng() is a LatLng. The npm
// package's google.d.ts uses the real google.maps types.
import type * as P from './index.d.ts';
import type { Options, Point } from './index.d.ts';

/** Anything with lat() and lng(), such as google.maps.LatLng. */
export interface LatLng {
  /** Latitude in degrees. */
  lat(): number;
  /** Longitude in degrees. */
  lng(): number;
}
/** A plain { lat, lng } object, like google.maps.LatLngLiteral. */
export interface LatLngLiteral {
  /** Latitude in degrees. */
  lat: number;
  /** Longitude in degrees. */
  lng: number;
}
/** Anything with getArray(), such as google.maps.MVCArray. */
export interface MVCArrayLike<T> {
  /** The items as an array. */
  getArray(): T[];
}

/** The main entry's PolylineError. */
export declare const PolylineError: typeof P.PolylineError;
/** The main entry's PolylineError type. */
export type PolylineError = P.PolylineError;

/** A LatLng constructor: LatLng or anything built the same way. */
export type LatLngConstructor = new (lat: number, lng: number, noClampNoWrap?: boolean) => LatLng;

/** Options for decodePath: polytini's options without order, plus the LatLng class. */
export interface DecodePathOptions extends Omit<Options, 'order'> {
  /**
   * The class to build points with. Default: globalThis.LatLng
   * when it exists. false or null returns LatLngLiteral objects.
   */
  LatLng?: LatLngConstructor | false | null;
  /** Passed to the LatLng constructor. Without it, LatLng clamps latitude and wraps longitude into [-180, 180). */
  noClampNoWrap?: boolean;
}

/** A point encodePath takes: LatLng, LatLngLiteral or a [lat, lng] tuple. */
export type PathPoint = LatLng | LatLngLiteral | Point;

/**
 * Decodes an encoded path to LatLngLiteral objects (`LatLng: false`).
 */
export function decodePath(encodedPath: string, options: DecodePathOptions & { LatLng: false | null }): LatLngLiteral[];
/**
 * Decodes an encoded path, like google.maps.geometry.encoding.decodePath,
 * to LatLng objects. Without a `LatLng` option this uses
 * globalThis.LatLng; when the Maps JavaScript API isn't loaded
 * the result is LatLngLiteral objects at runtime, so pass `LatLng: false`
 * there to get that type. Strict by default: a malformed string throws a
 * PolylineError unless `strict: false`.
 */
export function decodePath(encodedPath: string, options?: number | (DecodePathOptions & { LatLng?: LatLngConstructor })): LatLng[];
/** decodePath when the LatLng option isn't known until runtime. */
export function decodePath(encodedPath: string, options?: number | DecodePathOptions): LatLng[] | LatLngLiteral[];

/**
 * Encodes a path, like google.maps.geometry.encoding.encodePath: an array or
 * MVCArray of LatLng, LatLngLiteral or [lat, lng] tuples, mixed
 * or not. Precision 5 by default. `order: 'lnglat'` applies to tuples and
 * LatLng objects; literals are read by name. Strict by default.
 */
export function encodePath(path: readonly PathPoint[] | MVCArrayLike<PathPoint>, options?: number | Options): string;
