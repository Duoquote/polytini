import type { ReactNode } from "react"

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16 border-t py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id={`${id}-title`} className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
          <a href={`#${id}`} className="hover:underline">
            {title}
          </a>
        </h2>
        {intro ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{intro}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </section>
  )
}
