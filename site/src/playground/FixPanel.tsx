import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FIX_PARAM, FIXES, fixDefault, runFix, type FixId, type FixParams, type FixResult } from "./fixes"
import { formatMeters } from "./geo"
import type { Collection } from "./model"

// The split gap's slider is logarithmic: 0 to 100 is 10 m to 1,000 km.
const gapToMeters = (v: number) => Math.round(10 * 10 ** (v / 20))
const metersToGap = (m: number) => Math.max(0, Math.min(100, 20 * Math.log10(m / 10)))

/** The control for a fix's one setting, if it has one. */
function Param({ id, value, onChange }: { id: FixId; value: number; onChange: (v: number) => void }) {
  const key = FIX_PARAM[id]
  if (key === "k")
    return (
      <div className="flex flex-col gap-1">
        <span id={`pg-fix-${id}`}>Multiply by</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={String(value)} aria-labelledby={`pg-fix-${id}`} onValueChange={(v) => v && onChange(Number(v))} className="flex-wrap">
          {[-3, -2, -1, 1, 2, 3].map((k) => (
            <ToggleGroupItem key={k} value={String(k)} aria-label={`10 to the power ${k}`}>
              10<sup>{k}</sup>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    )
  const slider = (label: string, shown: string, min: number, max: number, v: number, set: (x: number) => void) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={`pg-fix-${id}`}>{label}</Label>
        <span className="font-mono tabular-nums">{shown}</span>
      </div>
      <Slider id={`pg-fix-${id}`} min={min} max={max} step={1} value={[v]} thumbLabel={label} onValueChange={([x]) => set(x)} />
    </div>
  )
  if (key === "factor") return slider("Jump, times the usual step", `${value}×`, 2, 100, value, onChange)
  if (key === "gap") return slider("Gap", formatMeters(value), 0, 100, metersToGap(value), (x) => onChange(gapToMeters(x)))
  if (key === "digits") return slider("Decimals", String(value), 0, 9, value, onChange)
  return null
}

export function FixPanel({
  collection,
  precision,
  pending,
  onPreview,
  onApply,
  onCancel,
}: {
  collection: Collection
  precision: number
  /** Whether the pending change is this tab's. */
  pending: boolean
  onPreview: (result: Collection | null, label?: string) => void
  onApply: () => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<FixId | null>(null)
  const [value, setValue] = useState<number | undefined>(undefined)
  // The slider moves at once; the fix runs on the latest value React gets to,
  // so a drag over a big line skips the values in between.
  const deferred = useDeferredValue(value)

  // Every fix with its default setting, so each row can say what it would do.
  const results = useMemo(() => {
    const out = new Map<FixId, FixResult>()
    for (const f of FIXES) {
      try {
        out.set(f.id, runFix(f.id, collection, precision))
      } catch {
        // A fix that can't run on this geometry shows no count.
      }
    }
    return out
  }, [collection, precision])

  const live = useMemo(() => {
    if (!selected) return null
    const key = FIX_PARAM[selected]
    const params: FixParams = key && deferred !== undefined ? { [key]: deferred } : {}
    try {
      return runFix(selected, collection, precision, params)
    } catch {
      return null
    }
  }, [selected, deferred, collection, precision])

  // The selected fix is the preview, recomputed against the current
  // geometry whenever it changes.
  useEffect(() => {
    const f = FIXES.find((x) => x.id === selected)
    onPreview(live && live.changed ? live.result : null, f ? `${f.label}: ${live?.changed ?? 0} change${live?.changed === 1 ? "" : "s"}${live?.note ? `, ${live.note}` : ""}` : undefined)
  }, [live, selected, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])

  const choose = (id: FixId) => {
    if (selected === id) {
      setSelected(null)
      onCancel()
      return
    }
    setSelected(id)
    setValue(fixDefault(id, collection, precision))
  }

  return (
    <ul className="flex flex-col divide-y border text-xs">
      {FIXES.map((f) => {
        const on = selected === f.id
        const r = on ? live : results.get(f.id)
        const n = r?.changed ?? 0
        return (
          <li key={f.id} className={on ? "bg-muted/60" : ""}>
            <div className="flex items-start gap-3 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {f.label}{" "}
                  <span className={n ? "text-foreground" : "text-muted-foreground"}>
                    · {n ? `${n} change${n === 1 ? "" : "s"}` : "nothing to change"}
                    {r?.note && n ? `, ${r.note}` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{f.explain}</p>
              </div>
              <Button
                variant={on ? "default" : "outline"}
                size="sm"
                aria-pressed={on}
                aria-label={on ? `Stop previewing ${f.label}` : `Preview ${f.label}`}
                disabled={!on && !n && !FIX_PARAM[f.id]}
                onClick={() => choose(f.id)}
              >
                {on ? "Previewing" : "Preview"}
              </Button>
            </div>
            {on ? (
              <div className="flex flex-col gap-3 px-2.5 pb-2.5">
                {FIX_PARAM[f.id] && value !== undefined ? <Param id={f.id} value={value} onChange={setValue} /> : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!pending} onClick={onApply}>
                    Apply
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
