// Types for @duoquote/polytini/openlayers. Type-only imports: nothing from
// ol is loaded at runtime, you pass its classes to createPolylineFormat.
import type OlPolyline from 'ol/format/Polyline.js';
import type { Options } from 'ol/format/Polyline.js';
import type OlLineString from 'ol/geom/LineString.js';

export type { Options };

/** ol's classes, as imported from ol/format/Polyline.js and ol/geom/LineString.js. */
export interface OpenLayersClasses {
  Polyline: typeof OlPolyline;
  LineString: typeof OlLineString;
}

/**
 * Makes a drop-in for ol/format/Polyline: the same constructor options
 * (factor, geometryLayout), methods and output, faster. Unlike ol's,
 * writeGeometry never changes the geometry it is given. Also takes the `ol`
 * namespace of the full build ({ format: { Polyline }, geom: { LineString } }).
 */
export function createPolylineFormat(
  ol: OpenLayersClasses | { format: { Polyline: typeof OlPolyline }; geom: { LineString: typeof OlLineString } },
): typeof OlPolyline;
