// The benchmark inputs from the polyline-benchmark repo, for the tests and
// bench/ scripts here: the generated GPS-like tracks (fixtures-core.js) and
// the 1000 real-world lines from the original 2021 benchmark, PostGIS
// ST_AsEncodedPolyline output at precision 5 (fixtures/real-world.csv).
import { makeFixtures, makeFlexFixtures } from './fixtures-core.js';

export { rng, ANCHORS, gpsTrack, makeFixtures, makeFlexFixtures } from './fixtures-core.js';

async function read(url) {
  if (globalThis.Deno) return Deno.readTextFile(url);
  const { readFile } = await import('node:fs/promises');
  return readFile(url, 'utf8');
}

const csv = await read(new URL('fixtures/real-world.csv', import.meta.url));
const lines = csv.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.replace(/^"|"$/g, ''));

/** The 1000 real-world encoded polylines, precision 5. */
export const realWorldLines = () => lines;
export const benchFixtures = (precision = 5) => makeFixtures(precision, precision === 5 ? lines : []);
export const flexFixtures = (precision, encode) => makeFlexFixtures(precision, precision === 5 ? lines : [], encode);
