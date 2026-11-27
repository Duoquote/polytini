// Node entry: the core plus the Buffer fast paths in fast.js.
/* @ts-self-types="../types/index.d.ts" */
import { decode, encode } from './fast.js';
import { latLngs, toGeo, fromGeo } from './core.js';

export { PolylineError } from './core.js';
export { decode, decodeFlat, encode, encodeFlat } from './fast.js';
export const decodeLatLng = /* @__PURE__ */ latLngs(decode);
export const toGeoJSON = /* @__PURE__ */ toGeo(decode);
export const fromGeoJSON = /* @__PURE__ */ fromGeo(encode);
