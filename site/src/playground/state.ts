// The working geometry: what's committed, its undo history, and at most one
// pending preview from a tool. A preview changes nothing until it's
// applied, and applying it is one undo step.
import { useCallback, useMemo, useReducer } from "react"
import { emptyCollection, type Collection } from "./model"

export type Origin = "input" | "map" | "tool" | "table" | "history"

/** Which tool made the preview: the Compact tab, the Fix tab, or another reading of the input. */
export type PreviewSource = "compact" | "fix" | "reading"

export type Pending = { source: PreviewSource; label: string; result: Collection }

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
  /** Bumps on every committed change; the map redraws when it changes and the origin isn't the map. */
  version: number
  pending: Pending | null
}

export type GeomAction =
  | { type: "set"; collection: Collection; origin: Origin; commit?: boolean }
  | { type: "undo" }
  | { type: "redo" }
  /** A new preview from `source`, or with `result: null`, that source's preview gone. */
  | { type: "preview"; source: PreviewSource; label?: string; result: Collection | null }
  | { type: "apply" }
  | { type: "cancel" }

const LIMIT = 100

export const initialGeometry = (): GeomState => ({
  collection: emptyCollection(),
  past: [],
  future: [],
  base: null,
  origin: "input",
  version: 0,
  pending: null,
})

function commit(s: GeomState, collection: Collection, origin: Origin): GeomState {
  return {
    ...s,
    collection,
    past: [...s.past, s.base ?? s.collection].slice(-LIMIT),
    future: [],
    base: null,
    origin,
    version: s.version + 1,
  }
}

export function geometryReducer(s: GeomState, a: GeomAction): GeomState {
  switch (a.type) {
    case "set": {
      // New input replaces everything, so a preview of the old input goes.
      // Other edits keep it: the tool recomputes it against the new geometry.
      const pending = a.origin === "input" ? null : s.pending
      if (a.commit === false) return { ...s, collection: a.collection, base: s.base ?? s.collection, origin: a.origin, version: s.version + 1, pending }
      return { ...commit(s, a.collection, a.origin), pending }
    }
    case "undo":
      if (!s.past.length) return s
      return { ...s, collection: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.collection, ...s.future], base: null, origin: "history", version: s.version + 1 }
    case "redo":
      if (!s.future.length) return s
      return { ...s, collection: s.future[0], past: [...s.past, s.collection], future: s.future.slice(1), base: null, origin: "history", version: s.version + 1 }
    case "preview":
      if (a.result) return { ...s, pending: { source: a.source, label: a.label ?? "", result: a.result } }
      return s.pending?.source === a.source ? { ...s, pending: null } : s
    case "apply":
      if (!s.pending) return s
      return { ...commit(s, s.pending.result, "tool"), pending: null }
    case "cancel":
      return s.pending ? { ...s, pending: null } : s
  }
}

export function useGeometry() {
  const [s, dispatch] = useReducer(geometryReducer, undefined, initialGeometry)
  /** Replaces the geometry. `commit: false` updates it without an undo step yet. */
  const set = useCallback((collection: Collection, origin: Origin, commit = true) => dispatch({ type: "set", collection, origin, commit }), [])
  const undo = useCallback(() => dispatch({ type: "undo" }), [])
  const redo = useCallback(() => dispatch({ type: "redo" }), [])
  const preview = useCallback((source: PreviewSource, result: Collection | null, label?: string) => dispatch({ type: "preview", source, result, label }), [])
  const apply = useCallback(() => dispatch({ type: "apply" }), [])
  const cancel = useCallback(() => dispatch({ type: "cancel" }), [])
  return useMemo(
    () => ({ ...s, set, undo, redo, preview, apply, cancel, canUndo: s.past.length > 0, canRedo: s.future.length > 0 }),
    [s, set, undo, redo, preview, apply, cancel]
  )
}
