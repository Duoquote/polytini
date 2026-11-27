import { CircleAlertIcon } from "lucide-react"
import type { errorInfo } from "@/lib/geo"

export function ErrorBox({ error, title }: { error: ReturnType<typeof errorInfo>; title?: string }) {
  return (
    <div role="alert" className="flex gap-2 border border-destructive/40 bg-destructive/10 p-3 text-xs">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 font-mono">
        <p className="font-medium text-foreground">
          {title ?? "throws"} {error.name}: {error.message}
        </p>
        {error.code ? (
          <p className="mt-1 text-muted-foreground">
            code: <span className="text-foreground">'{error.code}'</span>
            {error.index !== undefined ? (
              <>
                , index: <span className="text-foreground">{error.index}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}
