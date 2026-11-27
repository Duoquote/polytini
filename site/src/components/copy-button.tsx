import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { highlight } from "@/lib/highlight"

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard can be blocked (insecure context, permissions); the
          // text is still selectable.
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

/** One shell command with a copy button, like a terminal line. */
export function CommandLine({ command, prefix = "$" }: { command: string; prefix?: string }) {
  return (
    <div className="flex items-center gap-2 border bg-muted/40 py-1 pr-1 pl-3 font-mono text-xs">
      {prefix ? (
        <span aria-hidden className="text-muted-foreground select-none">
          {prefix}
        </span>
      ) : null}
      <code
        className="code min-w-0 flex-1 overflow-x-auto py-1 break-all whitespace-pre-wrap sm:break-normal sm:whitespace-pre"
        dangerouslySetInnerHTML={{ __html: highlight(command, "bash") }}
      />
      <CopyButton text={command} label={`Copy: ${command}`} />
    </div>
  )
}
