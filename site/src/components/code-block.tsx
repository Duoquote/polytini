import { cn } from "cn"
import { CopyButton } from "@/components/copy-button"

export function CodeBlock({
  code,
  label,
  className,
  maxHeight,
}: {
  code: string
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
        className="overflow-auto p-3 font-mono text-xs leading-relaxed"
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
