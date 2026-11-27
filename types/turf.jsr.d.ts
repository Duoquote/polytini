// JSR copy of turf.d.ts. JSR builds its docs without node_modules, so the
// GeoJSON types come from geojson.jsr.d.ts and Turf's Id and AllGeoJSON are
// written out here. They have the same shapes as @types/geojson's and
// @turf/helpers', which the npm package's turf.d.ts uses.
import type { Options } from './index.d.ts';
import type { Feature, FeatureCollection, Geometry, LineString, Polygon, GeoJsonProperties } from './geojson.jsr.d.ts';

export type { Feature, FeatureCollection, Geometry, GeometryCollection, Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, Position, BBox, GeoJsonProperties } from './geojson.jsr.d.ts';

/** A feature id, like Turf's Id. */
export type Id = string | number;

/** Any GeoJSON object, like Turf's AllGeoJSON. */
export type AllGeoJSON = Feature<Geometry | null> | FeatureCollection<Geometry | null> | Geometry;

/** Options for toFeature and toPolygonFeature. */
export interface FeatureOptions<P = GeoJsonProperties> extends Options {
  /** Feature properties. Default {}. */
  properties?: P;
  /** Feature id. */
  id?: Id;
  /** Add a [west, south, east, north] bbox. Default false. */
  bbox?: boolean;
}

/** Options for toFeatureCollection. */
export interface CollectionOptions<P = GeoJsonProperties> extends Options {
  /** Shared properties, or one object per line. */
  properties?: P | P[];
  /** One id per line, or the same for all. */
  id?: Id | Id[];
  /** Add a bbox to each feature. Default false. */
  bbox?: boolean;
}

/** A Feature<LineString> ([lng, lat], like Turf) from one encoded line. */
export function toFeature<P = GeoJsonProperties>(encoded: string, options?: number | FeatureOptions<P>): Feature<LineString, P>;

/** A FeatureCollection<LineString>, one Feature per string. */
export function toFeatureCollection<P = GeoJsonProperties>(encoded: string[], options?: number | CollectionOptions<P>): FeatureCollection<LineString, P>;

/** A Feature<Polygon> from encoded rings: outer first, then holes. */
export function toPolygonFeature<P = GeoJsonProperties>(rings: string[], options?: number | FeatureOptions<P>): Feature<Polygon, P>;

/** Every line in any GeoJSON: LineStrings, MultiLineString parts and polygon rings, in document order. Points are skipped. */
export function fromGeoJSON(geojson: AllGeoJSON, options?: number | Options): string[];
