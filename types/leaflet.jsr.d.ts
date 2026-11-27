// Types for @duoquote/polytini/leaflet on JSR. JSR doesn't allow module
// augmentation, so this has the plugin's own exports but not the methods it
// adds to Leaflet's classes. The npm package's leaflet.d.ts has those.
/**
 * Leaflet plugin: encoded polylines in and out of L.Polyline and L.Polygon,
 * for Leaflet 1.9 and 2. It also covers the old Polyline.encoded.js plugin's
 * API.
 *
 * ```js
 * import { install } from '@duoquote/polytini/leaflet';
 * install(L);
 * L.Polyline.fromEncoded('_p~iF~ps|U_ulLnnqC_mqNvxq`@', { color: 'red' }).addTo(map);
 * ```
 *
 * @module
 */

import type * as P from './index.d.ts';

/** One encoded line or ring, or nested arrays of them (multi-polylines, holes, multi-polygons). */
export type Encoded = string | Encoded[];

/** Adds fromEncoded, toEncoded, encodePath and the polylineEncoded/polygonEncoded factories. Returns L. */
export function install<T>(L: T): T;

/** The main entry's encode. */
export declare const encode: typeof P.encode;
/** The main entry's decode. */
export declare const decode: typeof P.decode;
