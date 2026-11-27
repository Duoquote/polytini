// The /wasm entry's init paths: a compiled WebAssembly.Module or the .wasm
// bytes passed in (what Cloudflare Workers need), and the error where the
// runtime won't compile bytes, simulated here by making WebAssembly's
// compile functions throw. Each test imports its own copy of src/ (freshWasm),
// because the instance is module state.
import { test, eq, ok, throws, freshWasm, entries, wasmBuiltins } from './lib.js';

const google = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const fresh = freshWasm;
async function bytes() {
  const { readFileSync } = await import('node:fs');
  return new Uint8Array(readFileSync(new URL('../wasm/polytini.wasm', import.meta.url)));
}
// What V8 throws when the embedder turns off code generation (workerd's message).
const refuse = () => {
  throw new WebAssembly.CompileError('WebAssembly.instantiate(): Wasm code generation disallowed by embedder');
};
async function blocked(fn) {
  const { instantiate, compile, Module } = WebAssembly;
  WebAssembly.instantiate = async (src, ...rest) => (src instanceof Module ? instantiate(src, ...rest) : refuse());
  WebAssembly.compile = async () => refuse();
  WebAssembly.Module = function () {
    refuse();
  };
  WebAssembly.Module.prototype = Module.prototype;
  try {
    return await fn(Module);
  } finally {
    Object.assign(WebAssembly, { instantiate, compile, Module });
  }
}

test('wasm: init and initSync take a compiled WebAssembly.Module', async () => {
  const module = new WebAssembly.Module(await bytes());
  const a = await fresh();
  await a.init(module);
  eq(a.decodeMany([google]).coords.length, 6);
  eq(a.encodeMany([pts]), [google]);
  const b = await fresh();
  b.initSync(module);
  eq(b.decodeMany([google, google]).starts, new Uint32Array([0, 3, 6]));
});

test('wasm: init and initSync take the .wasm bytes', async () => {
  const a = await fresh();
  await a.init(await bytes());
  eq(a.encode(pts), google);
  eq(a.decodeMany([google]).coords[0], 38.5);
  const b = await fresh();
  b.initSync(await bytes());
  eq(b.encodeMany([pts]), [google]);
});

test("wasm: where bytes can't be compiled, init says to pass the module", async () => {
  const w = await fresh();
  await blocked(async (Module) => {
    let err;
    await w.init().catch((e) => (err = e));
    ok(err instanceof w.PolylineError, 'a PolylineError');
    eq(err.code, 'init');
    ok(err.message.includes('disallowed by embedder') && err.message.includes('@duoquote/polytini/polytini.wasm') && err.message.includes('init(wasm)'), err.message);
    throws(() => w.initSync(), 'init');
    // Still not ready, and the batch functions say so.
    throws(() => w.decodeMany([google]), 'init');
    // A compiled module works even there.
    await w.init(new Module(await bytes()));
  });
  eq(w.decodeMany([google]).coords[0], 38.5);
});

// The inlined bytes go through Uint8Array.fromBase64 where it exists and a
// plain atob loop where it doesn't (Node 24); both have to give the module.
test('wasm: init works with and without Uint8Array.fromBase64', async () => {
  const had = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  try {
    delete Uint8Array.fromBase64;
    const a = await fresh();
    a.initSync();
    eq(a.encodeMany([pts]), [google]);
    Uint8Array.fromBase64 = had?.value ?? ((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const b = await fresh();
    await b.init();
    eq(b.decodeMany([google]).coords[0], 38.5);
  } finally {
    if (had) Object.defineProperty(Uint8Array, 'fromBase64', had);
    else delete Uint8Array.fromBase64;
  }
});

test('wasm: bad bytes from the caller throw their own error', async () => {
  const w = await fresh();
  let err;
  await w.init(new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9])).catch((e) => (err = e));
  ok(err instanceof WebAssembly.CompileError, String(err));
  throws(() => w.initSync(new Uint8Array([1, 2, 3])), undefined);
  ok(!(err instanceof w.PolylineError));
});

// The string-builtins module is on where the runtime has the builtins and is
// V8: Node 22.19+ and 24+, Deno. Bun has them too, but measured slower, so it
// keeps the other module, like Node 22.12 to 22.18 (behind a flag there).
test('wasm: string builtins are on where they should be', async () => {
  await entries();
  const v = globalThis.process?.versions?.node?.split('.').map(Number);
  const want = globalThis.Bun ? false : globalThis.Deno ? true : v[0] == 22 ? v[1] >= 19 : v[0] >= 24 ? true : undefined;
  if (want !== undefined) eq(wasmBuiltins.on, want, 'builtins');
});

// A module passed to init means the runtime can't compile bytes (Workers),
// so init doesn't try the builtins one, and everything goes through the
// module it was given.
test('wasm: init(module) uses only that module', async () => {
  const module = new WebAssembly.Module(await bytes());
  const { Module } = WebAssembly;
  let tried = 0;
  WebAssembly.Module = function (b, o) {
    tried++;
    return new Module(b, o);
  };
  WebAssembly.Module.prototype = Module.prototype;
  try {
    const a = await fresh();
    await a.init(module);
    const b = await fresh();
    b.initSync(module);
    eq(tried, 0);
    for (const w of [a, b]) {
      eq(w.decodeFlat(google), pts.flat());
      eq(w.encode(pts), google);
      eq(w.encodeMany([pts, pts]), [google, google]);
    }
  } finally {
    WebAssembly.Module = Module;
  }
});
