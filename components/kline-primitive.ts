/**
 * The kline annotation primitive: one lightweight-charts series primitive
 * that paints the annotations the library has no built-in for — horizontal
 * segments, zones (FVG / order block boxes), two-point trendlines — plus
 * their labels. Markers use the library's own createSeriesMarkers instead
 * (components/kline-chart.tsx).
 *
 * Two pane views: zones paint at the BOTTOM of the stack (candles stay
 * readable on top of the shaded box); lines and labels paint on TOP.
 * Coordinates are media (CSS) pixels — the library scales for the device.
 */

import type {
	IChartApiBase,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	ISeriesApi,
	ISeriesPrimitive,
	PrimitivePaneViewZOrder,
	SeriesAttachedParameter,
	SeriesType,
	Time,
} from "lightweight-charts";
import { KLINE_COLORS, klineBarTime, type KlineAnnotation, type KlineLineStyle, type KlineSpec } from "@/components/kline-spec";

type DrawTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const LABEL_FONT_PX = 11;

/** Hex → rgba with alpha. Palette colors are #rrggbb. Pure. */
export function withAlpha(hex: string, alpha: number): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DASH: Record<KlineLineStyle, number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };

interface Geometry {
	chart: IChartApiBase<Time>;
	series: ISeriesApi<SeriesType, Time>;
	spec: KlineSpec;
	fontFamily: string;
}

/** x of a bar's center, or null when the bar is outside the loaded data. */
function barX(g: Geometry, bar: number): number | null {
	return g.chart.timeScale().timeToCoordinate(klineBarTime(g.spec, bar) as Time);
}

function halfBar(g: Geometry): number {
	return g.chart.timeScale().options().barSpacing / 2;
}

function drawLabel(ctx: CanvasRenderingContext2D, g: Geometry, text: string, x: number, y: number, color: string, align: CanvasTextAlign) {
	ctx.save();
	ctx.font = `${LABEL_FONT_PX}px ${g.fontFamily}`;
	ctx.textAlign = align;
	ctx.textBaseline = "bottom";
	// A dark halo keeps the label readable over candles and grid lines.
	ctx.lineWidth = 3;
	ctx.strokeStyle = "rgba(20, 20, 20, 0.85)";
	ctx.lineJoin = "round";
	ctx.strokeText(text, x, y);
	ctx.fillStyle = color;
	ctx.fillText(text, x, y);
	ctx.restore();
}

class ZonesRenderer implements IPrimitivePaneRenderer {
	constructor(private readonly g: Geometry) {}
	draw(target: DrawTarget) {
		target.useMediaCoordinateSpace(({ context: ctx }) => {
			for (const a of this.g.spec.annotations) {
				if (a.type !== "zone") continue;
				const x1 = barX(this.g, a.from);
				const x2 = barX(this.g, a.to);
				const yTop = this.g.series.priceToCoordinate(a.top);
				const yBottom = this.g.series.priceToCoordinate(a.bottom);
				if (x1 === null || x2 === null || yTop === null || yBottom === null) continue;
				const hb = halfBar(this.g);
				const left = x1 - hb;
				const width = x2 + hb - left;
				const top = Math.min(yTop, yBottom);
				const height = Math.max(1, Math.abs(yBottom - yTop));
				const color = KLINE_COLORS[a.color];
				ctx.fillStyle = withAlpha(color, 0.18);
				ctx.fillRect(left, top, width, height);
				ctx.strokeStyle = withAlpha(color, 0.6);
				ctx.lineWidth = 1;
				ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
			}
		});
	}
}

class LinesRenderer implements IPrimitivePaneRenderer {
	constructor(private readonly g: Geometry) {}
	draw(target: DrawTarget) {
		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			for (const a of this.g.spec.annotations) this.drawOne(ctx, mediaSize.width, a);
		});
	}

	private drawOne(ctx: CanvasRenderingContext2D, paneWidth: number, a: KlineAnnotation) {
		const color = KLINE_COLORS[a.color];
		if (a.type === "hline") {
			const y = this.g.series.priceToCoordinate(a.price);
			if (y === null) return;
			const hb = halfBar(this.g);
			const fromX = a.from !== undefined ? barX(this.g, a.from) : null;
			const toX = a.to !== undefined ? barX(this.g, a.to) : null;
			if ((a.from !== undefined && fromX === null) || (a.to !== undefined && toX === null)) return;
			const x1 = fromX === null ? 0 : fromX - hb;
			const x2 = toX === null ? paneWidth : toX + hb;
			strokeLine(ctx, x1, y, x2, y, color, a.style);
			if (a.label) drawLabel(ctx, this.g, a.label, Math.max(x1, 0) + 4, y - 3, color, "left");
		} else if (a.type === "zone") {
			if (!a.label) return;
			const x1 = barX(this.g, a.from);
			const yTop = this.g.series.priceToCoordinate(a.top);
			if (x1 === null || yTop === null) return;
			drawLabel(ctx, this.g, a.label, x1 - halfBar(this.g) + 4, yTop + LABEL_FONT_PX + 4, color, "left");
		} else if (a.type === "trendline") {
			const x1 = barX(this.g, a.from[0]);
			const x2 = barX(this.g, a.to[0]);
			const y1 = this.g.series.priceToCoordinate(a.from[1]);
			const y2 = this.g.series.priceToCoordinate(a.to[1]);
			if (x1 === null || x2 === null || y1 === null || y2 === null) return;
			strokeLine(ctx, x1, y1, x2, y2, color, a.style);
			if (a.label) drawLabel(ctx, this.g, a.label, x2, y2 - 4, color, x2 >= x1 ? "right" : "left");
		}
	}
}

function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, style: KlineLineStyle) {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	ctx.setLineDash(DASH[style]);
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.restore();
}

class PaneView implements IPrimitivePaneView {
	constructor(
		private readonly order: PrimitivePaneViewZOrder,
		private readonly make: () => IPrimitivePaneRenderer | null,
	) {}
	zOrder() {
		return this.order;
	}
	renderer() {
		return this.make();
	}
}

/** The primitive itself: attach with series.attachPrimitive(new
 *  KlineAnnotationsPrimitive(spec, fontFamily)). */
export class KlineAnnotationsPrimitive implements ISeriesPrimitive<Time> {
	private geometry: Geometry | null = null;
	private readonly views: readonly IPrimitivePaneView[];

	constructor(
		private readonly spec: KlineSpec,
		private readonly fontFamily: string,
	) {
		this.views = [
			new PaneView("bottom", () => (this.geometry ? new ZonesRenderer(this.geometry) : null)),
			new PaneView("top", () => (this.geometry ? new LinesRenderer(this.geometry) : null)),
		];
	}

	attached(param: SeriesAttachedParameter<Time, SeriesType>) {
		this.geometry = { chart: param.chart, series: param.series, spec: this.spec, fontFamily: this.fontFamily };
	}

	detached() {
		this.geometry = null;
	}

	paneViews() {
		return this.views;
	}
}
