// Types for @duoquote/polytini/detect.
/**
 * Works out how a polyline string was encoded: Google format at which
 * precision, latitude or longitude first, two or three values per point,
 * or HERE's Flexible Polyline. The string doesn't say, so every reading is
 * scored on what real geometry looks like, and you get them ranked.
 *
 * ```js
 * import { detect, decodeAuto } from '@duoquote/polytini/detect';
 *
 * detect(str)[0];  // { format: 'google', precision: 6, order: 'latlng', dimensions: 2, confidence: 0.54, ... }
 * decodeAuto(str); // the same, plus coordinates: [[lat, lng], ...]
 * ```
 *
 * A latitude and longitude swap can't be told apart when both readings
 * land on land: pass `isLand` from `@duoquote/polytini/detect/land` to
 * catch the ones that land at sea.
 *
 * @module
 */
import type { PolylineError } from './index.d.ts';

export type { PolylineError } from './index.d.ts';

/** Options for detect and decodeAuto. */
export interface DetectOptions {
  /** Google-format precisions to try. Default [5, 6, 7, 4, 8]. Each is an integer from 0 to 15. */
  precisions?: number[];
  /** Orders to try. Default both: 'latlng', the format's own, and 'lnglat', a string encoded longitude first. */
  orders?: ('latlng' | 'lnglat')[];
  /** Values per point to try. Default [2, 3]. Three is GraphHopper's and openrouteservice's elevation, in centimeters. */
  dimensions?: (2 | 3)[];
  /** Whether to try HERE's Flexible Polyline. Default true. */
  flexible?: boolean;
  /**
   * Whether a point is on land. Readings with points at sea score lower,
   * which catches most precision mix-ups and swaps that land in an ocean.
   * `isLand` from `@duoquote/polytini/detect/land` is a 1 degree grid
   * (2 KB gzipped); pass your own for a finer one.
   */
  isLand?(lat: number, lng: number): boolean;
  /** How many points to score, spread over the line. Default 256. More is slower and rarely changes the answer. */
  sample?: number;
}

/** One reading of the string, as detect returns it. */
export interface Candidate {
  /** 'google' for the Google encoded polyline format, 'flexible' for HERE's Flexible Polyline. */
  format: 'google' | 'flexible';
  /** Decimal places of latitude and longitude. For 'flexible', from the header. */
  precision: number;
  /**
   * Which value comes first in the string. 'latlng' is the format's own
   * order; 'lnglat' means the string was encoded longitude first. A preset's
   * `order` is about the tuples it returns instead, not the string.
   */
  order: 'latlng' | 'lnglat';
  /** Values per point: 2, or 3 with elevation. */
  dimensions: 2 | 3;
  /** The factor of the third value for 3D Google readings: 100, centimeters. */
  zFactor?: number;
  /** For 'flexible', the third dimension type from the header. */
  thirdDim?: number;
  /** For 'flexible', the third value's precision from the header. */
  thirdDimPrecision?: number;
  /** Names of the presets in `@duoquote/polytini/presets` with this precision and these dimensions. */
  presets: string[];
  /** Probability of this reading among all of them, 0 to 1. They add up to 1. */
  confidence: number;
  /** The log score the confidence comes from. Higher is more plausible. */
  score: number;
  /** Whether strict mode decodes the string this way without an error. */
  valid: boolean;
  /** The PolylineError strict mode throws for this reading, or null. Its index is how far strict decoding got. */
  issue: PolylineError | null;
  /** Why the reading lost points, like '100% of points out of range'. Empty for a reading with nothing against it. */
  reasons: string[];
  /** Options for decode and decodeFlat that give [lat, lng] points for this reading. Empty for 'flexible'. */
  options: { precision?: number; order?: 'latlng' | 'lnglat'; dimensions?: number; zFactor?: number };
}

/** What decodeAuto returns: the best reading and its points. */
export interface Decoded extends Candidate {
  /** [lat, lng] or [lat, lng, z] points, decoded leniently with the best reading. */
  coordinates: number[][];
  /** Every issue lenient decoding reported, as onIssue gets them. Empty for a valid string. */
  issues: PolylineError[];
  /** Every reading, best first, as detect returns them. */
  candidates: Candidate[];
}

/**
 * Every reading of a polyline string, best first. Decodes the string once
 * and scores up to `sample` points per reading. Throws PolylineError
 * 'input' for a non-string and 'option' for a bad option, never for the
 * string's content.
 */
export function detect(str: string, options?: DetectOptions): Candidate[];

/** Detects the encoding, then decodes the string leniently with the best reading. */
export function decodeAuto(str: string, options?: DetectOptions): Decoded;
