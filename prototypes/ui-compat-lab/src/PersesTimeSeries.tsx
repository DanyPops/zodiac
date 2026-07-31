import { ChartsProvider, generateChartsTheme, getTheme } from "@perses-dev/components";
import { TimeRangeContext } from "@perses-dev/plugin-system";
import type { TimeSeriesData } from "@perses-dev/spec";
import { TimeSeriesChartPanel } from "@perses-dev/timeseries-chart-plugin";
import { ThemeProvider } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";

const END = 1_735_732_800_000;
const START = END - 6 * 60 * 60 * 1_000;
const MAX_POINTS = 25;

const data: TimeSeriesData = {
  timeRange: { start: new Date(START), end: new Date(END) },
  stepMs: 15 * 60 * 1_000,
  series: [
    {
      name: "offset from grandmaster",
      labels: { metric: "offset", unit: "ns" },
      values: Array.from({ length: MAX_POINTS }, (_, index) => [
        START + index * 15 * 60 * 1_000,
        Math.round(18 * Math.sin(index / 3) + index / 2),
      ]),
    },
    {
      name: "path delay",
      labels: { metric: "path_delay", unit: "ns" },
      values: Array.from({ length: MAX_POINTS }, (_, index) => [
        START + index * 15 * 60 * 1_000,
        Math.round(42 + 8 * Math.cos(index / 4)),
      ]),
    },
  ],
};

const queryDefinition = {
  kind: "TimeSeriesQuery",
  spec: { plugin: { kind: "FixtureQuery", spec: {} } },
};

interface PersesTimeSeriesProps {
  onCanvasReady?: () => void;
}

export function PersesTimeSeries({ onCanvasReady }: PersesTimeSeriesProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const muiTheme = useMemo(() => getTheme("light", {}, true), []);
  const chartsTheme = useMemo(() => generateChartsTheme(muiTheme, {}), [muiTheme]);
  const timeRange = useMemo(
    () => ({
      timeRange: { start: new Date(START), end: new Date(END) },
      absoluteTimeRange: { start: new Date(START), end: new Date(END) },
      setTimeRange: () => undefined,
      refresh: () => undefined,
      refreshInterval: "0s" as const,
      refreshIntervalInMs: 0,
      setRefreshInterval: () => undefined,
    }),
    [],
  );

  useEffect(() => {
    let observer: MutationObserver;
    const markIfReady = () => {
      if (hostRef.current?.querySelector("canvas")) {
        onCanvasReady?.();
        observer?.disconnect();
      }
    };
    observer = new MutationObserver(markIfReady);
    if (hostRef.current) observer.observe(hostRef.current, { childList: true, subtree: true });
    const frame = requestAnimationFrame(markIfReady);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [onCanvasReady]);

  return (
    <div className="perses-host" ref={hostRef}>
      <ThemeProvider theme={muiTheme}>
        <ChartsProvider chartsTheme={chartsTheme}>
          <TimeRangeContext.Provider value={timeRange}>
            <TimeSeriesChartPanel
              contentDimensions={{ width: 720, height: 360 }}
              queryResults={[{ definition: queryDefinition, data }]}
              spec={{
                legend: { position: "bottom", size: "small" },
                yAxis: { format: { unit: "nanoseconds", decimalPlaces: 0 } },
                visual: { display: "line", palette: { mode: "auto" } },
              }}
            />
          </TimeRangeContext.Provider>
        </ChartsProvider>
      </ThemeProvider>
    </div>
  );
}
