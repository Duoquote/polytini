import { useRef, useState } from "react"
import { PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Section } from "@/components/section"
import { CASES, LIBS, type BenchMessage, type CaseId, type LibId } from "@/bench/cases"

type Result = { ops: number; ok: boolean }
type Results = Partial<Record<CaseId, Partial<Record<LibId, Result>>>>

const versions: Record<string, string> = {
  ...__LIB_VERSIONS__,
  "@duoquote/polytini": __POLYTINI_VERSION__,
  "@duoquote/polytini/wasm": __POLYTINI_VERSION__,
}

const fmtOps = (ops: number) =>
  ops >= 1e6 ? `${(ops / 1e6).toFixed(2)}M ops/s` : ops >= 1e3 ? `${(ops / 1e3).toFixed(1)}k ops/s` : `${ops.toFixed(0)} ops/s`

function browserName(): string {
  const ua = navigator.userAgent
  const m =
    ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/) ?? ([] as string[])
  const name = { Edg: "Edge", OPR: "Opera", Firefox: "Firefox", Chrome: "Chrome", Version: "Safari" }[m[1] ?? ""]
  return name ? `${name} ${m[2]}` : "this browser"
}

function CaseBars({ id, label, results }: { id: CaseId; label: string; results: Partial<Record<LibId, Result>> }) {
  const base = results.mapbox?.ops
  if (!base) return null
  const ratios = LIBS.map((lib) => ({ lib, r: results[lib.id] })).filter((x) => x.r)
  const max = Math.max(...ratios.map((x) => x.r!.ops / base), 1)
  const titleId = `bench-${id}`
  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-labelledby={titleId}>
      <figcaption id={titleId} className="text-xs font-medium">
        {label}
      </figcaption>
      <div className="flex flex-col gap-1.5">
        {ratios.map(({ lib, r }) => {
          const ratio = r!.ops / base
          const ours = lib.id.startsWith("polytini")
          return (
            <div
              key={lib.id}
              className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-2 text-xs sm:grid-cols-[13rem_minmax(0,1fr)]"
              title={`${lib.name}: ${fmtOps(r!.ops)}`}
            >
              <span className={`truncate font-mono ${ours ? "text-foreground" : "text-muted-foreground"}`}>
                {lib.name}
              </span>
              <div className="relative flex h-4 items-center">
                {/* 1.0x, the @mapbox/polyline baseline */}
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px bg-border"
                  style={{ left: `${(1 / max) * 80}%` }}
                />
                <span
                  aria-hidden
                  className={`h-2.5 rounded-r ${ours ? "bg-primary" : "bg-muted-foreground/40"}`}
                  style={{ width: `${(ratio / max) * 80}%` }}
                />
                <span className="relative ml-1 bg-background px-0.5 font-mono tabular-nums">
                  {r!.ok ? `${ratio.toFixed(2)}x` : "wrong output"}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

export function Benchmark() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle")
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<Results>({})
  const [message, setMessage] = useState("")
  const worker = useRef<Worker | null>(null)

  function run() {
    worker.current?.terminate()
    setResults({})
    setProgress(0)
    setState("running")
    const w = new Worker(new URL("../bench/worker.ts", import.meta.url), { type: "module" })
    worker.current = w
    w.onmessage = (e: MessageEvent<BenchMessage>) => {
      const m = e.data
      if (m.type === "progress") setProgress((m.done / m.total) * 100)
      else if (m.type === "result")
        setResults((prev) => ({ ...prev, [m.case]: { ...prev[m.case], [m.lib]: { ops: m.ops, ok: m.ok } } }))
      else if (m.type === "done") {
        setState("done")
        w.terminate()
      } else if (m.type === "error") {
        setMessage(m.message)
        setState("error")
        w.terminate()
      }
    }
    w.onerror = () => {
      setMessage("The worker didn't start.")
      setState("error")
    }
    w.postMessage("run")
  }

  const rows = CASES.filter((c) => results[c.id]?.mapbox)

  return (
    <Section
      id="benchmark"
      title="Run it on your machine"
      intro={
        <>
          This times polytini, its WASM build and three other libraries in your browser, in a Web Worker so the page
          stays usable. It takes about 7 seconds. Each library's output is checked against polytini's first. Numbers
          are relative to <code>@mapbox/polyline</code> = 1.00x, higher is faster.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={state === "running"}>
            <PlayIcon /> {state === "idle" ? "Run the benchmark" : state === "running" ? "Running" : "Run again"}
          </Button>
          {state === "running" || state === "done" ? (
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <Progress value={progress} aria-label="Benchmark progress" className="max-w-sm" />
              <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {state === "done" ? "done" : `${progress.toFixed(0)}%`}
              </span>
            </div>
          ) : null}
        </div>
        {state === "error" ? (
          <p role="alert" className="text-xs text-destructive">
            It stopped: {message}
          </p>
        ) : null}

        {rows.length ? (
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            {rows.map((c) => (
              <CaseBars key={c.id} id={c.id} label={c.label} results={results[c.id]!} />
            ))}
          </div>
        ) : null}

        {state === "done" ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">The numbers as a table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left font-mono">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">Case</th>
                    {LIBS.map((l) => (
                      <th key={l.id} scope="col" className="py-1 pr-3 font-medium">
                        {l.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b">
                      <th scope="row" className="py-1 pr-3 font-sans font-normal">
                        {c.label}
                      </th>
                      {LIBS.map((l) => (
                        <td key={l.id} className="py-1 pr-3">
                          {results[c.id]?.[l.id] ? fmtOps(results[c.id]![l.id]!.ops) : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}

        <p className="max-w-3xl text-xs text-muted-foreground">
          {state === "done" ? `Measured in ${browserName()}. ` : ""}
          Results vary by browser, by machine and between runs, and a single run in a busy tab can move a lot more than
          the 5 to 7% the published benchmark sees with each runtime pinned to four cores. Take it as a rough picture.
          Versions:{" "}
          {Object.entries(versions)
            .filter(([n]) => !n.endsWith("/wasm"))
            .map(([n, v]) => `${n} ${v}`)
            .join(", ")}
          .
        </p>
      </div>
    </Section>
  )
}
