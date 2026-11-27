// The polytini command line, minus the part that runs it (src/cli.js).
// No dependencies, and only node: built-ins that Node, Bun and Deno all
// have, so the same code runs under each. Input is read and output written
// in chunks through the /stream classes, so a polyline of millions of points
// or a file of millions of lines needs little memory.
import { createReadStream, readFileSync } from 'node:fs';
import process from 'node:process';
import { PolylineDecoder, PolylineEncoder, PolylineError } from './stream.js';
import { Lines } from './lines.js';

// Kept in sync with package.json and jsr.json by test/cli.test.js.
export const VERSION = '0.1.7';

const HELP = `polytini ${VERSION}: encode and decode Google encoded polylines

Usage:
  polytini encode [lat,lng ...] [options]
  polytini decode [polyline ...] [options]

Input is the arguments, --file <path>, or stdin (also - or --file -).

  encode takes lat,lng pairs as arguments, or reads JSON ([[lat, lng], ...],
         or GeoJSON), CSV with a header, or "lat,lng" lines, and prints one
         polyline per line.
  decode reads one polyline per line and prints coordinates.

Options:
  -p, --precision <n>  decimal places, 0 to 15 (default 5; OSRM polyline6
                       and Valhalla use 6)
      --lnglat         coordinates are [lng, lat], like GeoJSON (GeoJSON
                       input is always read that way)
      --no-strict      accept malformed input instead of failing
  -f, --format <fmt>   decode output: json (default), geojson, csv or lines
      --file <path>    read input from a file
      --lines          one input per line, one output per line (NDJSON)
      --field <name>   with --lines: each line is a JSON object and this
                       field holds the polyline or the coordinates
      --skip-errors    with --lines: report a bad line and go on
  -h, --help           show this help
  -v, --version        show the version

Examples:
  polytini decode "kviyHviWkCbkBsg@guA"
  polytini encode 51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281
  polytini decode -p 6 -f geojson --file route.txt
  polytini decode --lines --file routes.txt
  polytini encode --file points.csv

Polylines can contain \\ \` | and ^, which shells treat specially. Quote
them: single quotes in bash, zsh, fish and PowerShell, double quotes in cmd.
`;

export function parseArgs(argv) {
  const a = { precision: 5, order: 'latlng', strict: true, format: 'json', lines: false, skip: false, rest: [] };
  for (let i = 0, only = false; i < argv.length; i++) {
    const x = argv[i], value = () => argv[++i] ?? die(`${x} needs a value`);
    // A negative number is a coordinate, not an option: encode --lnglat -120.2,38.5.
    if (only || x == '-' || !x.startsWith('-') || /^-[\d.]/.test(x)) a.rest.push(x);
    else if (x == '--') only = true;
    else if (x == '-h' || x == '--help') a.help = true;
    else if (x == '-v' || x == '--version') a.version = true;
    else if (x == '-p' || x == '--precision') a.precision = Number(value());
    else if (x.startsWith('--precision=')) a.precision = Number(x.slice(12));
    else if (x == '--lnglat') a.order = 'lnglat';
    else if (x == '--no-strict') a.strict = false;
    else if (x == '-f' || x == '--format') a.format = value();
    else if (x.startsWith('--format=')) a.format = x.slice(9);
    else if (x == '--file') a.file = value();
    else if (x.startsWith('--file=')) a.file = x.slice(7);
    else if (x == '--lines') a.lines = true;
    else if (x == '--field') a.field = value();
    else if (x.startsWith('--field=')) a.field = x.slice(8);
    else if (x == '--skip-errors') a.skip = true;
    else die(`unknown option ${x}`);
  }
  if (a.field != null) a.lines = true;
  return a;
}

class Usage extends Error {}

/**
 * The input line an error came from, where it matters. Not a property on
 * the error: JavaScriptCore (Bun) already gives every Error a `line`, the
 * line of source code that threw it.
 */
export const lineOf = new WeakMap();
const die = (m) => {
  throw new Usage(m);
};

// Numbers from one CSV or "lat,lng" line: commas, semicolons, tabs or spaces.
const cells = (line) => line.trim().split(/\s*[,;\t]\s*|\s+/);

/** Lines of [a, b] tuples in the given order from parsed JSON: points, lines of points, or GeoJSON. */
export function readPoints(j, order) {
  if (Array.isArray(j)) return Array.isArray(j[0]?.[0]) ? j : [j];
  // GeoJSON: every LineString, MultiLineString part and polygon ring.
  const out = [], flip = (c) => (order == 'lnglat' ? c : c.map(([x, y]) => [y, x]));
  const walk = (g) => {
    if (!g) return;
    if (g.type == 'Feature') walk(g.geometry);
    else if (g.type == 'FeatureCollection') g.features.forEach(walk);
    else if (g.type == 'GeometryCollection') g.geometries.forEach(walk);
    else if (g.type == 'LineString') out.push(flip(g.coordinates));
    else if (g.type == 'MultiLineString' || g.type == 'Polygon') g.coordinates.forEach((c) => out.push(flip(c)));
    else if (g.type == 'MultiPolygon') g.coordinates.forEach((p) => p.forEach((c) => out.push(flip(c))));
  };
  walk(j);
  if (!out.length) die('no LineString in the GeoJSON input');
  return out;
}

// "lat,lng lat,lng ..." as points. Any mix of commas, semicolons and
// whitespace works, because PowerShell passes an unquoted 38.5,-120.2 to a
// .ps1 shim (what pnpm, bunx and npx are there) as "38.5 -120.2".
function pairs(text) {
  const t = cells(text).filter(Boolean), n = t.map(Number);
  const bad = t.findIndex((x, i) => isNaN(n[i]));
  if (bad >= 0) die(`expected numbers, got ${JSON.stringify(t[bad])}`);
  if (n.length % 2) die(`expected lat,lng pairs, got ${n.length} numbers`);
  const out = [];
  for (let i = 0; i < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}

// One whole input through a stream codec, which then starts over: the
// command needs only one copy of the codec, and gives the same results.
const whole = (Codec, o) => {
  let x = new Codec(o);
  return (v) => {
    try {
      const r = x.write(v);
      x.end();
      return r;
    } catch (e) {
      x = new Codec(o);
      throw e;
    }
  };
};

const isJson = (t) => t[0] == '[' || t[0] == '{';
const WS = /\s/;
const lastText = (s, i, e) => {
  while (e > i && WS.test(s[e - 1])) e--;
  return e;
};

// The decoded points as text, one format per -f. Each gets the points in
// batches as they're decoded and writes them out right away. `many` is
// whether there is more than one polyline, which changes json, geojson and
// csv; for the same input the result is what JSON.stringify gave in 0.1.4.
function formatter(fmt, order, many) {
  const [a, b] = order == 'lnglat' ? ['lng', 'lat'] : ['lat', 'lng'];
  const json = (open, close, start, end) => ({
    open: () => open,
    start: (i) => (i ? ',' : '') + start,
    points: (pts, first) => (first ? '' : ',') + JSON.stringify(pts).slice(1, -1),
    end: () => end,
    close: () => close,
  });
  switch (fmt) {
    case 'json':
      return many ? json('[', ']', '[', ']') : json('', '', '[', ']');
    case 'geojson':
      return many
        ? json('{"type":"FeatureCollection","features":[', ']}', '{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[', ']}}')
        : json('', '', '{"type":"LineString","coordinates":[', ']}');
    case 'csv': {
      let line = 0;
      return {
        open: () => (many ? `line,${a},${b}` : `${a},${b}`),
        start: (i) => ((line = i), ''),
        points: (pts) => pts.map((p) => `\n${many ? line + ',' : ''}${p[0]},${p[1]}`).join(''),
        end: () => '',
        close: () => '',
      };
    }
    case 'lines':
      return {
        open: () => '',
        start: (i) => (i ? '\n\n' : ''),
        points: (pts, first) => (first ? '' : '\n') + pts.map((p) => `${p[0]},${p[1]}`).join('\n'),
        end: () => '',
        close: () => '',
      };
    default:
      die(`unknown format ${fmt}: use json, geojson, csv or lines`);
  }
}

// Counts lines with something besides whitespace, as text comes in.
function lineCounter() {
  let n = 0, inLine = false;
  return (s) => {
    for (let i = 0; ; ) {
      const j = s.indexOf('\n', i), e = j < 0 ? s.length : j;
      if (!inLine && /\S/.test(s.slice(i, e))) {
        n++;
        inLine = true;
      }
      if (j < 0) return n;
      inLine = false;
      i = j + 1;
    }
  };
}

/**
 * decode without --lines: one polyline per line, each decoded as its text
 * comes in. Whitespace around a polyline is dropped, like trim() did. The
 * output for one polyline differs from the one for several, so until it's
 * known (`many` undefined), the input is held: for --file, main() reads the
 * file once first instead.
 */
function decodeText(a, out, many) {
  const o = { precision: a.precision, order: a.format == 'geojson' ? 'lnglat' : a.order, strict: a.strict };
  new PolylineDecoder(o);
  let held = many == null && a.format != 'lines' ? [] : null, count = held && lineCounter(), f, dec = null, ws = '', first = true, line = 1, n = 0;
  const begin = (m) => {
    many = m;
    f = formatter(a.format, a.order, m);
    out(f.open());
  };
  if (!held) begin(many ?? false);
  const tag = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (many && e && typeof e == 'object') lineOf.set(e, line);
      throw e;
    }
  };
  const write = (s) => {
    const pts = tag(() => dec.write(s));
    if (pts.length) {
      out(f.points(pts, first));
      first = false;
    }
  };
  // The part of the current line from i to e.
  const feed = (s, i, e) => {
    if (!dec) {
      while (i < e && WS.test(s[i])) i++;
      if (i == e) return;
      dec = new PolylineDecoder(o);
      first = true;
      out(f.start(n));
    }
    const t = lastText(s, i, e);
    if (t == i) return void (ws += s.slice(i, e));
    write(ws + s.slice(i, t));
    ws = s.slice(t, e);
  };
  const endLine = () => {
    if (dec) {
      tag(() => dec.end());
      out(f.end());
      dec = null;
      n++;
    }
    ws = '';
  };
  const text = (s) => {
    for (let i = 0; ; ) {
      const j = s.indexOf('\n', i);
      feed(s, i, j < 0 ? s.length : j);
      if (j < 0) return;
      endLine();
      line++;
      i = j + 1;
    }
  };
  const release = (m) => {
    const h = held;
    held = null;
    begin(m);
    for (const s of h) text(s);
  };
  return {
    push(s) {
      if (!held) return text(s);
      held.push(s);
      if (count(s) > 1) release(true);
    },
    end() {
      if (held) release(false);
      endLine();
      if (!n) out(f.start(0) + f.end());
      out(f.close() + '\n');
    },
  };
}

/** decode --lines: one result per line, written as each line ends. */
function decodeLinesCmd(a, out, warn) {
  const geo = a.format == 'geojson', o = { precision: a.precision, order: geo ? 'lnglat' : a.order, strict: a.strict };
  const decode = whole(PolylineDecoder, o);
  if (a.field != null && !geo && a.format != 'json') die('--field works with -f json or geojson');
  const csv = a.format == 'csv', [x, y] = a.order == 'lnglat' ? ['lng', 'lat'] : ['lat', 'lng'];
  if (!['json', 'geojson', 'csv', 'lines'].includes(a.format)) formatter(a.format);
  if (csv) out(`line,${x},${y}\n`);
  let n = 0;
  const value = (pts) => (geo ? { type: 'LineString', coordinates: pts } : pts);
  return lineCommand(a, warn, (t) => {
    if (a.field != null) {
      const r = JSON.parse(t);
      if (!r || typeof r != 'object') throw new PolylineError('input', 'Expected a JSON object');
      r[a.field] = value(decode(r[a.field]));
      return out(JSON.stringify(r) + '\n');
    }
    const pts = decode(t), i = n++;
    if (csv) out(pts.map((p) => `${i},${p[0]},${p[1]}\n`).join(''));
    else if (a.format == 'lines') out(pts.map((p) => `${p[0]},${p[1]}`).join(' ') + '\n');
    else out(JSON.stringify(value(pts)) + '\n');
  });
}

/** encode --lines: one polyline (or JSON object, with --field) per line. */
function encodeLinesCmd(a, out, warn) {
  const encode = whole(PolylineEncoder, { precision: a.precision, order: a.order, strict: a.strict });
  const one = (v) => {
    if (typeof v == 'string') return isJson(v) ? one(JSON.parse(v)) : pairs(v);
    const lines = Array.isArray(v) && !Array.isArray(v[0]?.[0]) ? [v] : readPoints(v, a.order);
    return lines.length == 1 ? lines[0] : die(`expected one line, got ${lines.length}`);
  };
  return lineCommand(a, warn, (t) => {
    if (a.field == null) return out(encode(one(t)) + '\n');
    const r = JSON.parse(t);
    if (!r || typeof r != 'object') throw new PolylineError('input', 'Expected a JSON object');
    r[a.field] = encode(one(r[a.field]));
    out(JSON.stringify(r) + '\n');
  });
}

// Runs fn on every line with text, with the line number on any error.
// --skip-errors reports it and goes on.
function lineCommand(a, warn, fn) {
  const lines = new Lines();
  let line = 0;
  const each = (l) => {
    line++;
    const t = l.trim();
    if (!t) return;
    try {
      fn(t);
    } catch (e) {
      if (!(e instanceof PolylineError || e instanceof SyntaxError || e instanceof Usage)) throw e;
      lineOf.set(e, line);
      if (!a.skip) throw e;
      warn(`line ${line}: ${e.message} (skipped)`);
    }
  };
  return { push: (s) => lines.push(s, each), end: () => lines.end(each) };
}

/**
 * encode without --lines. JSON input is read whole, since it's one value.
 * CSV and "lat,lng" lines are encoded as they come in.
 */
function encodeText(a, out) {
  const o = { precision: a.precision, order: a.order, strict: a.strict }, encode = whole(PolylineEncoder, o);
  let mode, all = [], csv;
  const push = (s) => {
    if (!mode) {
      const t = s.trimStart();
      if (!t) return void all.push(s);
      mode = isJson(t) ? 'json' : 'csv';
      if (mode == 'csv') {
        csv = csvEncoder(a, o, out);
        for (const x of all) csv.push(x);
        all = null;
      }
    }
    if (mode == 'json') all.push(s);
    else csv.push(s);
  };
  return {
    push,
    end() {
      if (mode == 'json') out(readPoints(JSON.parse(all.join('')), a.order).map(encode).join('\n'));
      else if (csv) csv.end();
      out('\n');
    },
  };
}

// CSV with a header, or "lat,lng" lines without one. A header row picks
// the columns by name; otherwise the first two columns are lat, lng (or
// lng, lat with --lnglat).
function csvEncoder(a, o, out) {
  const lines = new Lines(), enc = new PolylineEncoder(o);
  let line = 0, ia = -1, ib = 1, batch = [];
  const each = (r) => {
    line++;
    if (!r.trim()) return;
    if (ia < 0) {
      ia = 0;
      const head = cells(r).map((c) => c.toLowerCase().replace(/^"|"$/g, ''));
      if (head.some((c) => c && isNaN(c))) {
        const find = (...names) => head.findIndex((c) => names.includes(c));
        const lat = find('lat', 'latitude', 'y'), lng = find('lng', 'lon', 'long', 'longitude', 'x');
        if (lat < 0 || lng < 0) die('CSV header needs lat and lng (or lon, longitude) columns');
        [ia, ib] = a.order == 'lnglat' ? [lng, lat] : [lat, lng];
        return;
      }
    }
    const c = cells(r);
    if (c.length < 2) die(`line ${line}: expected two numbers, got ${JSON.stringify(r.trim())}`);
    batch.push([Number(c[ia]), Number(c[ib])]);
  };
  const flush = () => {
    if (batch.length) out(enc.write(batch));
    batch = [];
  };
  return {
    push(s) {
      lines.push(s, each);
      flush();
    },
    end() {
      lines.end(each);
      flush();
      out(enc.end());
    },
  };
}

/**
 * Parses the arguments and says where the input comes from: `text` (from
 * the arguments), `points` (encode's lat,lng arguments), `file`, or stdin.
 * `make(out, warn, many)` builds the command, which takes the input with
 * push(text) and end() and writes its output through out(text).
 */
export function command(argv) {
  const a = parseArgs(argv);
  if (a.help) return { help: HELP.trimEnd() };
  if (a.version) return { help: VERSION };
  const [cmd, ...args] = a.rest;
  if (cmd != 'encode' && cmd != 'decode') die(cmd ? `unknown command ${cmd}` : 'expected a command: encode or decode');
  if (a.skip && !a.lines) die('--skip-errors works with --lines');
  const dash = args.includes('-');
  if (dash && args.length > 1) die('give - (stdin) or arguments, not both');
  if (args.length && a.file) die('give arguments or --file, not both');
  const c = { a, cmd, file: a.file && a.file != '-' ? a.file : null };
  if (args.length && !dash) {
    // encode's lat,lng pairs, unless it's one argument with JSON or several lines.
    if (cmd == 'encode' && !a.lines && !(args.length == 1 && (isJson(args[0].trim()) || args[0].includes('\n')))) c.points = pairs(args.join(' '));
    else c.text = args.join('\n');
  }
  c.make = (out, warn, many) => {
    if (c.points) {
      const o = { precision: a.precision, order: a.order, strict: a.strict };
      return { push() {}, end: () => out(whole(PolylineEncoder, o)(c.points) + '\n') };
    }
    if (a.lines) return (cmd == 'decode' ? decodeLinesCmd : encodeLinesCmd)(a, out, warn);
    return cmd == 'decode' ? decodeText(a, out, many) : encodeText(a, out);
  };
  // decode's output for one polyline differs from the one for several.
  c.needsCount = cmd == 'decode' && !a.lines && a.format != 'lines';
  return c;
}

/** Runs one command on the whole input at once and returns the output text (no trailing newline). */
export function run(argv, stdin = () => '', warn = (m) => process.stderr.write(`polytini: ${m}\n`)) {
  const c = command(argv);
  if (c.help) return c.help;
  const parts = [];
  const m = c.make((s) => parts.push(s), warn);
  if (!c.points) m.push(c.text ?? (c.file ? readFileSync(c.file, 'utf8') : stdin()));
  m.end();
  return parts.join('').replace(/\n$/, '');
}

const readText = (file) => (file ? createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 16 }) : (process.stdin.setEncoding('utf8'), process.stdin));

/** Runs the CLI with process.argv, reading stdin or a file in chunks, and sets the exit code. */
export async function main() {
  const { stdout, stderr } = process;
  // `polytini decode ... | head` closes the pipe early; that's not an error.
  stdout.on('error', (e) => {
    if (e.code == 'EPIPE') process.exit(process.exitCode ?? 0);
    throw e;
  });
  let buf = '', streaming = false;
  // Output waits until 1 MB or the end, so a small input that fails prints
  // nothing. With --lines it goes out after every chunk of input.
  const flush = async (force) => {
    if (!buf || (!force && !streaming && buf.length < 1 << 20)) return;
    streaming = true;
    const ok = stdout.write(buf);
    buf = '';
    if (!ok) await new Promise((r) => stdout.once('drain', r));
  };
  try {
    const c = command(process.argv.slice(2));
    if (c.help) return void stdout.write(c.help + '\n');
    streaming = c.a.lines;
    let many;
    if (c.needsCount && c.file) {
      // Read the file once to see if it has more than one polyline, so the
      // second read doesn't have to hold anything back.
      const count = lineCounter();
      for await (const s of readText(c.file)) if ((many = count(s) > 1)) break;
    }
    const m = c.make((s) => (buf += s), (msg) => stderr.write(`polytini: ${msg}\n`), many);
    if (c.text != null) m.push(c.text);
    else if (!c.points) {
      for await (const s of readText(c.file)) {
        m.push(s);
        await flush();
      }
    }
    m.end();
    await flush(true);
  } catch (e) {
    const usage = e instanceof Usage, known = usage || e instanceof PolylineError || e instanceof SyntaxError || (e && typeof e.code == 'string' && e.syscall);
    // A small input that fails prints nothing, as before 0.1.7.
    if (streaming) await flush(true);
    stderr.write(`polytini: ${lineOf.has(e) ? `line ${lineOf.get(e)}: ` : ''}${known ? e.message : e?.stack ?? e}\n`);
    if (usage) stderr.write('Run polytini --help for usage.\n');
    // A polyline has no ", so one in an argument is cmd reading a final \"
    // as an escaped quote.
    if (e?.code == 'char' && process.argv.slice(3).some((x) => x.endsWith('"'))) stderr.write('In cmd, double a \\ at the end of a polyline: "...\\\\"\n');
    process.exitCode = usage ? 2 : 1;
  }
}
