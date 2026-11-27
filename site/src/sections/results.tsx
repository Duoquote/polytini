import { Section } from "@/components/section"
import { useDark } from "@/lib/use-dark"

const RAW = "https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/"
const REPO = "https://github.com/Duoquote/polyline-benchmark"

// From polytini's README, which takes it from the benchmark's 27 November
// 2026 run with 0.1.4.
const BEST: [string, string, string, string][] = [
  ["Decode short lines (10 and 100 points)", "@duoquote/polytini", "@placemarkio/polyline", "1.01x, within the noise"],
  ["Decode long lines (10,000 and 100,000 points)", "@duoquote/polytini", "@googlemaps/polyline-codec", "1.20x"],
  ["Decode real-world lines (median 82 points)", "@duoquote/polytini", "@googlemaps/polyline-codec", "1.27x"],
  ["Encode, any length", "@duoquote/polytini", "google-polyline", "2.01x"],
  ["Decode 1000 lines in one call", "@duoquote/polytini (wasm decodeMany)", "@duoquote/polytini (wasm, Float64Array)", "1.57x"],
  ["Smallest bundle (gzipped)", "google-polyline (551 B)", "@googlemaps/polyline-codec (568 B)", "17 B smaller"],
  ["Strict validation (throws on bad input)", "@duoquote/polytini", "@lp-labs/polyline-codec", "17x"],
  ["HERE Flexible Polyline", "@duoquote/polytini (flexible)", "@here/flexpolyline", "25x"],
]

// Intrinsic sizes of the SVGs, so the page doesn't jump when they load.
const SIZE: Record<string, [number, number]> = {
  overview: [1108, 573],
  "overview-narrow": [614, 1104],
  "grouped-decode": [976, 1044],
  "grouped-encode": [976, 1044],
}

function Chart({ name, alt, narrow }: { name: string; alt: string; narrow?: boolean }) {
  const dark = useDark()
  const mode = dark ? "dark" : "light"
  return (
    <picture>
      {narrow ? <source
          media="(max-width: 640px)"
          srcSet={`${RAW}${name}-narrow-${mode}.svg`}
          width={SIZE[`${name}-narrow`][0]}
          height={SIZE[`${name}-narrow`][1]}
        /> : null}
      <img
        src={`${RAW}${name}-${mode}.svg`}
        alt={alt}
        width={SIZE[name][0]}
        height={SIZE[name][1]}
        loading="lazy"
        decoding="async"
        className="h-auto w-full border bg-background"
      />
    </picture>
  )
}

export function Results() {
  return (
    <Section
      id="results"
      title="Published results"
      intro={
        <>
          From <a className="underline" href={REPO}>polyline-benchmark</a>'s 27 November 2026 run with polytini 0.1.4,
          on Bun, Node 22 to 26, Deno and Chrome. I wrote both, so read polytini's rows knowing that.
        </>
      }
    >
      <div className="flex flex-col gap-8">
        <div className="max-w-3xl space-y-3 text-sm">
          <p>
            Encoding is about twice as fast as the next library on every runtime. Decoding is ahead on long and
            real-world lines (1.20 to 1.27 times the next library), but at 10 points it's 11 to 21% slower on every
            runtime except Bun, and Chrome is behind at most lengths.
          </p>
          <p>
            It's also bigger: about 2 KB gzipped, against 551 bytes for <code>google-polyline</code>. Most of that is
            error checking and an exact path for precision 7 and up. If every byte counts, a smaller library is the
            better pick.
          </p>
        </div>

        <figure className="flex flex-col gap-2">
          <Chart
            name="overview"
            narrow
            alt="Heatmap of polytini against the fastest other polyline library: a row per runtime (Bun, Node 22 to 26, Deno, Chrome) and a column per case (decode and encode at 10 to 100,000 points and on real-world lines). Each cell gives the ratio and names the fastest other library; hatched cells are within the noise."
          />
          <figcaption className="text-xs text-muted-foreground">
            polytini divided by the fastest other library in each cell. Hatched cells are inside the noise of 5 to 7%.
          </figcaption>
        </figure>

        <div className="grid gap-6 lg:grid-cols-2">
          <Chart
            name="grouped-decode"
            alt="Decode speed of polytini and four other libraries relative to @mapbox/polyline, a panel per runtime and a group of bars per line length, on a log scale."
          />
          <Chart
            name="grouped-encode"
            alt="Encode speed of polytini and four other libraries relative to @mapbox/polyline, a panel per runtime and a group of bars per line length, on a log scale."
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <caption className="mb-2 text-left text-sm font-medium">
              Best at what, across every runtime (geometric mean over runtimes and line lengths)
            </caption>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-4 font-medium">Situation</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">Best</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">Runner-up</th>
                <th scope="col" className="py-1.5 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {BEST.map(([situation, best, second, margin]) => (
                <tr key={situation} className="border-b">
                  <th scope="row" className="py-1.5 pr-4 font-normal">{situation}</th>
                  <td className="py-1.5 pr-4 font-mono">{best}</td>
                  <td className="py-1.5 pr-4 font-mono text-muted-foreground">{second}</td>
                  <td className="py-1.5 text-right font-mono">{margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          <a className="underline" href={`${REPO}#readme`}>
            The full results
          </a>{" "}
          have every table and chart per runtime, memory use, bundle sizes and how each library handles bad input.
        </p>
      </div>
    </Section>
  )
}
