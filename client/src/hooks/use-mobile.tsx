import * as React from "react"
import { TA_NARROW_MAX_PX } from "@/lib/taChartScale"

const MOBILE_BREAKPOINT = 768

/** Tailwind `sm`: Mobile-TA-Skalierung gilt nur unter 640px. */
export function useIsNarrow() {
  const [narrow, setNarrow] = React.useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(`(max-width: ${TA_NARROW_MAX_PX}px)`).matches
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${TA_NARROW_MAX_PX}px)`)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return narrow
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
