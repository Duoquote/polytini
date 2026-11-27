import { useMemo, useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FIXES, runFix, type FixId } from "./fixes"
import type { Collection } from "./model"

export function FixPanel({
  collection,
  precision,
  onPreview,
  onApply,
}: {
  collection: Collection
  precision: number
  onPreview: (c: Collection | null) => void
  onApply: (c: Collection) => void
}) {
  const [previewing, setPreviewing] = useState<FixId | null>(null)
  // Every fix runs on the current geometry, so each row can say how much it
  // would change before anything is applied.
  const results = useMemo(() => {
    const out = new Map<FixId, ReturnType<typeof runFix>>()
    for (const f of FIXES) {
      try {
        out.set(f.id, runFix(f.id, collection, precision))
      } catch {
        // A fix that can't run on this geometry shows no count.
      }
    }
    return out
  }, [collection, precision])

  return (
    <ul className="flex flex-col divide-y border text-xs">
      {FIXES.map((f) => {
        const r = results.get(f.id)
        const n = r?.changed ?? 0
        const on = previewing === f.id
        return (
          <li key={f.id} className={`flex items-start gap-3 p-2.5 ${on ? "bg-muted/60" : ""}`}>
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
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={on ? `Hide the preview of ${f.label}` : `Preview ${f.label}`}
                aria-pressed={on}
                title={on ? "Hide the preview" : "Preview on the map"}
                disabled={!n}
                onClick={() => {
                  setPreviewing(on ? null : f.id)
                  onPreview(on ? null : (r?.result ?? null))
                }}
              >
                {on ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!n || !r}
                onClick={() => {
                  setPreviewing(null)
                  if (r) onApply(r.result)
                }}
              >
                Apply
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
