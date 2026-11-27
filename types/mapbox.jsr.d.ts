// JSR copy of mapbox.d.ts: the same functions as the maplibre module, which
// take the same calls on a Mapbox map. Structural types, for the same reason
// as maplibre.jsr.d.ts. The npm package's mapbox.d.ts uses mapbox-gl's own
// types.
/**
 * Mapbox GL JS 3: the same functions as `/maplibre`, which make the same
 * calls on a Mapbox map.
 *
 * ```js
 * import { addPolylineLayer } from '@duoquote/polytini/mapbox';
 * map.on('load', () => addPolylineLayer(map, 'route', encoded));
 * ```
 *
 * @module
 */

export * from './maplibre.jsr.d.ts';
