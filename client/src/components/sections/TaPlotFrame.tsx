import type { ReactNode } from "react";
import { Bar, ComposedChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { TA_VOLUME_BAND_PX } from "@/lib/taChartScale";

/** Chart-Fläche: unter der Mindestbreite horizontal scrollen, nicht quetschen. */
export function TaPlotScroll({
  minWidth,
  children,
  testId = "ta-plot-scroll",
}: {
  minWidth?: number;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1 sm:pb-0"
      data-testid={testId}
      data-min-width={minWidth ?? undefined}
    >
      <div className="w-full" style={minWidth ? { minWidth } : undefined}>
        {children}
      </div>
    </div>
  );
}

type VolBarProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { _volUp?: boolean };
};

function VolumeBar({ x = 0, y = 0, width = 0, height = 0, payload }: VolBarProps) {
  const fill = payload?._volUp ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
  return <rect x={x} y={y} width={Math.max(width, 1)} height={Math.abs(height)} fill={fill} />;
}

/**
 * Eigenes Volumen-Band (Mobile). Höhe ist der Floor (~40px), nicht ein Anteil
 * des Kurs-Plots. Linke/rechte Achsenbreite spiegelt den Kurs-Plot, damit die
 * Balken auf derselben Zeitachse liegen.
 */
export function TaVolumeBand<T extends { _volUp?: boolean }>({
  data,
  leftAxisWidth,
  rightAxisWidth = 0,
  marginRight,
}: {
  data: T[];
  leftAxisWidth: number;
  rightAxisWidth?: number;
  marginRight: number;
}) {
  return (
    <div className="w-full" style={{ height: TA_VOLUME_BAND_PX }} data-testid="ta-volume-band">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 0, right: marginRight, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis width={leftAxisWidth} domain={[0, 1]} tick={false} axisLine={false} tickLine={false} />
          {rightAxisWidth > 0 && (
            <YAxis yAxisId="pad" orientation="right" width={rightAxisWidth} tick={false} axisLine={false} tickLine={false} />
          )}
          <Bar yAxisId={0} dataKey="_volNorm" name="Volumen" isAnimationActive={false} maxBarSize={8} shape={VolumeBar} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
