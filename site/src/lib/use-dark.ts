import { useEffect, useState } from "react"

/** Whether the page is in dark mode right now (the "dark" class on <html>). */
export function useDark(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )
  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() =>
      setDark(el.classList.contains("dark"))
    )
    observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** True once the element has come near the viewport, then stays true. */
export function useNearViewport<T extends Element>(
  ref: React.RefObject<T | null>,
  margin = "300px"
): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: margin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, margin, near])
  return near
}
