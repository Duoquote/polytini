import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { codeToHtml } from "shiki"
import { SNIPPETS, snippetKey } from "./src/snippets.ts"

const repo = resolve(import.meta.dirname, "..")
const site = "https://duoquote.github.io/polytini/"
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const version = (name: string) =>
  json(resolve(import.meta.dirname, "node_modules", name, "package.json"))
    .version as string

// Files from the repo root that the site serves as is, at stable URLs: the
// Open Graph image, the favicon and llms.txt. They live once in the repo, so
// they're copied at build time instead of being committed twice.
const shared: Record<string, string> = {
  "social-preview.png": "assets/social-preview.png",
  "polytini-icon.png": "assets/polytini-icon.png",
  "llms.txt": "llms.txt",
}

const today = new Date().toISOString().slice(0, 10)
const generated: Record<string, string> = {
  "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${site}</loc><lastmod>${today}</lastmod></url>
</urlset>
`,
  "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`,
}

function sharedFiles(): Plugin {
  return {
    name: "polytini-shared-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.replace(/^\/polytini\//, "").split("?")[0] ?? ""
        if (shared[name]) {
          res.setHeader(
            "Content-Type",
            name.endsWith(".png") ? "image/png" : "text/plain; charset=utf-8"
          )
          res.end(readFileSync(resolve(repo, shared[name])))
        } else if (generated[name]) {
          res.end(generated[name])
        } else next()
      })
    },
    generateBundle() {
      for (const [fileName, path] of Object.entries(shared)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(repo, path)) })
      }
      for (const [fileName, source] of Object.entries(generated)) {
        this.emitFile({ type: "asset", fileName, source })
      }
      // GitHub Pages serves 404.html for unknown paths. The site is one page,
      // so send those back to it.
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: `<!doctype html><meta charset="utf-8"><title>Not found</title><meta http-equiv="refresh" content="0; url=/polytini/"><a href="/polytini/">polytini</a>`,
      })
    },
  }
}

// Highlights every static snippet with Shiki once, at build time, and hands
// the page a map of HTML. Both themes are in the HTML as CSS variables, so
// switching light and dark needs no JavaScript and the page ships no
// highlighter.
function highlighted(): Plugin {
  const id = "virtual:highlighted"
  return {
    name: "polytini-highlighted",
    resolveId: (source) => (source === id ? "\0" + id : undefined),
    async load(resolved) {
      if (resolved !== "\0" + id) return
      const map: Record<string, string> = {}
      for (const { code, lang } of SNIPPETS) {
        const html = await codeToHtml(code, {
          lang,
          themes: { light: "github-light-default", dark: "github-dark-default" },
          defaultColor: false,
        })
        map[snippetKey(code, lang)] = html.replace(/^[\s\S]*?<code>/, "").replace(/<\/code><\/pre>\s*$/, "")
      }
      return `export default ${JSON.stringify(map)}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: "/polytini/",
  plugins: [react(), tailwindcss(), sharedFiles(), highlighted()],
  define: {
    // The version of the code the demo runs: the repo's own src/.
    __POLYTINI_VERSION__: JSON.stringify(json(resolve(repo, "package.json")).version),
    __LIB_VERSIONS__: JSON.stringify({
      "@mapbox/polyline": version("@mapbox/polyline"),
      "@googlemaps/polyline-codec": version("@googlemaps/polyline-codec"),
      "google-polyline": version("google-polyline"),
    }),
  },
  resolve: {
    alias: [
      // polytini comes from the repo's src/, never from npm, so the demo
      // always runs the current code. The browser entry is what a bundler
      // picks for a browser build of the published package.
      { find: /^@duoquote\/polytini$/, replacement: resolve(repo, "src/browser.js") },
      { find: /^@duoquote\/polytini\/detect\/land$/, replacement: resolve(repo, "src/detect-land.js") },
      { find: /^@duoquote\/polytini\/(.+)$/, replacement: resolve(repo, "src/$1.js") },
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
    ],
  },
  server: { fs: { allow: [repo] } },
  worker: { format: "es" },
  build: { target: "es2022" },
})
