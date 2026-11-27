// Type check of @duoquote/polytini/stream. Not run, only compiled:
// npx tsc -p test/fixtures/stream
import {
  PolylineDecoder,
  PolylineEncoder,
  DecodeStream,
  EncodeStream,
  DecodeLinesStream,
  EncodeLinesStream,
  decodeIterable,
  encodeIterable,
  decodeLines,
  encodeLines,
  PolylineError,
  type Point,
} from '@duoquote/polytini/stream';
import { osrm6 } from '@duoquote/polytini/presets';

const d = new PolylineDecoder();
const pts: Point[] = d.write('_p~iF~ps|U');
const more: Point[] = d.end();
const bytes: Point[] = new PolylineDecoder(6).write(new Uint8Array([95, 112]));
const flat: Float64Array = new PolylineDecoder({ flat: true, precision: 6 }).write('_p~iF~ps|U');
const preset: Point[] = new PolylineDecoder(osrm6).write('_p~iF~ps|U');

const e = new PolylineEncoder({ order: 'lnglat' });
const s: string = e.write([-120.2, 38.5]) + e.write([[-120.95, 40.7]]) + e.write({ lat: 1, lng: 2 }) + e.end();
const sf: string = new PolylineEncoder({ flat: true }).write(new Float64Array([38.5, -120.2]));

async function streams(res: Response) {
  const points: ReadableStream<Point[]> = res.body!.pipeThrough(new DecodeStream());
  const batches: ReadableStream<Float64Array> = res.body!.pipeThrough(new DecodeStream({ flat: true }));
  const text: ReadableStream<string> = points.pipeThrough(new EncodeStream());
  const lines: ReadableStream<any> = res.body!.pipeThrough(new DecodeLinesStream({ field: 'shape', errors: 'skip', onError: (err, line) => console.log(err.message, err.line, line) }));
  const out: ReadableStream<string> = lines.pipeThrough(new EncodeLinesStream({ field: 'shape' }));
  for await (const p of decodeIterable(res.body!)) p[0].toFixed(5);
  for await (const p of decodeIterable(['_p~iF', '~ps|U'], { precision: 5 })) p[1].toFixed(5);
  for await (const piece of encodeIterable([[38.5, -120.2]])) piece.length;
  for await (const r of decodeLines('a\nb', 5)) r;
  for await (const r of encodeLines([[[1, 2]]])) r.trim();
  return [batches, text, out];
}

try {
  new PolylineDecoder().end();
} catch (err) {
  if (err instanceof PolylineError) err.code satisfies 'char' | 'truncated' | 'overflow' | 'coordinate' | 'input' | 'option' | 'init';
}

// @ts-expect-error encode options don't take a string
new PolylineEncoder({ order: 'xy' });
// @ts-expect-error flat writes take numbers
new PolylineEncoder({ flat: true }).write([[1, 2]]);

export { pts, more, bytes, flat, preset, s, sf, streams };
