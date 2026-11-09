"use client";

/**
 * KLINE CHARTS (owner-approved plan, 2026-11-09): the rendering half of the
 * ```kline fence (spec + validation: components/kline-spec.ts). Three parts:
 *
 * - KlineChartView: mounts one lightweight-charts chart for a validated
 *   spec. The library loads on demand (dynamic import inside the effect),
 *   so the bundle cost is paid only when a chart is actually shown.
 *   INLINE mode never claims the mouse wheel (the page keeps scrolling —
 *   the same rule as demo cards); drag-to-pan and the crosshair stay on.
 *   FULLSCREEN mode turns every interaction on, wheel zoom included.
 * - KlineError: the in-place error card — problems, collapsible source and
 *   a "Send to teacher" button (the demo card's error-fix loop).
 * - KlineOverlay: the session-scoped fullscreen focus (the mermaid
 *   overlay's shell: absolute inside the session area, Esc closes).
 *
 * Candles rise red and fall green (owner). The TradingView attribution logo
 * stays on — the library's Apache-2.0 NOTICE asks for it.
 */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import type { IChartApi, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";
import { ChatActionsContext } from "@/components/chat-actions";
import { KlineAnnotationsPrimitive, withAlpha } from "@/components/kline-primitive";
import {
	KLINE_COLORS,
	KLINE_DOWN_COLOR,
	KLINE_UP_COLOR,
	formatKlineCrosshair,
	klineBarTime,
	klineFailureMessage,
	klinePricePrecision,
	klineProblemLines,
	parseKline,
	type KlineSpec,
} from "@/components/kline-spec";

/** Inline chart height (px). */
export const KLINE_INLINE_HEIGHT = 360;

export function KlineChartView({
	spec,
	interactive,
	className,
	style,
	onRenderError,
}: {
	spec: KlineSpec;
	/** true = fullscreen (all interactions); false = inline (no wheel). */
	interactive: boolean;
	className?: string;
	style?: React.CSSProperties;
	onRenderError: (message: string) => void;
}) {
	const holderRef = useRef<HTMLDivElement>(null);
	const onErrorRef = useRef(onRenderError);
	onErrorRef.current = onRenderError;

	useEffect(() => {
		const el = holderRef.current;
		if (!el) return;
		let disposed = false;
		let chart: IChartApi | null = null;
		let fitObserver: ResizeObserver | null = null;
		void (async () => {
			try {
				const lc = await import("lightweight-charts");
				if (disposed) return;
				const cs = getComputedStyle(el);
				const muted = cs.getPropertyValue("--muted-foreground").trim() || "#8d8d8d";
				const border = cs.getPropertyValue("--border").trim() || "#434343";
				// The prose font everywhere (inline and fullscreen alike — the
				// overlay itself sits in the mono UI font).
				const fontFamily =
					cs.getPropertyValue("--font-prose").trim() || cs.fontFamily || "ui-sans-serif, system-ui, sans-serif";
				const daily = spec.time?.interval === "1d" || spec.time?.interval === "1w";
				const precision = klinePricePrecision(spec);
				const time = (bar: number) => klineBarTime(spec, bar) as UTCTimestamp;

				chart = lc.createChart(el, {
					autoSize: true,
					layout: {
						background: { type: lc.ColorType.Solid, color: "transparent" },
						textColor: muted,
						fontFamily,
						fontSize: 11,
						attributionLogo: true,
					},
					grid: {
						vertLines: { color: "rgba(255, 255, 255, 0.04)" },
						horzLines: { color: "rgba(255, 255, 255, 0.04)" },
					},
					rightPriceScale: { borderColor: border },
					timeScale: {
						borderColor: border,
						timeVisible: spec.time !== undefined && !daily,
						secondsVisible: false,
						...(spec.time ? {} : { tickMarkFormatter: (t: Time) => `#${t as number}` }),
					},
					localization: { timeFormatter: (t: Time) => formatKlineCrosshair(spec, t as number) },
					crosshair: { mode: lc.CrosshairMode.Normal },
					handleScroll: interactive
						? true
						: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
					handleScale: interactive
						? true
						: { mouseWheel: false, pinch: false, axisPressedMouseMove: true, axisDoubleClickReset: true },
				});

				const candles = chart.addSeries(lc.CandlestickSeries, {
					upColor: KLINE_UP_COLOR,
					downColor: KLINE_DOWN_COLOR,
					borderUpColor: KLINE_UP_COLOR,
					borderDownColor: KLINE_DOWN_COLOR,
					wickUpColor: KLINE_UP_COLOR,
					wickDownColor: KLINE_DOWN_COLOR,
					priceLineVisible: false,
					lastValueVisible: false,
					priceFormat: { type: "price", precision, minMove: 10 ** -precision },
				});
				candles.setData(
					spec.candles.map((c, i) => ({ time: time(i + 1), open: c.open, high: c.high, low: c.low, close: c.close })),
				);

				if (spec.hasVolume) {
					// Volume overlays the bottom fifth; candles keep the space above.
					const volume = chart.addSeries(lc.HistogramSeries, {
						priceScaleId: "volume",
						priceFormat: { type: "volume" },
						priceLineVisible: false,
						lastValueVisible: false,
					});
					chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
					candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
					volume.setData(
						spec.candles.flatMap((c, i) =>
							c.volume === undefined
								? []
								: [
										{
											time: time(i + 1),
											value: c.volume,
											color: withAlpha(c.close >= c.open ? KLINE_UP_COLOR : KLINE_DOWN_COLOR, 0.45),
										},
									],
						),
					);
				}

				const markers: SeriesMarker<Time>[] = spec.annotations
					.flatMap((a) => (a.type === "marker" ? [a] : []))
					.sort((a, b) => a.bar - b.bar)
					.map((m) => ({
						time: time(m.bar),
						position: m.position === "above" ? "aboveBar" : "belowBar",
						shape: m.shape,
						color: KLINE_COLORS[m.color],
						...(m.label ? { text: m.label } : {}),
					}));
				if (markers.length > 0) lc.createSeriesMarkers(candles, markers);

				candles.attachPrimitive(new KlineAnnotationsPrimitive(spec, fontFamily));
				// Fit every bar into view. autoSize applies the holder's size
				// asynchronously (its own ResizeObserver), so a fit right now
				// would use a stale width: fit again once the first real size
				// lands (this observer registers after the chart's, so it runs
				// after the chart has resized). Later resizes keep the visible
				// range (lockVisibleTimeRangeOnResize).
				const fitted = chart;
				fitted.timeScale().applyOptions({ lockVisibleTimeRangeOnResize: true });
				fitted.timeScale().fitContent();
				if (typeof ResizeObserver !== "undefined") {
					fitObserver = new ResizeObserver(() => {
						if (el.clientWidth === 0 || el.clientHeight === 0) return;
						fitted.timeScale().fitContent();
						fitObserver?.disconnect();
						fitObserver = null;
					});
					fitObserver.observe(el);
				}
			} catch (e) {
				if (!disposed) onErrorRef.current(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			disposed = true;
			fitObserver?.disconnect();
			chart?.remove();
		};
	}, [spec, interactive]);

	return <div ref={holderRef} data-testid="kline-chart" className={cn("w-full", className)} style={style} />;
}

export function KlineError({
	title,
	problems,
	kind,
	source,
}: {
	title?: string;
	problems: readonly string[];
	kind: "validation" | "render";
	source: string;
}) {
	const actions = useContext(ChatActionsContext);
	return (
		<div className="my-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4" data-testid="kline-error">
			<p className="text-sm font-medium text-destructive">
				{kind === "validation" ? "Chart failed validation" : "Chart failed to render"}
				{title ? <span className="font-normal text-muted-foreground"> — {title}</span> : null}
			</p>
			<ul className="mt-1 list-disc pl-5 font-mono text-xs break-words text-muted-foreground">
				{klineProblemLines(problems).map((p, i) => (
					<li key={i}>{p}</li>
				))}
			</ul>
			<details className="mt-3">
				<summary className="cursor-pointer text-xs text-muted-foreground">Show chart source</summary>
				<pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground">{source}</pre>
			</details>
			{actions && (
				<button
					type="button"
					onClick={() => actions.sendText(klineFailureMessage(title, problems, kind))}
					className="mt-3 rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/15"
					data-testid="kline-error-send"
				>
					Send to teacher
				</button>
			)}
		</div>
	);
}

/** The fullscreen focus: the same shell as the mermaid overlay, the chart
 *  filling the stage with every interaction enabled. */
export function KlineOverlay({ source, onClose }: { source: string; onClose: () => void }) {
	const parsed = useMemo(() => parseKline(source), [source]);
	const [renderError, setRenderError] = useState<string | null>(null);

	// Esc closes — claimed at the document level, like the mermaid overlay
	// (one Esc, one action; the window chain never fires under this layer).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const title = parsed.ok ? parsed.spec.title : parsed.title;
	return (
		<div
			data-testid="kline-overlay"
			className="absolute inset-0 z-40 flex flex-col bg-background/80 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label="Chart focus"
		>
			<div className="mb-2 flex min-w-0 items-center gap-2">
				<span className="shrink-0 text-sm font-medium">Chart</span>
				<span className="truncate text-xs text-muted-foreground">{title ?? "from this lesson"}</span>
				<Hint label="Close" binding="escape" side="left">
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						data-testid="kline-overlay-close"
						className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<XIcon className="size-4" />
					</button>
				</Hint>
			</div>
			<div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-background p-2">
				{!parsed.ok ? (
					<KlineError title={parsed.title} problems={parsed.problems} kind="validation" source={source} />
				) : renderError !== null ? (
					<KlineError title={title} problems={[renderError]} kind="render" source={source} />
				) : (
					<KlineChartView spec={parsed.spec} interactive className="h-full" onRenderError={setRenderError} />
				)}
			</div>
		</div>
	);
}
