// JSR copy of maplibre.d.ts. JSR builds its docs without node_modules, so
// maplibre-gl's and @types/geojson's types can't be imported; the map and
// the specifications are described structurally here, by the methods and
// fields this module uses. The npm package's maplibre.d.ts uses maplibre-gl's
// own types.
import type { Options } from './index.d.ts';
import type { FeatureCollection, LineString, GeoJsonProperties } from './geojson.jsr.d.ts';

export type { Feature, FeatureCollection, Geometry, GeometryCollection, Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, Position, BBox, GeoJsonProperties } from './geojson.jsr.d.ts';

/** The parts of a MapLibre or Mapbox Map this module calls. */
export interface MapLike {
  /** Map#addSource. */
  addSource(id: string, source: GeoJSONSourceSpecification): unknown;
  /** Map#addLayer. */
  addLayer(layer: LineLayerSpecification, beforeId?: string): unknown;
  /** Map#getSource. */
  getSource(id: string): unknown;
}

/** A GeoJSON source specification: { type: 'geojson', data, ...options }. */
export interface GeoJSONSourceSpecification {
  /** Always "geojson". */
  type: 'geojson';
  /** A GeoJSON object or a URL to one. */
  data?: unknown;
  /** Any other source option: lineMetrics, tolerance, promoteId, generateId, attribution, and so on. */
  [option: string]: unknown;
}

/** A line layer specification. */
export interface LineLayerSpecification {
  /** The layer id. */
  id: string;
  /** Always "line". */
  type: 'line';
  /** The source id. */
  source?: string;
  /** Paint properties. */
  paint?: { [property: string]: unknown };
  /** Layout properties. */
  layout?: { [property: string]: unknown };
  /** Any other layer option: filter, minzoom, maxzoom, metadata, slot, and so on. */
  [option: string]: unknown;
}

/** A feature id: a string, or a number for feature state. */
export type FeatureId = string | number;

/** Options for polylineData: polytini's options plus the feature fields. */
export interface DataOptions<P = GeoJsonProperties> extends Options {
  /** Properties for every line, or an array with one object per line. Default {}. */
  properties?: P | P[];
  /** Feature id for every line, or an array with one per line. Feature state needs numeric ids or promoteId. */
  id?: FeatureId | FeatureId[];
  /** Add a [west, south, east, north] bbox to each feature. Default false. */
  bbox?: boolean;
}

/** Options for polylineSource: DataOptions plus extra source options. */
export interface SourceOptions<P = GeoJsonProperties> extends DataOptions<P> {
  /** Other source options: lineMetrics, tolerance, promoteId, generateId, attribution, and so on. */
  source?: { [option: string]: unknown };
}

/** Options for addPolylineLayer: SourceOptions plus the layer. */
export interface LayerOptions<P = GeoJsonProperties> extends SourceOptions<P> {
  /** Merged into the line layer: paint, layout, filter, minzoom, maxzoom, metadata, or another id. */
  layer?: { [option: string]: unknown };
  /** The id of an existing layer to insert the new layer before. */
  beforeId?: string;
}

/** A GeoJSON source specification whose data is a FeatureCollection of LineStrings. */
export interface PolylineSource<P = GeoJsonProperties> extends GeoJSONSourceSpecification {
  /** Always "geojson". */
  type: 'geojson';
  /** One Feature per encoded line. */
  data: FeatureCollection<LineString, P>;
}

/** A FeatureCollection<LineString> ([lng, lat]) with one Feature per encoded string. */
export function polylineData<P = GeoJsonProperties>(encoded: string | string[], options?: number | DataOptions<P>): FeatureCollection<LineString, P>;

/** `{ type: 'geojson', data }` for map.addSource or a style's sources. */
export function polylineSource<P = GeoJsonProperties>(encoded: string | string[], options?: number | SourceOptions<P>): PolylineSource<P>;

/** Adds a GeoJSON source and a line layer, both named `id`. Returns the map. */
export function addPolylineLayer<M extends MapLike, P = GeoJsonProperties>(map: M, id: string, encoded: string | string[], options?: number | LayerOptions<P>): M;

/** Replaces the data of the GeoJSON source `id` and returns what its setData returns. Throws a PolylineError if there is no such GeoJSON source. */
export function setPolylineData<P = GeoJsonProperties>(map: MapLike, id: string, encoded: string | string[], options?: number | DataOptions<P>): unknown;
