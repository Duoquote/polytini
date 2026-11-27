// Map colors, shared by the lazily loaded map and the preview legend next to it.
// While a change is pending, the current geometry is a dashed slate line and
// the preview a solid accent line on top: they differ in hue, lightness and
// dash, so they read apart without color too.
export const MAP_COLORS = {
  light: { line: "#0e7490", current: "#64748b", hover: "#dc2626", halo: "#ffffff", static: "#b45309" },
  dark: { line: "#22d3ee", current: "#94a3b8", hover: "#f87171", halo: "#0a0a0a", static: "#fbbf24" },
}
