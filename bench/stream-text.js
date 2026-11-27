// The way to decode a fetch body without streaming, `decode(await
// res.text())`, for bench/ab.js against bench/stream.js with byte chunks:
//
//   STREAM_CHUNKS=bytes node bench/ab.js --a bench/stream-text.js --b bench/stream.js --cases decode:1000000
//
// The bytes are made once, outside the timed part; the timed part turns all
// of them into one string with TextDecoder, then decodes it.
import { decode as decodeText, decodeFlat as decodeFlatText } from '../src/web.js';

export { encode, encodeFlat } from '../src/web.js';

const utf8 = new TextEncoder(), text = new TextDecoder(), cache = new Map();
const bytes = (s) => {
  let b = cache.get(s);
  if (!b) cache.set(s, (b = utf8.encode(s)));
  return b;
};

export const decode = (s, o) => decodeText(text.decode(bytes(s)), o);
export const decodeFlat = (s, o) => decodeFlatText(text.decode(bytes(s)), o);
