// The GeoJSON types the JSR type files need, written out here because JSR
// builds its docs without node_modules, so `geojson` (@types/geojson) can't
// be imported. The npm type files use @types/geojson itself. These follow
// RFC 7946 and have the same shape as @types/geojson's, so values flow
// between the two.

/** [longitude, latitude], then an optional altitude and anything else. */
export type Position = number[];

/** [west, south, east, north], or with altitudes [west, south, low, east, north, high]. */
export type BBox = [number, number, number, number] | [number, number, number, number, number, number];

/** The properties of a Feature: any JSON object, or null. */
export type GeoJsonProperties = { [name: string]: unknown } | null;

/** A GeoJSON Point. */
export interface Point {
  /** Always "Point". */
  type: 'Point';
  /** The position. */
  coordinates: Position;
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON MultiPoint. */
export interface MultiPoint {
  /** Always "MultiPoint". */
  type: 'MultiPoint';
  /** The positions. */
  coordinates: Position[];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON LineString: two or more positions. */
export interface LineString {
  /** Always "LineString". */
  type: 'LineString';
  /** The positions, [lng, lat]. */
  coordinates: Position[];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON MultiLineString. */
export interface MultiLineString {
  /** Always "MultiLineString". */
  type: 'MultiLineString';
  /** One position array per line. */
  coordinates: Position[][];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON Polygon: the outer ring, then holes. */
export interface Polygon {
  /** Always "Polygon". */
  type: 'Polygon';
  /** One closed position array per ring. */
  coordinates: Position[][];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON MultiPolygon. */
export interface MultiPolygon {
  /** Always "MultiPolygon". */
  type: 'MultiPolygon';
  /** One ring array per polygon. */
  coordinates: Position[][][];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON GeometryCollection. */
export interface GeometryCollection {
  /** Always "GeometryCollection". */
  type: 'GeometryCollection';
  /** The geometries. */
  geometries: Geometry[];
  /** Optional bounding box. */
  bbox?: BBox;
}

/** Any GeoJSON geometry. */
export type Geometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;

/** A GeoJSON Feature. */
export interface Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
  /** Always "Feature". */
  type: 'Feature';
  /** The geometry, or null. */
  geometry: G;
  /** The properties. */
  properties: P;
  /** Optional id. */
  id?: string | number;
  /** Optional bounding box. */
  bbox?: BBox;
}

/** A GeoJSON FeatureCollection. */
export interface FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
  /** Always "FeatureCollection". */
  type: 'FeatureCollection';
  /** The features. */
  features: Feature<G, P>[];
  /** Optional bounding box. */
  bbox?: BBox;
}
