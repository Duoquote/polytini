// Types for @duoquote/polytini/lite.
/**
 * The smallest build: `decode` and `encode` for 2D lines at precision 0 to
 * 6, with a precision number and nothing else. About 300 bytes gzipped for
 * decode only and 500 for both, against 1.1 and 1.9 KB for the default
 * entry, at the same speed as the default entry's portable loops. Same
 * output as the default entry for everything it accepts, and it still throws
 * on invalid characters, truncated strings and coordinates it can't encode,
 * with a plain `Error` (no `code` or `index`).
 *
 * ```js
 * import { encode, decode } from '@duoquote/polytini/lite';
 * encode([[38.5, -120.2], [40.7, -120.95]]); // '_p~iF~ps|U_ulLnnqC'
 * decode('_p~iF~ps|U_ulLnnqC');              // [[38.5, -120.2], [40.7, -120.95]]
 * decode(str, 6);                            // precision 6, [lat, lng]
 * ```
 *
 * @module
 */

/** A point as [lat, lng], what decode returns. */
export type Point = [lat: number, lng: number];

/**
 * Decodes a polyline to [lat, lng] tuples.
 *
 * Throws `Error('Invalid polyline')` on a character outside `?` to `~`, a
 * string that ends inside a value or after a latitude, a value too big for
 * 32-bit math (a step past 2^29 units, which no valid coordinate makes), and
 * a precision other than 0 to 6.
 *
 * @param str The encoded polyline.
 * @param precision Decimal places, 0 to 6. Default 5.
 */
export declare function decode(str: string, precision?: number): Point[];

/**
 * Encodes [lat, lng] tuples. Rounds half away from zero, like the default
 * entry.
 *
 * Throws `Error('Invalid coordinate')` on NaN, Infinity, a missing value, a
 * non-number that doesn't convert to one, a coordinate past 2^29 units after
 * scaling (about 536 degrees at precision 6), and a precision other than 0
 * to 6 (on the first point). Objects like `{ lat, lng }` need the default
 * entry.
 *
 * @param points [lat, lng] tuples, or any array-likes of two numbers. Values after the second are ignored.
 * @param precision Decimal places, 0 to 6. Default 5.
 */
export declare function encode(points: ArrayLike<ArrayLike<number>>, precision?: number): string;
