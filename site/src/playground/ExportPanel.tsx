import { useState } from "react"
import { CheckIcon, CopyIcon, DownloadIcon, LoaderIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FORMATS, loadFormat, type FormatId } from "./formats"
import { encodeCollection, type PolylineOut } from "./encode"
import { allLines, type Collection } from "./model"

const MB = 1024 * 1024
const size = (n: number) => (n < 1024 ? `${n} B` : n < MB ? `${(n / 1024).toFixed(1)} KB` : `${(n / MB).toFixed(1)} MB`)

function download(data: string | Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Status = { id: string; state: "busy" | "copied" | "done" | "error"; note?: string }

export function ExportPanel({ collection, out, selected }: { collection: Collection; out: PolylineOut; selected?: number }) {
  const [scope, setScope] = useState<"all" | "line">("all")
  const [order, setOrder] = useState<"latlng" | "lnglat">("latlng")
  const [status, setStatus] = useState<Status | null>(null)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const lines = allLines(collection)

  // Only the selected line, with its feature's properties.
  const subject = (): Collection => {
    if (scope === "all") return collection
    const l = lines[selected ?? 0]
    return l ? { features: [{ lines: [l.line], props: collection.features[l.feature].props }] } : collection
  }

  const produce = async (id: FormatId | "polyline"): Promise<string | Uint8Array> => {
    if (id === "polyline") return encodeCollection(subject(), out)
    const conv = await loadFormat(id)
    return conv.write(subject(), { order, name: "polytini" })
  }

  const act = async (id: FormatId | "polyline", how: "copy" | "download") => {
    setStatus({ id, state: "busy" })
    try {
      const data = await produce(id)
      const n = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength
      setSizes((s) => ({ ...s, [id]: n }))
      if (how === "copy") {
        await navigator.clipboard.writeText(data as string)
        setStatus({ id, state: "copied", note: n > MB ? `Copied ${size(n)}. That's a lot for a clipboard; some apps get slow with it.` : `Copied ${size(n)}.` })
      } else {
        const info = id === "polyline" ? { ext: ["txt"], mime: "text/plain" } : FORMATS.find((f) => f.id === id)!
        download(data, `polytini.${info.ext[0]}`, info.mime)
        setStatus({ id, state: "done", note: `Downloaded ${size(n)}.` })
      }
    } catch (e) {
      setStatus({ id, state: "error", note: e instanceof Error ? e.message : String(e) })
    }
  }

  const rows: { id: FormatId | "polyline"; label: string; binary: boolean }[] = [
    { id: "polyline", label: "Encoded polyline, as in Output", binary: false },
    ...FORMATS.map((f) => ({ id: f.id, label: f.label, binary: f.binary })),
  ]

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-3">
        {lines.length > 1 ? (
          <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v as "all" | "line")} aria-label="What to export">
            <ToggleGroupItem value="all">Every line, one feature each</ToggleGroupItem>
            <ToggleGroupItem value="line">Selected line only</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        <ToggleGroup type="single" variant="outline" size="sm" value={order} onValueChange={(v) => v && setOrder(v as "latlng" | "lnglat")} aria-label="CSV column order">
          <ToggleGroupItem value="latlng">CSV lat, lng</ToggleGroupItem>
          <ToggleGroupItem value="lnglat">CSV lng, lat</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ul className="flex flex-col divide-y border">
        {rows.map((r) => {
          const s = status?.id === r.id ? status : null
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                {r.label}
                {r.binary ? <span className="text-muted-foreground"> · binary, download only</span> : null}
                {sizes[r.id] !== undefined ? <span className="text-muted-foreground"> · {size(sizes[r.id])}</span> : null}
              </span>
              {s?.state === "busy" ? <LoaderIcon className="size-4 animate-spin text-muted-foreground" aria-label="Working" /> : null}
              {!r.binary ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Copy as ${r.label}`} title="Copy" disabled={!lines.length} onClick={() => act(r.id, "copy")}>
                  {s?.state === "copied" ? <CheckIcon /> : <CopyIcon />}
                </Button>
              ) : null}
              <Button variant="ghost" size="icon-sm" aria-label={`Download as ${r.label}`} title="Download" disabled={!lines.length} onClick={() => act(r.id, "download")}>
                <DownloadIcon />
              </Button>
              {s?.note ? (
                <p role="status" className={`basis-full ${s.state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {s.note}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="text-muted-foreground">
        Shapefiles, KMZ, FlatGeobuf and GeoPackage are binary, so they download instead of copying. Each loads its code only
        when you use it. GeoPackage brings SQLite (about 1 MB of WebAssembly) the first time.
      </p>
    </div>
  )
}
