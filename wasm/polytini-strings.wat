;; wasm/polytini.wat's decode and encode on JS String Builtins (wasm:js-string).
;; Strings never go through linear memory: decode takes the JS string as an
;; externref and copies it into a reused GC i16 array with one
;; intoCharCodeArray call (charCodeAt per character was 1.3 to 3 times
;; slower), and encode writes the characters into that array and makes the
;; JS string with fromCharCodeArray. Coordinates stay in linear memory as f64, as there.
;;
;; Same contract as wasm/polytini.wat: a negative result (or a null string)
;; means the JS core has to handle the input.
(module
  (type $a16 (array (mut i16)))
  (import "wasm:js-string" "fromCharCodeArray" (func $from (param (ref null $a16) i32 i32) (result (ref extern))))
  (import "wasm:js-string" "intoCharCodeArray" (func $into (param externref (ref null $a16) i32) (result i32)))
  (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
  (memory (export "memory") 1)

  ;; Character scratch, reused and grown by half again when too small.
  (global $buf (mut (ref null $a16)) (ref.null $a16))

  (func $room (param $n i32) (result (ref $a16))
    ;; Not i32.or: both operands run, and array.len traps on null.
    (if (if (result i32) (ref.is_null (global.get $buf))
          (then (i32.const 1))
          (else (i32.lt_u (array.len (global.get $buf)) (local.get $n))))
      (then (global.set $buf (array.new_default $a16 (i32.add (local.get $n) (i32.shr_u (local.get $n) (i32.const 1)))))))
    (ref.as_non_null (global.get $buf)))

  ;; polytini.wat's decode loop, reading characters from the array instead of bytes.
  (func $line
    (param $b (ref $a16)) (param $p i32) (param $len i32) (param $out i32) (param $f f64) (param $sw i32)
    (result i32)
    (local $end i32) (local $o i32) (local $c i32) (local $v i32) (local $s i32)
    (local $lat i64) (local $lng i64) (local $bad i32) (local $k i32)
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
            (if (i32.or (i32.ge_u (local.get $p) (local.get $end)) (i32.gt_u (local.get $s) (i32.const 25)))
              (then (return (i32.const -1))))
            (local.set $c (i32.sub (array.get_u $a16 (local.get $b) (local.get $p)) (i32.const 63)))
            (local.set $bad (i32.or (local.get $bad) (local.get $c)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $v (i32.or (local.get $v) (i32.shl (i32.and (local.get $c) (i32.const 31)) (local.get $s))))
            (local.set $s (i32.add (local.get $s) (i32.const 5)))
            (br_if $chunk (i32.ge_s (local.get $c) (i32.const 32))))
          (local.set $v (i32.xor (i32.shr_u (local.get $v) (i32.const 1))
                                 (i32.sub (i32.const 0) (i32.and (local.get $v) (i32.const 1)))))
          ;; 64-bit sums, like the JS paths' doubles: precision 8 and up passes
          ;; 2^31 on real lines (30 degrees is 3e9 there), which wrapped in 32 bits.
          (if (local.get $k)
            (then (local.set $lng (i64.add (local.get $lng) (i64.extend_i32_s (local.get $v)))))
            (else (local.set $lat (i64.add (local.get $lat) (i64.extend_i32_s (local.get $v))))))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br_if $value (i32.lt_u (local.get $k) (i32.const 2))))
        (f64.store (i32.add (local.get $o) (i32.shl (local.get $sw) (i32.const 3)))
          (f64.div (f64.convert_i64_s (local.get $lat)) (local.get $f)))
        (f64.store (i32.sub (i32.add (local.get $o) (i32.const 8)) (i32.shl (local.get $sw) (i32.const 3)))
          (f64.div (f64.convert_i64_s (local.get $lng)) (local.get $f)))
        (local.set $o (i32.add (local.get $o) (i32.const 16)))
        (br $point)))
    (if (i32.and (local.get $bad) (i32.const -64)) (then (return (i32.const -1))))
    (i32.shr_u (i32.sub (local.get $o) (local.get $out)) (i32.const 3)))

  ;; decode(str, out, f, sw) -> f64 values written at out, or -1.
  (func (export "decode")
    (param $str externref) (param $out i32) (param $f f64) (param $sw i32) (result i32)
    (local $len i32) (local $b (ref $a16))
    (local.set $len (call $length (local.get $str)))
    (local.set $b (call $room (local.get $len)))
    (drop (call $into (local.get $str) (local.get $b) (i32.const 0)))
    (call $line (local.get $b) (i32.const 0) (local.get $len) (local.get $out) (local.get $f) (local.get $sw)))

  ;; polytini.wat's rounding, unchanged.
  (func $round (param $x f64) (result i32)
    (local $t i32) (local $r f64)
    (if (i32.eqz (f64.lt (f64.abs (local.get $x)) (f64.const 536870912)))
      (then (return (i32.const 0x80000000))))
    (local.set $t (i32.trunc_f64_s (local.get $x)))
    (local.set $r (f64.sub (local.get $x) (f64.convert_i32_s (local.get $t))))
    (if (f64.ge (local.get $r) (f64.const 0.5))
      (then (return (i32.add (local.get $t) (i32.const 1)))))
    (if (f64.le (local.get $r) (f64.const -0.5))
      (then (return (i32.sub (local.get $t) (i32.const 1)))))
    (local.get $t))

  ;; encode(in, n, f) -> the encoded string of n f64 values at in, or null.
  (func (export "encode")
    (param $in i32) (param $n i32) (param $f f64) (result externref)
    (local $b (ref $a16)) (local $end i32) (local $o i32) (local $v i32) (local $z i32) (local $pa i32) (local $pb i32) (local $k i32)
    ;; At most 6 characters per value below 2^29.
    (local.set $b (call $room (i32.add (i32.mul (local.get $n) (i32.const 6)) (i32.const 8))))
    (local.set $end (i32.add (local.get $in) (i32.shl (local.get $n) (i32.const 3))))
    (block $done
      (loop $value
        (br_if $done (i32.ge_u (local.get $in) (local.get $end)))
        (local.set $v (call $round (f64.mul (f64.load (local.get $in)) (local.get $f))))
        (if (i32.eq (local.get $v) (i32.const 0x80000000)) (then (return (ref.null extern))))
        (if (local.get $k)
          (then (local.set $z (i32.sub (local.get $v) (local.get $pb))) (local.set $pb (local.get $v)))
          (else (local.set $z (i32.sub (local.get $v) (local.get $pa))) (local.set $pa (local.get $v))))
        (local.set $k (i32.xor (local.get $k) (i32.const 1)))
        (local.set $z (i32.xor (i32.shl (local.get $z) (i32.const 1)) (i32.shr_s (local.get $z) (i32.const 31))))
        (block $last
          (loop $more
            (br_if $last (i32.lt_u (local.get $z) (i32.const 32)))
            (array.set $a16 (local.get $b) (local.get $o) (i32.add (i32.and (local.get $z) (i32.const 31)) (i32.const 95)))
            (local.set $o (i32.add (local.get $o) (i32.const 1)))
            (local.set $z (i32.shr_u (local.get $z) (i32.const 5)))
            (br $more)))
        (array.set $a16 (local.get $b) (local.get $o) (i32.add (local.get $z) (i32.const 63)))
        (local.set $o (i32.add (local.get $o) (i32.const 1)))
        (local.set $in (i32.add (local.get $in) (i32.const 8)))
        (br $value)))
    (call $from (local.get $b) (i32.const 0) (local.get $o)))
)
