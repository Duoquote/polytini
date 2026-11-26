;; polytini WASM codec. Hand-written so the binary stays under 1 KB.
;; Build: node scripts/build-wasm.js (uses the `wabt` dev dependency).
;;
;; Every function returns a negative number when the input needs the exact
;; JS path: invalid characters, truncated strings, values over 6 chunks,
;; non-finite or out-of-range coordinates. The JS glue then calls that path,
;; which throws in strict mode or gives the lenient result.
;;
;; I also tried a Rust version that reads 8 bytes at a time (SWAR). It was
;; 2.7 KB and 10 to 40% slower than this byte loop: typical GPS values are 1
;; to 3 characters, so the loop's branch predicts well, and each value's
;; start depends on where the last one ended.
(module
  (memory (export "memory") 1)

  ;; One line of `len` bytes at p, lat/f and lng/f pairs at out (lng, lat
  ;; when sw = 1). Returns the f64 values written, or -1.
  (func $line
    (param $p i32) (param $len i32) (param $out i32) (param $f f64) (param $sw i32)
    (result i32)
    (local $end i32) (local $o i32) (local $c i32) (local $v i32) (local $s i32)
    (local $lat i32) (local $lng i32) (local $bad i32) (local $k i32)
    (local.set $end (i32.add (local.get $p) (local.get $len)))
    (local.set $o (local.get $out))
    (block $done
      (loop $point
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $k (i32.const 0))
        (loop $value
          (local.set $v (i32.const 0))
          (local.set $s (i32.const 0))
          (loop $chunk
            ;; Truncated input, or a 7th chunk that would overflow 32 bits.
            (if (i32.or (i32.ge_u (local.get $p) (local.get $end)) (i32.gt_u (local.get $s) (i32.const 25)))
              (then (return (i32.const -1))))
            (local.set $c (i32.sub (i32.load8_u (local.get $p)) (i32.const 63)))
            (local.set $bad (i32.or (local.get $bad) (local.get $c)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $v (i32.or (local.get $v) (i32.shl (i32.and (local.get $c) (i32.const 31)) (local.get $s))))
            (local.set $s (i32.add (local.get $s) (i32.const 5)))
            (br_if $chunk (i32.ge_s (local.get $c) (i32.const 32))))
          ;; zigzag: (v >>> 1) ^ -(v & 1)
          (local.set $v (i32.xor (i32.shr_u (local.get $v) (i32.const 1))
                                 (i32.sub (i32.const 0) (i32.and (local.get $v) (i32.const 1)))))
          (if (local.get $k)
            (then (local.set $lng (i32.add (local.get $lng) (local.get $v))))
            (else (local.set $lat (i32.add (local.get $lat) (local.get $v)))))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br_if $value (i32.lt_u (local.get $k) (i32.const 2))))
        (f64.store (i32.add (local.get $o) (i32.shl (local.get $sw) (i32.const 3)))
          (f64.div (f64.convert_i32_s (local.get $lat)) (local.get $f)))
        (f64.store (i32.sub (i32.add (local.get $o) (i32.const 8)) (i32.shl (local.get $sw) (i32.const 3)))
          (f64.div (f64.convert_i32_s (local.get $lng)) (local.get $f)))
        (local.set $o (i32.add (local.get $o) (i32.const 16)))
        (br $point)))
    (if (i32.and (local.get $bad) (i32.const -64)) (then (return (i32.const -1))))
    (i32.shr_u (i32.sub (local.get $o) (local.get $out)) (i32.const 3)))

  ;; decode(p, len, out, f, sw) -> f64 values written at out, or -1
  (func (export "decode")
    (param $p i32) (param $len i32) (param $out i32) (param $f f64) (param $sw i32)
    (result i32)
    (call $line (local.get $p) (local.get $len) (local.get $out) (local.get $f) (local.get $sw)))

  ;; decode_many(p, lens, count, out, starts, f, sw): `count` lines back to
  ;; back at p, their byte lengths as u32 at lens. All points go to out, and
  ;; the first point index of each line to starts (count + 1 entries).
  ;; Returns the total f64 values, or -1 - (index of the bad line).
  (func (export "decode_many")
    (param $p i32) (param $lens i32) (param $count i32) (param $out i32) (param $starts i32) (param $f f64) (param $sw i32)
    (result i32)
    (local $i i32) (local $len i32) (local $k i32) (local $o i32)
    (local.set $o (local.get $out))
    (i32.store (local.get $starts) (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
        (local.set $len (i32.load (i32.add (local.get $lens) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $k (call $line (local.get $p) (local.get $len) (local.get $o) (local.get $f) (local.get $sw)))
        (if (i32.lt_s (local.get $k) (i32.const 0))
          (then (return (i32.sub (i32.const -1) (local.get $i)))))
        (local.set $o (i32.add (local.get $o) (i32.shl (local.get $k) (i32.const 3))))
        (local.set $p (i32.add (local.get $p) (local.get $len)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (i32.store (i32.add (local.get $starts) (i32.shl (local.get $i) (i32.const 2)))
          (i32.shr_u (i32.sub (local.get $o) (local.get $out)) (i32.const 4)))
        (br $next)))
    (i32.shr_u (i32.sub (local.get $o) (local.get $out)) (i32.const 3)))

  ;; Scales and rounds one coordinate half away from zero, the same results
  ;; as the JS paths. Values past 2^29 (precision 7 and up, or bad input,
  ;; NaN included) return the flag value 0x80000000; the JS core handles
  ;; them. Under 2^29 the deltas and their zigzag fit in 32 bits.
  (func $round (param $x f64) (result i32)
    (local $t i32) (local $r f64)
    (if (i32.eqz (f64.lt (f64.abs (local.get $x)) (f64.const 536870912)))
      (then (return (i32.const 0x80000000))))
    ;; Truncate toward zero, then step away from zero when the part cut off
    ;; was at least one half. Exact: x - t loses nothing at this size.
    (local.set $t (i32.trunc_f64_s (local.get $x)))
    (local.set $r (f64.sub (local.get $x) (f64.convert_i32_s (local.get $t))))
    (if (f64.ge (local.get $r) (f64.const 0.5))
      (then (return (i32.add (local.get $t) (i32.const 1)))))
    (if (f64.le (local.get $r) (f64.const -0.5))
      (then (return (i32.sub (local.get $t) (i32.const 1)))))
    (local.get $t))

  ;; One line: n f64 values at in (lat and lng alternating) to characters at
  ;; out. Returns the bytes written, or -1.
  (func $encline
    (param $in i32) (param $n i32) (param $f f64) (param $out i32)
    (result i32)
    (local $end i32) (local $o i32) (local $v i32) (local $z i32) (local $pa i32) (local $pb i32) (local $k i32)
    (local.set $end (i32.add (local.get $in) (i32.shl (local.get $n) (i32.const 3))))
    (local.set $o (local.get $out))
    (block $done
      (loop $value
        (br_if $done (i32.ge_u (local.get $in) (local.get $end)))
        (local.set $v (call $round (f64.mul (f64.load (local.get $in)) (local.get $f))))
        (if (i32.eq (local.get $v) (i32.const 0x80000000)) (then (return (i32.const -1))))
        ;; Values alternate lat, lng; $k picks the previous one to subtract.
        (if (local.get $k)
          (then (local.set $z (i32.sub (local.get $v) (local.get $pb))) (local.set $pb (local.get $v)))
          (else (local.set $z (i32.sub (local.get $v) (local.get $pa))) (local.set $pa (local.get $v))))
        (local.set $k (i32.xor (local.get $k) (i32.const 1)))
        (local.set $z (i32.xor (i32.shl (local.get $z) (i32.const 1)) (i32.shr_s (local.get $z) (i32.const 31))))
        (block $last
          (loop $more
            (br_if $last (i32.lt_u (local.get $z) (i32.const 32)))
            (i32.store8 (local.get $o) (i32.add (i32.and (local.get $z) (i32.const 31)) (i32.const 95)))
            (local.set $o (i32.add (local.get $o) (i32.const 1)))
            (local.set $z (i32.shr_u (local.get $z) (i32.const 5)))
            (br $more)))
        (i32.store8 (local.get $o) (i32.add (local.get $z) (i32.const 63)))
        (local.set $o (i32.add (local.get $o) (i32.const 1)))
        (local.set $in (i32.add (local.get $in) (i32.const 8)))
        (br $value)))
    (i32.sub (local.get $o) (local.get $out)))

  ;; encode(in, n, f, out) -> bytes written at out, or -1
  (func (export "encode")
    (param $in i32) (param $n i32) (param $f f64) (param $out i32)
    (result i32)
    (call $encline (local.get $in) (local.get $n) (local.get $f) (local.get $out)))

  ;; encode_many(in, starts, count, f, out, ends): line i is points
  ;; starts[i] to starts[i + 1] of the f64 pairs at in. The strings go back
  ;; to back at out, and each one's end offset (u32) to ends. Returns the
  ;; total bytes, or -1 - (index of the bad line).
  (func (export "encode_many")
    (param $in i32) (param $starts i32) (param $count i32) (param $f f64) (param $out i32) (param $ends i32)
    (result i32)
    (local $i i32) (local $s i32) (local $e i32) (local $k i32) (local $o i32)
    (local.set $o (local.get $out))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
        (local.set $s (i32.load (i32.add (local.get $starts) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $e (i32.load offset=4 (i32.add (local.get $starts) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $k (call $encline
          (i32.add (local.get $in) (i32.shl (local.get $s) (i32.const 4)))
          (i32.shl (i32.sub (local.get $e) (local.get $s)) (i32.const 1))
          (local.get $f) (local.get $o)))
        (if (i32.lt_s (local.get $k) (i32.const 0))
          (then (return (i32.sub (i32.const -1) (local.get $i)))))
        (local.set $o (i32.add (local.get $o) (local.get $k)))
        (i32.store (i32.add (local.get $ends) (i32.shl (local.get $i) (i32.const 2)))
          (i32.sub (local.get $o) (local.get $out)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (i32.sub (local.get $o) (local.get $out)))
)
