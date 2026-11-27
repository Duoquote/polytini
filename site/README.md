# polytini demo site

The page at https://duoquote.github.io/polytini/. It runs polytini in the browser: a playground with a map, the strict mode and precision examples, the formats, the integrations and a small benchmark.

It's Vite, React and shadcn/ui (Radix), set up with `bunx --bun shadcn@latest init --preset biyODCyK9 --base radix --template vite --pointer`. It has its own `package.json` and `bun.lock`, and none of it ships in the npm or JSR package.

```sh
cd site
bun install
bun run dev      # http://localhost:5173/polytini/
bun run build    # site/dist
```

polytini itself comes from the repo's `src/`, not from npm (see the aliases in `vite.config.ts`), so the page always runs the current code. The types come from `../types`. The comparison libraries in the benchmark (`@mapbox/polyline`, `@googlemaps/polyline-codec`, `google-polyline`) and MapLibre are dependencies of the site only.

Maps use [OpenFreeMap](https://openfreemap.org): no API key, no limit on views, attribution required, which MapLibre shows from the style. MapLibre and the benchmark libraries load only when they're needed.

`.github/workflows/pages.yml` builds and deploys it on pushes to `main` that touch `site/`, `src/` or `types/`.
