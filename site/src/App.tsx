import { MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useDark } from "@/lib/use-dark"
import light from "@/assets/logo/light.webp"
import darkLogo from "@/assets/logo/dark.webp"
import { Hero, LINKS } from "@/sections/hero"
import { Playground } from "@/sections/playground"
import { Strict } from "@/sections/strict"
import { Precision } from "@/sections/precision"
import { Formats } from "@/sections/formats"
import { Integrations } from "@/sections/integrations"
import { Benchmark } from "@/sections/benchmark"
import { Results } from "@/sections/results"

const NAV = [
  ["playground", "Playground"],
  ["strict", "Strict"],
  ["precision", "Precision"],
  ["formats", "Formats"],
  ["integrations", "Integrations"],
  ["benchmark", "Benchmark"],
] as const

function ThemeToggle() {
  const { setTheme } = useTheme()
  const dark = useDark()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode (d)" : "Dark mode (d)"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export function App() {
  const dark = useDark()
  return (
    <>
      <a
        href="#playground"
        className="sr-only z-50 bg-background p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to the playground
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a href="#" className="flex shrink-0 items-center gap-2 font-heading text-sm font-semibold">
            <img src={dark ? darkLogo : light} alt="" width={24} height={24} className="size-6" />
            polytini
          </a>
          <nav aria-label="Sections" className="min-w-0 flex-1 overflow-x-auto">
            <ul className="flex gap-3 text-xs whitespace-nowrap text-muted-foreground">
              {NAV.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="hover:text-foreground">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <a
            href="https://github.com/Duoquote/polytini"
            className="hidden text-xs text-muted-foreground hover:text-foreground sm:block"
          >
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main>
        <Hero />
        <Playground />
        <Strict />
        <Precision />
        <Formats />
        <Integrations />
        <Benchmark />
        <Results />
      </main>
      <footer className="border-t py-10 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:px-6">
          <p>
            polytini is MIT licensed, by Güven Değirmenci. This page is in the repo under{" "}
            <a className="underline" href="https://github.com/Duoquote/polytini/tree/main/site">
              site/
            </a>
            .
          </p>
          <p>
            Maps: <a className="underline" href="https://openfreemap.org">OpenFreeMap</a>, ©{" "}
            <a className="underline" href="https://www.openmaptiles.org/">OpenMapTiles</a>, data from{" "}
            <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. The
            Berlin route is from the <a className="underline" href="https://project-osrm.org/">OSRM</a> demo server,
            route data © OpenStreetMap contributors (ODbL). The example line is from Google's{" "}
            <a className="underline" href="https://developers.google.com/maps/documentation/utilities/polylinealgorithm">
              Encoded Polyline Algorithm Format
            </a>{" "}
            page, CC BY 4.0.
          </p>
          <nav aria-label="Footer links" className="flex flex-wrap gap-x-4 gap-y-1">
            {LINKS.map(([label, href]) => (
              <a key={label} href={href} className="underline">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  )
}

export default App
