// The benchmark inputs from the polyline-benchmark repo, for the tests and
// bench/ scripts here: the generated GPS-like tracks (fixtures-core.js) and
// the 1000 real-world lines from the original 2021 benchmark, PostGIS
// ST_AsEncodedPolyline output at precision 5 (fixtures/real-world.csv).
import { makeFixtures, makeFlexFixtures } from './fixtures-core.js';
import { text } from './lib.js';

export { rng, ANCHORS, gpsTrack, makeFixtures, makeFlexFixtures } from './fixtures-core.js';

const csv = await text('fixtures/real-world.csv');
const lines = csv.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.replace(/^"|"$/g, ''));

/** The 1000 real-world encoded polylines, precision 5. */
export const realWorldLines = () => lines;
export const benchFixtures = (precision = 5) => makeFixtures(precision, precision === 5 ? lines : []);
export const flexFixtures = (precision, encode) => makeFlexFixtures(precision, precision === 5 ? lines : [], encode);
