# Changelog

## 0.1.1

No changes to the code. The npm types only gained doc comments.

- JSR: the mapbox, maplibre, turf and openlayers entries have their own type files now (`types/*.jsr.d.ts`), with structural types and the GeoJSON types written out. JSR builds docs without node_modules, so its first 0.1.0 publish failed on types that import `geojson`, `mapbox-gl`, `maplibre-gl`, `@turf/helpers` and `ol`. JSR's 0.1.0 already has these files; this is the first npm release with them.
- Every JSR export has doc comments, so `deno doc --lint` passes.
- CI checks the JSR package the way the server sees it: a clean checkout with no npm install, a script that fails if a JSR type file imports a package, then `deno publish --dry-run` and `deno doc --lint`.
- The smoke test bundles with esbuild's JS API instead of the CLI.
- The npm dry-run check runs `npm pack --dry-run` once the version is already on npm, because a publish dry run of a published version fails.
- The release workflow no longer installs dependencies before `deno publish`. It only needed Deno to skip package.json.

## 0.1.0

First release.
