// Undo and redo for the working geometry, plus where each change came from,
// so the map only redraws for changes it didn't make itself.
import { useCallback, useState } from "react"
import { emptyCollection, type Collection } from "./model"

export type Origin = "input" | "map" | "tool" | "table" | "history"

export type GeomState = {
  collection: Collection
  past: Collection[]
  future: Collection[]
  /**
   * The geometry before a run of uncommitted updates (a vertex drag in
   * progress), so its undo step goes back to before the drag started.
   */
  base: Collection | null
  origin: Origin
  /** Bumps on every change; the map redraws when it changes and the origin isn't the map. */
  version: number
}

const LIMIT = 100

export function useGeometry() {
  const [s, setS] = useState<GeomState>({ collection: emptyCollection(), past: [], future: [], base: null, origin: "input", version: 0 })

  /** Replaces the geometry. `commit: false` updates it without an undo step yet. */
  const set = useCallback((collection: Collection, origin: Origin, commit = true) => {
    setS((p) => {
      if (!commit) return { ...p, collection, base: p.base ?? p.collection, origin, version: p.version + 1 }
      return {
        collection,
        past: [...p.past, p.base ?? p.collection].slice(-LIMIT),
        future: [],
        base: null,
        origin,
        version: p.version + 1,
      }
    })
  }, [])

  const undo = useCallback(() => {
    setS((p) => {
      if (!p.past.length) return p
      return { collection: p.past[p.past.length - 1], past: p.past.slice(0, -1), future: [p.collection, ...p.future], base: null, origin: "history", version: p.version + 1 }
    })
  }, [])

  const redo = useCallback(() => {
    setS((p) => {
      if (!p.future.length) return p
      return { collection: p.future[0], past: [...p.past, p.collection], future: p.future.slice(1), base: null, origin: "history", version: p.version + 1 }
    })
  }, [])

  return { ...s, set, undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0 }
}
