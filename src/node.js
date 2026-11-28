// Node entry: the core plus the Buffer fast paths in fast.js.
/* @ts-self-types="../types/index.d.ts" */
import { Buffer } from 'node:buffer';
import { fast } from './fast.js';
import { latLngs, latLngsFlat, toGeo, fromGeo } from './core.js';

export { PolylineError } from './core.js';
// On V8 12 (Node 22 and 23), a pre-sized array of 100,000 points made decode
// about 40% slower than appending. Probably because the big array lands in
// old space and every young point stored into it goes through the write
// barrier, but I haven't profiled the GC to confirm it. V8 13
// and 14 (Node 24 on, and what Bun reports) were 25% faster pre-sized, so
// only V8 12 appends, from 32,768 points.
export const { decode, decodeFlat, encode, encodeFlat } = fast(Buffer, process.versions.v8?.startsWith('12.') ? 32768 : Infinity);
// decodeLatLng builds the objects from decodeFlat on Bun at every length
// (0.57 to 0.79 of the time from 10 points, 0.78 on the real-world lines),
// and on Node 22 and 23 (V8 12) from 256 characters, about 75 points (1,000
// points 0.82, the real-world lines 0.90). Newer V8 keeps the plain tuples:
// on Node 24 the decodeFlat route measured even, and on Node 26 it was 5%
// faster on the real-world lines but the extra check made 10 and 20 point
// lines 3% slower.
const v = process.versions;
export const decodeLatLng = v.bun ? latLngsFlat(decode, decodeFlat, 0) : v.v8?.startsWith('12.') ? latLngsFlat(decode, decodeFlat) : latLngs(decode);
export const toGeoJSON = toGeo(decode);
export const fromGeoJSON = fromGeo(encode);
