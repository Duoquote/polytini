// The /wasm entry's init paths: a compiled WebAssembly.Module or the .wasm
// bytes passed in (what Cloudflare Workers need), and the error where the
// runtime won't compile bytes, simulated here by making WebAssembly's
// compile functions throw. Each test imports its own copy of src/ from a
// temporary directory, because the instance is module state, and Bun
// returns the same module for ?query imports.
import { test, eq, ok, throws } from './lib.js';

const google = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
async function fresh() {
  const { cpSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'polytini-wasm-'));
  cpSync(new URL('../src/', import.meta.url), dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  try {
    return await import(pathToFileURL(join(dir, 'wasm.js')).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
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
