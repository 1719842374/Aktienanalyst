import { TA_NARROW_MAX_PX } from "@/lib/taChartScale";

/** 375 px liegt unter dem TA-Breakpoint, 1440 px darüber. */
export function fundamentalOverlayLayout(viewportPx: number): "stacked" | "inline" {
  return viewportPx <= TA_NARROW_MAX_PX ? "stacked" : "inline";
}

/** Peer-Zeile: unter sm gestapelt (375), ab sm eine Zeile (1440). */
export const FUNDAMENTAL_PEER_ROW_CLASS =
  "flex min-w-0 max-w-full flex-col gap-1 sm:flex-row sm:items-center";
