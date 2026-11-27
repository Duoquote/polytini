// JSR copy of openlayers.d.ts. JSR builds its docs without node_modules, so
// ol's classes are described structurally: the factory takes your Polyline
// and LineString classes and returns a subclass of the Polyline class you
// passed, with its type. The npm package's openlayers.d.ts uses ol's own
// types.

/** ol/format/Polyline's constructor options. */
export interface Options {
  /** The factor the coordinates were multiplied by. Default 1e5. */
  factor?: number;
  /** The geometry layout. Default "XY". */
  geometryLayout?: 'XY' | 'XYZ' | 'XYM' | 'XYZM';
}

/** A Polyline format class: ol/format/Polyline or a subclass. */
export type PolylineClass = new (options?: Options) => object;

/** A LineString geometry class: ol/geom/LineString. */
export type LineStringClass = new (...args: never[]) => object;

/** ol's classes, as imported from ol/format/Polyline.js and ol/geom/LineString.js. */
export interface OpenLayersClasses<T extends PolylineClass> {
  /** ol/format/Polyline's default export. */
  Polyline: T;
  /** ol/geom/LineString's default export. */
  LineString: LineStringClass;
}

/** The full build's `ol` namespace. */
export interface OpenLayersNamespace<T extends PolylineClass> {
  /** ol.format, with Polyline. */
  format: { Polyline: T };
  /** ol.geom, with LineString. */
  geom: { LineString: LineStringClass };
}

/**
 * Makes a drop-in for ol/format/Polyline: the same constructor options
 * (factor, geometryLayout), methods and output, faster. Unlike ol's,
 * writeGeometry never changes the geometry it is given.
 */
export function createPolylineFormat<T extends PolylineClass>(ol: OpenLayersClasses<T> | OpenLayersNamespace<T>): T;
