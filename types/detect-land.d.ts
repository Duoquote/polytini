// Types for @duoquote/polytini/detect/land.
/**
 * A coarse land mask for `detect`: a grid of 1 by 1 degree cells with land
 * in them, from Natural Earth's 1:110m land (public domain). About 2 KB
 * gzipped, so it's its own import. Coasts are generous: a cell with any
 * land in it counts. Ice shelves count as sea.
 *
 * ```js
 * import { detect } from '@duoquote/polytini/detect';
 * import { isLand } from '@duoquote/polytini/detect/land';
 *
 * detect(str, { isLand });
 * ```
 *
 * @module
 */

/** Whether the 1 by 1 degree cell around a point has land in it. False out of range. */
export function isLand(lat: number, lng: number): boolean;
