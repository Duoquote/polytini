# Platforms, WASM, size and speed

## Platform notes

Each entry only has its own code where it measured faster than the portable core on that runtime. The numbers here are million points per second at 10,000 points from the 26 November 2026 benchmark run, each entry against `/web`:

- Node (`src/node.js`): encoding writes bytes into a reused `Buffer` and turns them into a string with one `latin1Slice` call, instead of building the string piece by piece. That was 1.6 to 1.8 times faster (109 against 66 on Node 24). Decoding copies the string into a `Buffer`, counts the points first so the output array is allocated once at its final size, then reads the copy. That was 1 to 14% faster on Node 22 and 24 to 26, and 43% on Node 23, which I'd put partly down to noise. On Node 22 and 23 (V8 12), results over 32,768 points are built by appending instead, which was faster there and slower on newer V8. The copy was `ucs2Write` until 0.1.3 and is `utf8Write` now: see [what changed after 0.1.3](#what-changed-after-013).
- Bun (`src/bun.js`): the same code as Node. The `Buffer` encoder was 2.3 times faster than the core (159 against 70). The `Buffer` decoder used to measure within 5% of the core on Bun 1.4.3, ahead in some sizes and behind in others. A paired run showed where: it was 6 to 9% slower at 40 and 100 points, even from 1,000 points, and 3 to 5% faster on the real-world lines. With `utf8Write` it's even with the core up to 100 points, 9% faster at 10,000 and 10% faster on the real-world lines, so Bun keeps the Node entry.
- Deno (`src/deno.js`): `node:buffer` was slower than the core under Deno, so this entry uses `TextEncoder.encodeInto` and `TextDecoder` on a reused byte array instead. Encoding was 1.5 times faster (103 against 69), decoding about 6% (86 against 81). The decoder is `new TextDecoder()`, UTF-8, since the bytes are ASCII anyway: in Deno 2.5 it makes the string about 3 times as fast as the `'latin1'` one it used until 0.1.3. Lines under 16 points encode through the core, because the `TextDecoder` call has a fixed cost.
- Browsers (`src/browser.js`): lines from 512 points encode through `TextDecoder('latin1')`, 1.6 times faster in Chrome (121 against 77). Chrome is the other way around from Deno: the UTF-8 decoder was 5 to 6% slower from 10,000 points up, and starting at fewer points made the real-world lines 13% slower. Decoding stays on the core's `charCodeAt` loop, because `encodeInto` made it slower in Chrome.
- Cloudflare Workers (the `workerd` condition, `src/deno.js`): the Deno entry, since it uses nothing Deno-only. Wrangler picked `src/browser.js` before this condition existed, and the Deno entry decoded faster than that in every run I did in workerd. It keeps the 512-point switch for encoding: starting at 16 made the real-world lines 6% slower there. See [Workers](#cloudflare-workers).
- Everything else (`src/web.js`): the core alone. It uses no Node, Bun or Deno globals.

## WASM

There's an opt-in WebAssembly build: a hand-written WAT module that assembles to 906 bytes, inlined as base64 so it loads the same way in browsers, bundlers, Node, Bun and Deno. Nothing loads it unless you import it:

```js
import { init, decodeFlat, decodeMany, encodeMany } from '@duoquote/polytini/wasm';

await init();                                   // once; initSync() also works
decodeFlat(str);                                // Float64Array, like the main entry
const { coords, starts } = decodeMany(lines);   // every line in one call, deck.gl's binary layout
encodeMany(listOfLines);                        // string[]
```

It has the main entry's whole API, plus `decodeMany` and `encodeMany`. Where it helps:

- typed arrays on long lines (`decodeFlat`, `encodeFlat` from about 1,000 points)
- many lines in one call (`decodeMany`), where the cost of calling into WASM is paid once instead of per line

Where it doesn't, it hands the call to the JavaScript core, because that measured faster on every runtime: decoding to `[lat, lng]` arrays (building the arrays is most of the work, and reading the numbers back out of WASM memory only added to it) and lines under about 30 points (calling in and moving the data costs more than the work).

What made the difference, from profiling each step on Node, Bun and Deno:

- The encoder works in 32-bit integers with the same 2^29 limit and rounding as the JS fast path, with no function call per character. The WASM loop alone went from 8.2 to 5.2 ns per point on Node.
- Strings go in with `TextEncoder.encodeInto` as one byte per character, which removed a branch per character.
- One instance and one memory for the whole program. The memory grows to fit the biggest call and stays.
- Deno has a global `Buffer` whose `latin1Slice` is a JavaScript polyfill; reading strings out through it made encoding twice as slow there, so the glue uses `TextDecoder` on Deno.
- Batch calls: `decodeMany` and `encodeMany` cross into WASM once for any number of lines.

In the benchmark, WASM's speed divided by the JS entry's for the same call, in the same run (above 1.00 means WASM was faster), before these changes (26 November) and after (27 November):

| | Bun 1.4.3 | Node 24 | Deno 2.5 | Chrome 157 |
|---|--:|--:|--:|--:|
| `decodeFlat`, 1,000 points | 0.91 to 1.01 | 0.87 to 0.78 | 0.55 to 0.93 | 1.09 to 1.24 |
| `decodeFlat`, 100,000 points | 1.05 to 1.14 | 1.08 to 1.02 | 0.47 to 1.16 | 1.51 to 1.28 |
| `encodeFlat`, 1,000 points | 0.64 to 0.93 | 0.99 to 1.41 | 0.43 to 1.25 | 0.88 to 1.19 |
| `encodeFlat`, 100,000 points | 0.56 to 0.66 | 0.88 to 1.29 | 0.35 to 0.96 | 1.03 to 1.02 |
| `encode` (tuples), 1,000 points | 0.59 to 0.88 | 0.92 to 1.23 | 0.44 to 1.01 | 0.77 to 0.95 |

And the batch calls, on the 1000 real-world lines, against the JS way to get the same output:

| | Bun 1.4.3 | Node 24 | Deno 2.5 | Chrome 157 |
|---|--:|--:|--:|--:|
| `decodeMany` vs deck.gl `binaryPaths` (JS) | 1.36 | 1.70 | 2.70 | 0.93 |
| `encodeMany` vs `encode` per line | 0.61 | 0.79 | 0.79 | 0.75 |

Cells moved about 30% between rounds, so read the small differences as even. The clear results: the biggest gains were in Deno, where the old build was 2 to 3 times slower than JS; `decodeMany` is the one call where WASM wins by a lot, except in Chrome; and `encodeMany` loses everywhere, because making one string per line is the expensive part and it doesn't get cheaper in a batch. The full tables are in the benchmark's [results](https://github.com/Duoquote/polyline-benchmark/blob/main/docs/results.md).

What didn't: a Rust version that reads 8 bytes at a time with 64-bit tricks (SWAR) was 2.7 KB and 10 to 40% slower than the byte loop. Each value starts where the last one ended, and typical GPS values are 1 to 3 characters, so a byte loop with a well-predicted branch is already about 3 cycles per character. SIMD runs into the same chain, so I didn't ship it.

## Cloudflare Workers

`npm run test:workers` packs the package, bundles two Workers with wrangler 4.168.0 and runs them in workerd 1.20261123.1 locally, with no Cloudflare account. One Worker imports only the published entry points, without `nodejs_compat`. The other runs the test files that need no DOM, browser or CLI against the default entry, JSR's default (`src/deno.js`) and `/wasm`. CI runs it on every push.

Workers don't compile WebAssembly from bytes at runtime (`Wasm code generation disallowed by embedder`), so `/wasm`'s inlined bytes can't load there. Import the `.wasm` file instead, which wrangler turns into a compiled `WebAssembly.Module`, and pass it to `init`:

```js
import { init, decodeMany } from '@duoquote/polytini/wasm';
import wasm from '@duoquote/polytini/polytini.wasm';

await init(wasm); // or initSync(wasm) at the top level
```

Without it, `init()` throws a `PolylineError` with code `'init'` that says this. The JSR package doesn't include the `.wasm` file, so use the npm package for `/wasm` on Workers. The other entries work from JSR too: `npx jsr add @duoquote/polytini` installs JSR's npm build, whose default entry is `src/deno.js`.

Speed, from one quick check on my machine, not on Cloudflare's servers: the same calls in Node 25.2.1 (`node` entry) and in workerd (`workerd` entry), each a range over separate runs (3 for Node, 5 for workerd). Workers stop the clock while a request runs, so the workerd numbers are timed from outside: a request making 400 calls minus one making none. Calls per second, higher is faster:

| | Node | workerd |
|---|--:|--:|
| Decode the 1000 real-world lines | 471 to 474 | 259 to 385 |
| Encode the 1000 real-world lines | 356 to 363 | 328 to 360 |
| Decode one 10,000-point line | 7,414 to 8,674 | 4,806 to 8,208 |
| Encode one 10,000-point line | 7,146 to 8,235 | 8,116 to 9,225 |
| `/wasm` `decodeMany`, the 1000 lines | 356 to 372 | 387 to 408 |

Encoding and `/wasm` are about the same as Node. Decoding was close to Node in some runs and up to 1.8 times slower in others, with nothing changed in between; I haven't found out why. It's not in the main benchmark.

## Size

Minified and gzipped with esbuild and zlib level 9, from `node scripts/size.js`, which CI also runs with a budget per entry:

| entry | minified | gzipped |
|---|--:|--:|
| default / web (everything) | 4012 B | 1984 B |
| web, encode + decode only | 3533 B | 1770 B |
| browser (the "browser" condition) | 4901 B | 2262 B |
| node | 5378 B | 2621 B |
| bun | 5378 B | 2621 B |
| deno | 5497 B | 2515 B |
| wasm (JS glue + inlined .wasm) | 9414 B | 4550 B |
| leaflet | 4039 B | 1989 B |
| turf | 4803 B | 2233 B |
| presets | 818 B | 284 B |
| flexible | 4175 B | 2036 B |
| google | 4017 B | 1989 B |
| openlayers | 1994 B | 1064 B |
| maplibre | 3131 B | 1634 B |
| mapbox | 3127 B | 1635 B |
| deckgl | 4129 B | 2039 B |
| cli | 8074 B | 3839 B |

polytini is bigger than most polyline libraries, which are about 0.6 KB gzipped. The extra goes into strict-mode errors, the exact slow path for precision 7 and up, objects, dimensions and both orders. The browser entry adds 278 bytes over the minimal web build for its TextDecoder encode; import `@duoquote/polytini/web` if you'd rather have the smaller one. The WASM entry is the biggest because it carries both the module and the JS core it hands short lines and `[lat, lng]` decoding to.

## Speed

The best-at-what table is in the [README](../README.md#best-at-what). Every table, chart and round, for every runtime, is in the [benchmark repo](https://github.com/Duoquote/polyline-benchmark/blob/main/docs/results.md).

## What changed after 0.1.3

The benchmark repo's numbers move about 30% between rounds, so these come from `bench/ab.js` instead: the old and the new code on the same inputs, in alternating fresh processes pinned to 4 cores, 10 or 12 rounds, with a 95% confidence interval. A against itself gave about ±2 to 3% that way. Time per call, new divided by old, so 0.70 is 30% faster. "same" means the interval included 1.00.

| | Node 22 | Node 24 | Node 26 | Bun 1.4.3 | Deno 2.5 | Chrome 157 |
|---|--:|--:|--:|--:|--:|--:|
| decode, 10 points | 0.70 | 0.82 | 0.84 | same | 0.87 | 0.83 |
| decode, 100 points | 0.89 | 0.91 | 0.89 | 0.94 | same | same |
| decode, 1,000 points | 0.90 | same | 0.85 | 0.92 | | |
| decode, real-world lines | same | same | 0.85 | 0.95 | same | same |
| encode, 10 points | 0.67 | 0.83 | 0.88 | same | 0.92 | 0.91 |
| encode, 100 points | | | | | 0.56 | |
| encode, 1,000 points | | | | | 0.88 | same |
| encode, real-world lines | same | same | same | same | 0.93 | same |

Three changes are behind it:

- `10 ** precision` was computed on every call, which took about 18 ns on Node 24 and 26 and 58 ns on Node 22. That's 10 to 30% of a 10-point line, and it was most of the gap to `@mapbox/polyline` on short lines. At 10 points polytini went from 15% behind it to 16 to 22% ahead on Node 22, and from 22% behind to 5 to 8% behind on Node 24 and 26. It's a table of 16 numbers now. Bun never cared.
- The `Buffer` decoder copies the string with `utf8Write` instead of `ucs2Write`. `ucs2Write` took 0.24 to 0.45 ns per character on Node 22 and 26, `utf8Write` 0.04, and the count pass reads 4 characters per step instead of 2. A character outside ASCII makes the byte count differ from the length, and that string goes to the slow path, so strict mode is the same.
- Deno's `TextDecoder` label and switch point, described above.

What I tried and dropped, with the same harness:

- Appending with `push` on short lines: 3 to 5% faster at 10 points, but 8 to 26% slower from 100 points up in the portable core, on V8, Bun and Chrome. Doing it only under 64 characters still cost Chrome 11 to 14% at 100 and 1,000 points.
- A branch-free writer for 1 and 2 character values in the byte encoders: 26 to 34% faster on the real-world lines on Node and Bun, and 7 to 29% slower on the GPS tracks. Same trade as in the decoder, so the branch stays.
- One string concatenation per point instead of two in the core's encoder: 4 to 33% slower on Node 24.
- `TextEncoder.encodeInto` for the Node decoder's copy: even with `utf8Write` except 4 to 9% slower at 40 points.
- The core's loop for longer strings on Bun (256 or 1,024 characters instead of 64): 4 to 6% faster at 40 and 100 points, 2 to 9% slower on the real-world lines.
- Counting 4 characters per step in the Deno decoder too: about 5% faster in a noisy run, but 62 bytes, which puts the entry over its budget.
- `String.fromCharCode.apply` to make the string: 2 to 40 times slower than `latin1Slice` or `TextDecoder` from 100 characters up.

Not done yet: `/wasm` on Deno still reads strings out with `TextDecoder('latin1')`. The UTF-8 one made `encode` and `encodeFlat` 7 to 31% faster there, but it's 10 bytes and the entry is at its budget.
