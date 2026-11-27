import { useRef } from "react"
import { cn } from "cn"
import { tokenize } from "@/lib/highlight"

/**
 * A textarea with JSON highlighting: the text is drawn by a <pre> behind a
 * transparent textarea with the same font, padding and wrapping, so typing,
 * selection and the caret stay native.
 */
export function CodeInput({
  id,
  value,
  onChange,
  className,
  invalid,
  rows,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  className?: string
  invalid?: boolean
  rows?: number
}) {
  const pre = useRef<HTMLPreElement>(null)
  const shared = "m-0 px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
  return (
    <div
      className={cn(
        "relative border border-input focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/30",
        invalid && "border-destructive ring-1 ring-destructive/20",
        className
      )}
    >
      <pre
        ref={pre}
        aria-hidden
        className={cn("code pointer-events-none absolute inset-0 overflow-hidden", shared)}
        // A trailing newline needs a character after it to take up a line.
        dangerouslySetInnerHTML={{ __html: tokenize(value) + "\n " }}
      />
      <textarea
        id={id}
        value={value}
        rows={rows}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={invalid || undefined}
        className={cn(
          "relative block h-full w-full resize-y bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25 selection:text-transparent",
          shared
        )}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop
            pre.current.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
