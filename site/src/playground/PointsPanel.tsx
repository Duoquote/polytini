import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { allLines, type Collection, type Pt } from "./model"
import type { Hover } from "./MapEditor"

const PAGE = 100

/** An input that commits on Enter or when it loses focus, so typing doesn't redraw the map per key. */
function Cell({ value, label, onCommit }: { value: number | undefined; label: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft)
    if (draft.trim() !== "" && Number.isFinite(v) && v !== value) onCommit(v)
    setDraft(null)
  }
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className="w-full min-w-0 border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs tabular-nums hover:border-input focus:border-ring focus:outline-none"
      value={draft ?? (value === undefined ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setDraft(null)
      }}
    />
  )
}

export function PointsPanel({
  collection,
  selected,
  onSelect,
  hover,
  onHover,
  onChange,
}: {
  collection: Collection
  selected: number
  onSelect: (n: number) => void
  hover: Hover
  onHover: (h: Hover) => void
  onChange: (c: Collection) => void
}) {
  const lines = allLines(collection)
  const sel = lines[selected] ?? lines[0]
  const pts = sel?.line.pts ?? []
  const [manual, setManual] = useState({ line: 0, page: 0 })
  const z = pts.some((p) => p.length > 2)

  // Follow the map: hovering a point there shows its page here.
  const page = hover && hover.line === selected ? Math.floor(hover.index / PAGE) : manual.line === selected ? manual.page : 0
  const setPage = (p: number) => setManual({ line: selected, page: p })

  if (!sel) return <p className="text-xs text-muted-foreground">No points yet. Paste something above, or draw on the map.</p>

  const edit = (i: number, k: number, v: number) => {
    const features = collection.features.map((f, fi) =>
      fi !== sel.feature
        ? f
        : {
            ...f,
            lines: f.lines.map((l, li) => {
              if (li !== sel.index) return l
              const next = l.pts.map((p, pi): Pt => (pi === i ? Object.assign([...p], { [k]: v }) : p))
              // Editing a ring's first point moves its closing point too.
              if (l.ring && i === 0 && next.length > 1) next[next.length - 1] = [...next[0]]
              return { ...l, pts: next }
            }),
          }
    )
    onChange({ features })
  }

  const name = (n: number) => {
    const l = lines[n]
    const props = collection.features[l.feature]?.props ?? {}
    const title = (props.name ?? props.title ?? props.id) as string | number | undefined
    return `Line ${n + 1}${title !== undefined ? `, ${String(title)}` : ""} · ${l.line.pts.length} points${l.line.ring ? ", ring" : ""}`
  }

  const pages = Math.max(1, Math.ceil(pts.length / PAGE))
  const start = page * PAGE
  return (
    <div className="flex flex-col gap-2">
      {lines.length > 1 ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="pg-line">Line</Label>
          <Select value={String(selected)} onValueChange={(v) => onSelect(Number(v))}>
            <SelectTrigger id="pg-line" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lines.slice(0, 500).map((_, n) => (
                <SelectItem key={n} value={String(n)}>
                  {name(n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{name(0)}</p>
      )}
      <div className="max-h-96 overflow-auto border" role="region" aria-label="Points of the selected line" tabIndex={0} onMouseLeave={() => onHover(null)}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th scope="col" className="w-12 px-2 py-1.5 font-medium">#</th>
              <th scope="col" className="px-1 py-1.5 font-medium">lat</th>
              <th scope="col" className="px-1 py-1.5 font-medium">lng</th>
              {z ? <th scope="col" className="px-1 py-1.5 font-medium">z</th> : null}
            </tr>
          </thead>
          <tbody>
            {pts.slice(start, start + PAGE).map((p, k) => {
              const i = start + k
              const on = hover?.line === selected && hover.index === i
              return (
                <tr key={i} className={`border-t ${on ? "bg-amber-500/15" : ""}`} onMouseEnter={() => onHover({ line: selected, index: i })}>
                  <td className="px-2 py-0.5 font-mono text-muted-foreground tabular-nums">{i}</td>
                  <td className="px-1 py-0.5">
                    <Cell value={p[0]} label={`Latitude of point ${i}`} onCommit={(v) => edit(i, 0, v)} />
                  </td>
                  <td className="px-1 py-0.5">
                    <Cell value={p[1]} label={`Longitude of point ${i}`} onCommit={(v) => edit(i, 1, v)} />
                  </td>
                  {z ? (
                    <td className="px-1 py-0.5">
                      <Cell value={p[2]} label={`Third value of point ${i}`} onCommit={(v) => edit(i, 2, v)} />
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Points {start}–{Math.min(pts.length, start + PAGE) - 1} of {pts.length}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
