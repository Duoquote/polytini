import built from "virtual:highlighted"
import { snippetKey } from "@/snippets"

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// JSON and short JS calls that change as you type (Formats, the
// playground). Shiki would add hundreds of KB to the page for this, so it's
// a small tokenizer with the colors of the build-time theme (.tok-* in
// index.css).
const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\b(true|false|null|undefined)\b|([A-Za-z_$][\w$]*)/g

export function tokenize(code: string): string {
  let out = ""
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    out += escape(code.slice(last, m.index))
    const [all, comment, str, colon, num, kw, ident] = m
    if (comment !== undefined) out += `<span class="tok-com">${escape(comment)}</span>`
    else if (str !== undefined)
      out += colon
        ? `<span class="tok-key">${escape(str)}</span>${escape(colon)}`
        : `<span class="tok-str">${escape(str)}</span>`
    else if (num !== undefined || kw !== undefined) out += `<span class="tok-num">${num ?? kw}</span>`
    else if (ident !== undefined) out += `<span class="tok-fn">${ident}</span>`
    last = m.index + all.length
  }
  return out + escape(code.slice(last))
}

/**
 * HTML for a snippet: Shiki's from the build when it's one of the static
 * snippets, the small tokenizer for live JSON, plain text otherwise.
 */
export function highlight(code: string, lang: "bash" | "js" | "json" | "text"): string {
  const html = built[snippetKey(code, lang)]
  if (html) return html
  if (lang === "json") return tokenize(code)
  if (import.meta.env.DEV && lang !== "text") console.warn("Not highlighted at build time:", code)
  return escape(code)
}
