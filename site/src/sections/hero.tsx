import { CommandLine } from "@/components/copy-button"
import { useDark } from "@/lib/use-dark"
import light from "@/assets/logo/light.webp"
import dark from "@/assets/logo/dark.webp"

const INSTALL = [
  ["pnpm", "pnpm add @duoquote/polytini"],
  ["Bun", "bun add @duoquote/polytini"],
  ["Deno", "deno add jsr:@duoquote/polytini"],
  ["Yarn", "yarn add @duoquote/polytini"],
  ["npm", "npm i @duoquote/polytini"],
] as const

export const LINKS = [
  ["GitHub", "https://github.com/Duoquote/polytini"],
  ["npm", "https://www.npmjs.com/package/@duoquote/polytini"],
  ["JSR", "https://jsr.io/@duoquote/polytini"],
  ["Benchmark", "https://github.com/Duoquote/polyline-benchmark"],
  ["Blog post", "https://blog.dq.ms/polytini"],
  ["llms.txt", "llms.txt"],
] as const

export function Hero() {
  const isDark = useDark()
  return (
    <section aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-16 sm:pb-16">
      <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-4">
            <img
              src={isDark ? dark : light}
              alt="polytini logo: a small bird sitting on a line"
              width={96}
              height={96}
              className="size-20 sm:size-24"
              fetchPriority="high"
            />
            <div>
              <h1 id="hero-title" className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
                polytini
              </h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                v{__POLYTINI_VERSION__} · MIT · 0 dependencies
              </p>
            </div>
          </div>
          <p className="max-w-xl text-base sm:text-lg">
            Encode and decode Google encoded polylines in Node, Bun, Deno, browsers and Cloudflare Workers. It's strict
            by default, so a cut-off string throws instead of drawing a wrong line.
          </p>
          <p className="max-w-xl text-sm text-muted-foreground">
            Polylines are the short strings Google Maps, OSRM, Valhalla, GraphHopper and Mapbox return for route
            geometry. Each runtime gets the build that measured fastest there. This page runs polytini{" "}
            {__POLYTINI_VERSION__} from the repo's own source, in your browser.
          </p>
          <nav aria-label="Project links" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {LINKS.map(([label, href]) => (
              <a key={label} href={href} className="underline underline-offset-4 hover:text-primary">
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-xs font-medium text-muted-foreground">Install</h2>
          <ul className="flex flex-col gap-1.5">
            {INSTALL.map(([pm, cmd]) => (
              <li key={pm} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
                <span className="text-xs text-muted-foreground">{pm}</span>
                <CommandLine command={cmd} prefix="" />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            ESM and CommonJS, with TypeScript types. Node 22 or newer.
          </p>
        </div>
      </div>
    </section>
  )
}
