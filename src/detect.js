// Works out how a polyline string was most likely encoded: Google format at
// which precision, latitude or longitude first, two or three values per
// point (GraphHopper and openrouteservice put elevation third), or HERE's
// Flexible Polyline.
//
// A Google-format string doesn't say any of that, so each reading is scored
// on what real geometry looks like:
//
// - every coordinate in range (a precision 6 string read at 5 gives
//   latitudes ten times too big, usually past 90)
// - a typical distance between points of tens to hundreds of meters
// - no jumps thousands of times longer than the typical step (what a wrong
//   number of values per point looks like)
// - elevation people live and drive at, for three values per point
// - each step going on roughly in the direction of the last one (a wrong
//   number of values per point mixes up the axes, and the directions go
//   random)
// - with an isLand option, points on land
// - valid in strict mode under that reading
// - a prior: precision 5 is the most common, then 6; latitude first is the
//   format's own order
//
// The string is decoded once, with the core's decodeFlat at factor 1, which
// gives the integer values every Google reading shares: a precision only
// divides them, an order swaps two, and three values per point regroup
// them. Scoring then looks at up to `sample` points spread over the line,
// so a long line costs one fast decode plus a fixed amount of work. The
// scores become probabilities with a softmax.
/* @ts-self-types="../types/detect.d.ts" */
import { decode, decodeFlat, fail, PolylineError } from './core.js';
import { decode as flexDecode, header as flexHeader } from './flexible.js';
import { presets as PRESETS } from './presets.js';

const R = 6371008.8, RAD = Math.PI / 180;

// Log-score priors. Precision 5 is Google's, OSRM's and Mapbox's default, 6
// is polyline6 and Valhalla's, 7 is rare. Other precisions are tried only
// when asked for.
const prior = (p) => [-5, -4.5, -4, -3.5, -2, 0, -0.3, -1.2, -2.5][p] ?? -5;

/** Great-circle distance in meters. */
const dist = (a, b, c, d) => {
  const h = Math.sin((c - a) * RAD / 2) ** 2 + Math.cos(a * RAD) * Math.cos(c * RAD) * Math.sin((d - b) * RAD / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

// A typed array sorts numbers without a comparator: 3 times as fast as an
// array with one for 256 steps on Node 25, 5 times on Bun 1.4.
function median(xs) {
  const s = Float64Array.from(xs).sort(), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * How much n points look like real geometry. `at(k)` gives point k as
 * [lat, lng] or [lat, lng, z]. Returns [score, reasons].
 */
function plausibility(n, at, three, isLand, sample) {
  const reasons = [];
  if (!n) return [-20, ['no points']];
  let score = 0, out = 0, seen = 0, land = 0, landSeen = 0, bends = 0, ahead = 0;
  const steps = [], zs = [];
  // Every point of a short line, or `sample` spread-out runs of three.
  const every = n - 1 <= sample ? 1 : (n - 1) / sample;
  for (let j = 0, k = 0; k < n; k = Math.floor(++j * every)) {
    const p = at(k), q = k + 1 < n && at(k + 1), r = k + 2 < n && at(k + 2);
    seen++;
    if (!(Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) out++;
    else if (isLand) {
      landSeen++;
      if (isLand(p[0], p[1])) land++;
    }
    if (three) zs.push(p[2]);
    if (!q) continue;
    const d = dist(p[0], p[1], q[0], q[1]);
    if (d > 0) steps.push(d);
    if (!r) continue;
    // The turn at q in local meters (degrees of latitude, really).
    const c = Math.cos(q[0] * RAD), ax = (q[1] - p[1]) * c, ay = q[0] - p[0], bx = (r[1] - q[1]) * c, by = r[0] - q[0];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    // How much each step goes on in the direction of the last one: cos of
    // the turn. Real lines mostly go straight on (the median was 0.85 on the
    // real-world lines, and 1 in 100 under 0.54). A wrong number of values
    // per point mixes latitude, longitude and elevation deltas, and the
    // directions go random: about 0.
    if (la && lb) {
      bends++;
      ahead += (ax * bx + ay * by) / (la * lb);
    }
  }
  if (out) {
    score -= 8 + (20 * out) / seen;
    reasons.push(Math.round((100 * out) / seen) + '% of points out of range');
  }
  if (landSeen) {
    const f = land / landSeen;
    score += 1.5 * Math.log(0.1 + f);
    if (f < 0.5) reasons.push(Math.round(100 * f) + '% of points on land');
  }
  if (steps.length) {
    let max = 0;
    for (const d of steps) if (d > max) max = d;
    const med = median(steps), decades = Math.log10(med) - 1.8;
    // Broad and capped: 1 Hz walking tracks (about 1 m) and simplified
    // overview lines (Mapbox's example has 3.5 km steps, Google's 250 km) are
    // both real, so this only tips close calls, and a few steps say little.
    // Range decides the rest. 63 m in the middle, as the real-world lines'
    // median step was 45 m, and twice as broad above as below.
    score += Math.max(-3, -(decades * decades) / (decades > 0 ? 12.5 : 4.5)) * Math.min(1, steps.length / 10);
    if (Math.abs(decades) > 1.5) reasons.push('typical step ' + (med < 1 ? med.toFixed(2) : Math.round(med)) + ' m');
    if (steps.length > 10 && max / med > 1e4) {
      score -= Math.min(4, Math.log10(max / med / 1e4) + 1);
      reasons.push('huge jumps between points');
    }
  }
  if (bends >= 3 && ahead / bends < 0.45) {
    score -= 8 * (0.45 - ahead / bends) * Math.min(1, bends / 10);
    reasons.push('no direction from one step to the next');
  }
  if (three) {
    let sane = 0;
    for (const z of zs) if (z > -500 && z < 9000) sane++;
    sane /= zs.length;
    score += 2 * Math.log(0.02 + sane);
    if (sane < 0.9) reasons.push('elevation out of range');
  }
  return [score, reasons];
}

const presetsFor = (precision, dimensions, zFactor) =>
  Object.keys(PRESETS).filter((k) => {
    const p = PRESETS[k];
    return p.precision == precision && (p.dimensions ?? 2) == dimensions && p.zFactor == zFactor;
  });

/**
 * Every reading of a polyline string, best first, each with its confidence
 * (the probabilities add up to 1) and why it lost points.
 */
export function detect(str, options) {
  if (typeof str != 'string') fail('input', 'Expected a string');
  const o = options || {}, isLand = o.isLand, sample = o.sample ?? 256;
  if (!(sample >= 2)) fail('option', 'Invalid sample');
  const precisions = o.precisions ?? [5, 6, 7, 4, 8], orders = o.orders ?? ['latlng', 'lnglat'], dims = o.dimensions ?? [2, 3];
  const list = [];

  // The integer values, summed per axis for two per point, once for every
  // Google reading. Lenient, with the first issue strict mode would throw.
  let issue = null, bad = 0;
  const raw = decodeFlat(str, { precision: 0, strict: false, onIssue: (e) => (issue ??= e, e.code == 'char' && bad++) });
  // How many values there are and whether the string ends inside one. Only
  // needed for a cut-off string: raw lost its incomplete last point.
  let n = raw.length, inside = false;
  if (issue) {
    n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i) - 63;
      if (c >= 0 && c < 64) (inside = c > 31), (n += c < 32);
    }
  }
  // Three per point: the values regrouped, from the deltas of the pairs.
  // When raw dropped a last odd value that a third one completes, decode
  // them again, three per point.
  let raw3 = null;
  if (dims.includes(3)) {
    if (n > raw.length && !inside && n % 3 == 0) raw3 = decodeFlat(str, { precision: 0, dimensions: 3, strict: false });
    else {
      raw3 = new Float64Array(raw.length);
      for (let k = 0; k < raw.length; k++) raw3[k] = (k > 2 ? raw3[k - 3] : 0) + raw[k] - (k > 1 ? raw[k - 2] : 0);
    }
  }
  // Invalid characters mean the string is damaged or not Google format.
  const penalty = bad ? -1.5 - (6 * bad) / str.length : 0;

  for (const d of dims) {
    if (d != 2 && d != 3) fail('option', 'Invalid dimensions');
    const v = d == 2 ? raw : raw3, count = Math.floor(v.length / d) || 0;
    // Strict mode's first error under this reading: a bad character or
    // value comes first; a cut-off end depends on the values per point.
    const cut = inside || n % d;
    const err = issue && issue.code != 'truncated' ? issue : cut ? (issue ?? new PolylineError('truncated', 'Truncated', str.length)) : null;
    for (const order of orders) {
      if (order != 'latlng' && order != 'lnglat') fail('option', 'Invalid order');
      const a = +(order == 'lnglat');
      for (const precision of precisions) {
        if (!(precision >= 0 && precision <= 15 && precision % 1 == 0)) fail('option', 'Invalid precision');
        const f = 10 ** precision, zf = 100;
        const at = (k) => (d == 2 ? [v[2 * k + a] / f, v[2 * k + 1 - a] / f] : [v[3 * k + a] / f, v[3 * k + 1 - a] / f, v[3 * k + 2] / zf]);
        let [score, reasons] = plausibility(count, at, d == 3, isLand, sample);
        score += prior(precision) + (a ? -0.8 : 0) + (d == 3 ? -0.5 : 0) + penalty;
        // Cut off under this reading, and not under another one.
        if (err && err.code == 'truncated') {
          score -= 2;
          reasons.push('cut off with ' + d + ' values per point');
        }
        const zFactor = d == 3 ? zf : undefined;
        list.push({
          format: 'google',
          precision,
          order,
          dimensions: d,
          ...(d == 3 && { zFactor }),
          presets: presetsFor(precision, d, zFactor),
          confidence: 0,
          score,
          valid: !err,
          issue: err,
          reasons,
          options: { precision, order, dimensions: d, ...(d == 3 && { zFactor }) },
        });
      }
    }
  }

  // HERE Flexible Polyline: its own alphabet (letters, digits, - and _) and
  // a header that starts with the version, 1, written as B.
  if (o.flexible !== false && /^B[\w-]+$/.test(str)) {
    let h = null;
    try {
      h = flexHeader(str);
    } catch {
      // Not a header.
    }
    if (h) {
      let first = null;
      const pts = flexDecode(str, { strict: false, onIssue: (e) => (first ??= e) }).polyline, three = h.thirdDim > 0;
      // Elevation is the only third value worth checking for range.
      let [score, reasons] = plausibility(pts.length, (k) => pts[k], three && (h.thirdDim == 2 || h.thirdDim == 3), isLand, sample);
      // Digits and - can't appear in Google format at all.
      if (/[\d-]/.test(str)) score += 1.5;
      if (first) score -= 2;
      list.push({ format: 'flexible', precision: h.precision, order: 'latlng', dimensions: three ? 3 : 2, thirdDim: h.thirdDim, thirdDimPrecision: h.thirdDimPrecision, presets: [], confidence: 0, score, valid: !first, issue: first, reasons, options: {} });
    }
  }

  if (!list.length) fail('option', 'Nothing to try');
  list.sort((x, y) => y.score - x.score);
  const top = list[0].score;
  let sum = 0;
  for (const c of list) sum += c.confidence = Math.exp(c.score - top);
  for (const c of list) c.confidence /= sum;
  return list;
}

/**
 * Detects the encoding and decodes the string with the best reading.
 * Returns that reading with `coordinates` ([lat, lng] or [lat, lng, z]
 * points), every issue lenient decoding reported, and the other
 * `candidates`.
 */
export function decodeAuto(str, options) {
  const candidates = detect(str, options), best = candidates[0], issues = [];
  const onIssue = (e) => issues.push(e);
  const coordinates = best.format == 'flexible' ? flexDecode(str, { strict: false, onIssue }).polyline : decode(str, { ...best.options, strict: false, onIssue });
  return { ...best, coordinates, issues, candidates };
}
