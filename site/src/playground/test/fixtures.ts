// The repo's own fixtures, read from disk in tests (Node only).
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../../")
export const repoFile = (p: string) => readFileSync(resolve(root, p), "utf8")
export const repoJson = (p: string) => JSON.parse(repoFile(p))

/** The 1000 real-world lines, precision 5, PostGIS output (polyline-benchmark). */
export const realWorld = (): string[] =>
  repoFile("test/fixtures/real-world.csv")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.replace(/^"|"$/g, ""))
