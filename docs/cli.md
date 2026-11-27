# CLI

```sh
pnpm dlx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

```sh
bunx @duoquote/polytini encode --file points.csv
```

```sh
deno run jsr:@duoquote/polytini/cli decode -p 6 -f geojson --file route.txt
```

```sh
yarn dlx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

```sh
npx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

Installed in a project, the command is `polytini`:

```
polytini 0.1.2: encode and decode Google encoded polylines

Usage:
  polytini encode [input] [options]
  polytini decode [input] [options]

Input is the argument, --file <path>, or stdin. Quote polylines on the
command line: they can contain \ ` | and other shell characters.

  encode reads JSON ([[lat, lng], ...], or GeoJSON), CSV with a header, or
         "lat,lng" lines, and prints one polyline per line.
  decode reads one polyline per line and prints coordinates.

Options:
  -p, --precision <n>  decimal places, 0 to 15 (default 5; OSRM polyline6
                       and Valhalla use 6)
      --lnglat         coordinates are [lng, lat], like GeoJSON (GeoJSON
                       input is always read that way)
      --no-strict      accept malformed input instead of failing
  -f, --format <fmt>   decode output: json (default), geojson, csv or lines
      --file <path>    read input from a file
  -h, --help           show this help
  -v, --version        show the version

Examples:
  polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
  polytini decode -p 6 -f geojson --file route.txt
  echo '[[38.5,-120.2],[40.7,-120.95]]' | polytini encode
  polytini encode --file points.csv
```

It has no dependencies and isn't part of the library entry points, so it adds nothing to them.
