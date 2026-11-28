// Browser entry (the "browser" export condition): the portable core, except
// that lines from 100 points encode through TextDecoder (text.js, which has
// the numbers for Chrome, Firefox and WebKit). Decoding stays on the core's
// charCodeAt loop: TextEncoder.encodeInto made it slower in Chrome. No Node,
// Bun or Deno globals.
/* @ts-self-types="../types/index.d.ts" */
import { decode, latLngs, toGeo, fromGeo } from './core.js';
import { encode } from './text.js';

export { decode, decodeFlat, PolylineError } from './core.js';
export { encode, encodeFlat } from './text.js';
export const decodeLatLng = /* @__PURE__ */ latLngs(decode);
export const toGeoJSON = /* @__PURE__ */ toGeo(decode);
export const fromGeoJSON = /* @__PURE__ */ fromGeo(encode);
