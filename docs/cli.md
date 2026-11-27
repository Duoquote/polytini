# CLI

```sh
pnpm dlx @duoquote/polytini decode "kviyHviWkCbkBsg@guA"
```

```sh
bunx @duoquote/polytini encode 51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281
```

```sh
deno run -R jsr:@duoquote/polytini/cli decode -p 6 -f geojson --file route.txt
```

```sh
npx @duoquote/polytini decode --lines --file routes.txt
```

The first two use the same three points in London, Westminster, Buckingham Palace and Trafalgar Square, one in each direction: `decode` prints `[[51.5007,-0.1246],[51.5014,-0.1419],[51.5079,-0.1281]]` and `encode` prints `kviyHviWkCbkBsg@guA`. Deno needs `-R` (`--allow-read`) only for `--file`.

I ran every command on this page in cmd, PowerShell 5.1 and Git Bash, with each of the four launchers.

## Quoting

The examples work as written in every shell. Your own polylines can contain `` ` ``, `\`, `|` and `^`, which shells treat specially, so quote them:

- bash, zsh, fish and PowerShell: single quotes, `` '_p~iF~ps|U_ulLnnqC_mqNvxq`@' ``
- cmd: double quotes, `` "_p~iF~ps|U_ulLnnqC_mqNvxq`@" ``

A polyline never contains `'`, `"`, `$`, `%` or `!`, so these quotes always work, with one exception: in cmd, a polyline that ends in `\` needs that last backslash doubled, `"...fw\\"`, because Windows programs read `\"` as a quote character. polytini says so when it sees one. Double quotes in bash, zsh and PowerShell only work for polylines without `` ` `` and `\`. To skip quoting altogether, put the polyline in a file and use `--file`.

Coordinates for `encode` need no quotes: `51.5007,-0.1246` passes through every shell as it is. In PowerShell an unquoted pair reaches the command as `51.5007 -0.1246`, which polytini reads the same way.

## Input

`encode` takes `lat,lng` pairs as arguments (`lng,lat` with `--lnglat`). Otherwise both commands read `--file <path>` or stdin, and `-` or `--file -` also mean stdin:

- `decode` reads one polyline per line. Blank lines and whitespace around a polyline are ignored.
- `encode` reads JSON (`[[lat, lng], ...]`, several lines of points, or GeoJSON), CSV with a `lat` and a `lng` (or `lon`, `longitude`) column, or `lat,lng` lines without a header. GeoJSON is always `[lng, lat]`.

Input is read in chunks and output written as it's ready, so a polyline of a million points needs about as much memory as a small one. Two exceptions: JSON input to `encode` is read whole, since it's one value, and when `decode` reads more than one line from stdin without `--lines`, it keeps the first line's text until it sees a second one, because the output for one polyline and for several looks different. With `--file` it reads the file twice instead.

Output for a small input is written all at once at the end, so a command that fails prints nothing but the error. Past 1 MB of output, or with `--lines`, it's written as it goes, and an error stops it with what came before already printed.

## One per line

`--lines` reads one input per line and writes one output per line, so a file of any number of lines goes through with constant memory:

```sh
npx @duoquote/polytini decode --lines --file routes.txt
```

```sh
npx @duoquote/polytini encode --lines --file points.ndjson
```

- `decode --lines` prints each line's points as JSON (`-f json`), a GeoJSON LineString (`-f geojson`), CSV rows with the line's index (`-f csv`), or `lat,lng` pairs separated by spaces (`-f lines`), the same format `encode` takes as arguments.
- `encode --lines` reads a JSON array of points, a GeoJSON LineString or Feature, or `lat,lng` pairs separated by spaces, per line.
- `--field <name>` reads each line as a JSON object (NDJSON) and decodes or encodes only that field, leaving the rest of the object as it is. It implies `--lines`.

```sh
npx @duoquote/polytini decode --field shape -p 6 --file trips.ndjson
```

A bad line stops the command with exit code 1 and says which line it was: `polytini: line 3: Invalid character at 0`. With `--skip-errors` it reports the line and goes on.

Instead of `--file`, stdin works too: `< routes.txt` or `cat routes.txt |` in bash, `< routes.txt` or `type routes.txt |` in cmd, and `Get-Content routes.txt |` in PowerShell, which has no `<`.

## Options

Installed in a project, the command is `polytini`:

```
polytini 0.1.4: encode and decode Google encoded polylines

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

Polylines can contain \ ` | and ^, which shells treat specially. Quote
them: single quotes in bash, zsh, fish and PowerShell, double quotes in cmd.
```

It has no dependencies and isn't part of the library entry points, so it adds nothing to them. It decodes and encodes with the same code as [`@duoquote/polytini/stream`](streaming.md).
