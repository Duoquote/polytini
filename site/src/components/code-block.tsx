import { cn } from "cn"
import { CopyButton } from "@/components/copy-button"
import { highlight } from "@/lib/highlight"

export function CodeBlock({
  code,
  lang = "js",
  label,
  className,
  maxHeight,
}: {
  code: string
  lang?: "bash" | "js" | "json" | "text"
  label?: string
  className?: string
  maxHeight?: string
}) {
  return (
    <div className={cn("relative border bg-muted/40", className)}>
      {label ? (
        <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
          <span>{label}</span>
          <CopyButton text={code} label={`Copy ${label}`} />
        </div>
      ) : (
        <CopyButton text={code} className="absolute top-1 right-1 bg-background/80" />
      )}
      <pre
        className="code overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed"
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
      >
        <code dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
      </pre>
    </div>
  )
}
