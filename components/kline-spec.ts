/**
 * THE KLINE FENCE SPEC (owner-approved plan, 2026-11-09): a ```kline fenced
 * block carries ONE JSON object describing a candlestick chart for trading
 * lessons. This module is the pure half — parse, validate, and map bars to
 * the chart's time axis. Rendering lives in components/kline-chart.tsx.
 *
 * Shape (bars are numbered from 1; every annotation references bars by that
 * number):
 *
 *   {
 *     "title": "…",                                   optional
 *     "start": "2024-03-05 09:30", "interval": "5m",  optional, together
 *     "candles": [[o,h,l,c], [o,h,l,c,v], …],         required, 1..1000
 *     "annotations": [                                 optional
 *       {"type":"hline","price":p,"from":i,"to":j},                 from/to optional
 *       {"type":"zone","from":i,"to":j,"top":p1,"bottom":p2},
 *       {"type":"marker","bar":i,"position":"above"|"below","shape":"arrowUp"|"arrowDown"|"circle"},
 *       {"type":"trendline","from":[i,p1],"to":[j,p2]}
 *     ]
 *   }
 *
 * Every annotation takes optional `label` and `color` (the fixed palette
 * below, default blue); hline/trendline take optional `style`
 * (solid|dashed|dotted, default solid). Unknown extra fields are ignored;
 * an unknown annotation type is an error. All problems are collected and
 * reported together.
 *
 * Time: without start/interval the axis shows bar numbers. With them, bar i
 * sits at start + (i−1)·interval — consecutive, no session/weekend gaps —
 * and times display exactly as written (no timezone conversion: the wall
 * clock is stored as if it were UTC and formatted back as UTC).
 */

export const KLINE_MAX_CANDLES = 1000;

/** Interval name → seconds per bar. */
export const KLINE_INTERVALS = {
	"1m": 60,
	"3m": 180,
	"5m": 300,
	"15m": 900,
	"30m": 1800,
	"1h": 3600,
	"2h": 7200,
	"4h": 14400,
	"1d": 86400,
	"1w": 604800,
} as const;
export type KlineInterval = keyof typeof KLINE_INTERVALS;

/** The annotation palette (owner: fixed named palette, readable on the
 *  dark app surface). */
export const KLINE_COLORS = {
	red: "#ef4444",
	green: "#22c55e",
	blue: "#3b82f6",
	orange: "#f97316",
	purple: "#a855f7",
	yellow: "#eab308",
	gray: "#9ca3af",
} as const;
export type KlineColor = keyof typeof KLINE_COLORS;
export const KLINE_DEFAULT_COLOR: KlineColor = "blue";

/** Candle colors (owner: red rises, green falls). */
export const KLINE_UP_COLOR = KLINE_COLORS.red;
export const KLINE_DOWN_COLOR = KLINE_COLORS.green;

export type KlineLineStyle = "solid" | "dashed" | "dotted";

export interface KlineCandle {
	open: number;
	high: number;
	low: number;
	close: number;
	volume?: number;
}

interface AnnotationBase {
	label?: string;
	color: KlineColor;
}

export interface KlineHline extends AnnotationBase {
	type: "hline";
	price: number;
	/** Absent = extends to the chart's left edge. */
	from?: number;
	/** Absent = extends to the chart's right edge. */
	to?: number;
	style: KlineLineStyle;
}

export interface KlineZone extends AnnotationBase {
	type: "zone";
	from: number;
	to: number;
	top: number;
	bottom: number;
}

export interface KlineMarker extends AnnotationBase {
	type: "marker";
	bar: number;
	position: "above" | "below";
	shape: "arrowUp" | "arrowDown" | "circle";
}

export interface KlineTrendline extends AnnotationBase {
	type: "trendline";
	from: [number, number];
	to: [number, number];
	style: KlineLineStyle;
}

export type KlineAnnotation = KlineHline | KlineZone | KlineMarker | KlineTrendline;

export interface KlineSpec {
	title?: string;
	/** Present only when both start and interval were given. */
	time?: { startSeconds: number; interval: KlineInterval };
	candles: KlineCandle[];
	annotations: KlineAnnotation[];
	/** True when at least one candle carries a volume. */
	hasVolume: boolean;
}

export type KlineParseResult =
	| { ok: true; spec: KlineSpec }
	| { ok: false; problems: string[]; title?: string };

const LINE_STYLES: readonly KlineLineStyle[] = ["solid", "dashed", "dotted"];
const MARKER_POSITIONS = ["above", "below"] as const;
const MARKER_SHAPES = ["arrowUp", "arrowDown", "circle"] as const;
const ANNOTATION_TYPES = ["hline", "zone", "marker", "trendline"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const list = (values: readonly string[]) => values.join(", ");

/** "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" (a "T" separator is accepted too) →
 *  the wall clock as UTC epoch seconds, or null when malformed. Pure. */
export function parseKlineStart(text: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
	if (!m) return null;
	const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0"].map((s) => Number.parseInt(s!, 10)) as [
		number,
		number,
		number,
		number,
		number,
	];
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	const ms = Date.UTC(y, mo - 1, d, h, mi);
	const back = new Date(ms);
	// Reject rollovers such as 2024-02-31.
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
	return ms / 1000;
}

/** Parse and validate one fence body. Pure. */
export function parseKline(source: string): KlineParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (e) {
		return { ok: false, problems: [`The block is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
	}
	if (!isRecord(raw)) return { ok: false, problems: ["The block must be one JSON object."] };

	const problems: string[] = [];
	let title: string | undefined;
	if (raw.title !== undefined) {
		if (typeof raw.title === "string") title = raw.title.trim() || undefined;
		else problems.push("`title` must be a string.");
	}

	// ── time axis ──
	let time: KlineSpec["time"];
	const hasStart = raw.start !== undefined;
	const hasInterval = raw.interval !== undefined;
	if (hasStart !== hasInterval) {
		problems.push("`start` and `interval` must be given together (or both omitted).");
	} else if (hasStart && hasInterval) {
		const startSeconds = typeof raw.start === "string" ? parseKlineStart(raw.start) : null;
		if (startSeconds === null) problems.push('`start` must be a date like "2024-03-05" or "2024-03-05 09:30".');
		const intervalOk = typeof raw.interval === "string" && Object.hasOwn(KLINE_INTERVALS, raw.interval);
		if (!intervalOk) problems.push(`\`interval\` must be one of: ${list(Object.keys(KLINE_INTERVALS))}.`);
		if (startSeconds !== null && intervalOk) time = { startSeconds, interval: raw.interval as KlineInterval };
	}

	// ── candles ──
	const candles: KlineCandle[] = [];
	if (!Array.isArray(raw.candles) || raw.candles.length === 0) {
		problems.push("`candles` must be a non-empty array of [open, high, low, close] or [open, high, low, close, volume].");
	} else if (raw.candles.length > KLINE_MAX_CANDLES) {
		problems.push(`\`candles\` has ${raw.candles.length} bars; the maximum is ${KLINE_MAX_CANDLES}.`);
	} else {
		raw.candles.forEach((c, i) => {
			const bar = i + 1;
			if (!Array.isArray(c) || (c.length !== 4 && c.length !== 5) || !c.every(isFiniteNumber)) {
				problems.push(`Bar ${bar}: must be [open, high, low, close] or [open, high, low, close, volume] with finite numbers.`);
				return;
			}
			const [open, high, low, close, volume] = c as number[];
			const candle: KlineCandle = { open: open!, high: high!, low: low!, close: close! };
			if (high! < Math.max(open!, close!)) problems.push(`Bar ${bar}: high ${high} is below max(open, close) = ${Math.max(open!, close!)}.`);
			if (low! > Math.min(open!, close!)) problems.push(`Bar ${bar}: low ${low} is above min(open, close) = ${Math.min(open!, close!)}.`);
			if (volume !== undefined) {
				if (volume < 0) problems.push(`Bar ${bar}: volume ${volume} is negative.`);
				candle.volume = volume;
			}
			candles.push(candle);
		});
	}
	const barCount = Array.isArray(raw.candles) ? raw.candles.length : 0;

	// ── annotations ──
	const annotations: KlineAnnotation[] = [];
	if (raw.annotations !== undefined && !Array.isArray(raw.annotations)) {
		problems.push("`annotations` must be an array.");
	} else if (Array.isArray(raw.annotations)) {
		raw.annotations.forEach((a, i) => {
			const parsed = parseAnnotation(a, `Annotation ${i + 1}`, barCount, problems);
			if (parsed) annotations.push(parsed);
		});
	}

	if (problems.length > 0) return { ok: false, problems, title };
	return {
		ok: true,
		spec: {
			...(title !== undefined ? { title } : {}),
			...(time ? { time } : {}),
			candles,
			annotations,
			hasVolume: candles.some((c) => c.volume !== undefined),
		},
	};
}

function parseAnnotation(a: unknown, where: string, barCount: number, problems: string[]): KlineAnnotation | null {
	if (!isRecord(a)) {
		problems.push(`${where}: must be an object.`);
		return null;
	}
	const type = a.type;
	if (typeof type !== "string" || !(ANNOTATION_TYPES as readonly string[]).includes(type)) {
		problems.push(`${where}: \`type\` must be one of: ${list(ANNOTATION_TYPES)}.`);
		return null;
	}
	const at = `${where} (${type})`;
	const before = problems.length;

	const bar = (key: string, value: unknown, required: boolean): number | undefined => {
		if (value === undefined) {
			if (required) problems.push(`${at}: \`${key}\` is required.`);
			return undefined;
		}
		if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > barCount) {
			problems.push(`${at}: \`${key}\` must be a bar number from 1 to ${barCount}.`);
			return undefined;
		}
		return value as number;
	};
	const price = (key: string, value: unknown): number | undefined => {
		if (!isFiniteNumber(value)) {
			problems.push(`${at}: \`${key}\` must be a number.`);
			return undefined;
		}
		return value;
	};
	const point = (key: string, value: unknown): [number, number] | undefined => {
		if (!Array.isArray(value) || value.length !== 2) {
			problems.push(`${at}: \`${key}\` must be [bar, price].`);
			return undefined;
		}
		const b = bar(`${key}[0]`, value[0], true);
		const p = price(`${key}[1]`, value[1]);
		return b !== undefined && p !== undefined ? [b, p] : undefined;
	};

	let label: string | undefined;
	if (a.label !== undefined) {
		if (typeof a.label === "string") label = a.label.trim() || undefined;
		else problems.push(`${at}: \`label\` must be a string.`);
	}
	let color: KlineColor = KLINE_DEFAULT_COLOR;
	if (a.color !== undefined) {
		if (typeof a.color === "string" && Object.hasOwn(KLINE_COLORS, a.color)) color = a.color as KlineColor;
		else problems.push(`${at}: \`color\` must be one of: ${list(Object.keys(KLINE_COLORS))}.`);
	}
	let style: KlineLineStyle = "solid";
	if ((type === "hline" || type === "trendline") && a.style !== undefined) {
		if (typeof a.style === "string" && (LINE_STYLES as readonly string[]).includes(a.style)) style = a.style as KlineLineStyle;
		else problems.push(`${at}: \`style\` must be one of: ${list(LINE_STYLES)}.`);
	}
	const base = { ...(label !== undefined ? { label } : {}), color };

	let out: KlineAnnotation | null = null;
	if (type === "hline") {
		const p = price("price", a.price);
		const from = bar("from", a.from, false);
		const to = bar("to", a.to, false);
		if (from !== undefined && to !== undefined && from > to) problems.push(`${at}: \`from\` (${from}) must not be after \`to\` (${to}).`);
		if (p !== undefined) out = { type, price: p, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), style, ...base };
	} else if (type === "zone") {
		const from = bar("from", a.from, true);
		const to = bar("to", a.to, true);
		const top = price("top", a.top);
		const bottom = price("bottom", a.bottom);
		if (from !== undefined && to !== undefined && from > to) problems.push(`${at}: \`from\` (${from}) must not be after \`to\` (${to}).`);
		if (top !== undefined && bottom !== undefined && top < bottom) problems.push(`${at}: \`top\` (${top}) must not be below \`bottom\` (${bottom}).`);
		if (from !== undefined && to !== undefined && top !== undefined && bottom !== undefined) out = { type, from, to, top, bottom, ...base };
	} else if (type === "marker") {
		const b = bar("bar", a.bar, true);
		const position = a.position;
		const shape = a.shape;
		if (!(MARKER_POSITIONS as readonly unknown[]).includes(position)) problems.push(`${at}: \`position\` must be one of: ${list(MARKER_POSITIONS)}.`);
		if (!(MARKER_SHAPES as readonly unknown[]).includes(shape)) problems.push(`${at}: \`shape\` must be one of: ${list(MARKER_SHAPES)}.`);
		if (b !== undefined) out = { type, bar: b, position: position as KlineMarker["position"], shape: shape as KlineMarker["shape"], ...base };
	} else {
		const from = point("from", a.from);
		const to = point("to", a.to);
		if (from && to) out = { type: "trendline", from, to, style, ...base };
	}
	return problems.length > before ? null : out;
}

/** Decimal places the price axis needs to show the data exactly (forex
 *  quotes need 5, index points 0–2): the most decimals among all candle
 *  prices and annotation prices, clamped to 0..8. Pure. */
export function klinePricePrecision(spec: Pick<KlineSpec, "candles" | "annotations">): number {
	const decimals = (n: number): number => {
		if (Number.isInteger(n)) return 0;
		const s = String(n);
		const exp = /e-(\d+)$/.exec(s);
		if (exp) return Number.parseInt(exp[1]!, 10);
		return s.split(".")[1]?.length ?? 0;
	};
	const prices: number[] = [];
	for (const c of spec.candles) prices.push(c.open, c.high, c.low, c.close);
	for (const a of spec.annotations) {
		if (a.type === "hline") prices.push(a.price);
		else if (a.type === "zone") prices.push(a.top, a.bottom);
		else if (a.type === "trendline") prices.push(a.from[1], a.to[1]);
	}
	return Math.min(8, prices.reduce((max, p) => Math.max(max, decimals(p)), 0));
}

// ─── time axis mapping ───────────────────────────────────────────────────────

/** The chart-axis time (seconds) for bar `bar` (1-based). Without a time
 *  axis the bar number itself is the time — strictly increasing, which is
 *  all the chart requires. Pure. */
export function klineBarTime(spec: Pick<KlineSpec, "time">, bar: number): number {
	if (!spec.time) return bar;
	return spec.time.startSeconds + (bar - 1) * KLINE_INTERVALS[spec.time.interval];
}

/** The bar number at an axis time — the inverse of klineBarTime. Pure. */
export function klineBarAt(spec: Pick<KlineSpec, "time">, time: number): number {
	if (!spec.time) return time;
	return Math.round((time - spec.time.startSeconds) / KLINE_INTERVALS[spec.time.interval]) + 1;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The crosshair label for an axis time: "#7" without a time axis;
 *  "#7 · 2024-03-05 10:00" intraday; "#7 · 2024-03-05" for 1d/1w. Pure. */
export function formatKlineCrosshair(spec: Pick<KlineSpec, "time">, time: number): string {
	const bar = klineBarAt(spec, time);
	if (!spec.time) return `#${bar}`;
	const d = new Date(time * 1000);
	const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	const daily = spec.time.interval === "1d" || spec.time.interval === "1w";
	return daily ? `#${bar} · ${date}` : `#${bar} · ${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** At most this many problems are shown/sent; the rest are counted. */
export const KLINE_MAX_SHOWN_PROBLEMS = 20;

/** The problems as display lines — capped, with an "…and N more" tail. Pure. */
export function klineProblemLines(problems: readonly string[]): string[] {
	if (problems.length <= KLINE_MAX_SHOWN_PROBLEMS) return [...problems];
	return [...problems.slice(0, KLINE_MAX_SHOWN_PROBLEMS), `…and ${problems.length - KLINE_MAX_SHOWN_PROBLEMS} more.`];
}

/** The message the error card's "Send to teacher" button sends. Pure. */
export function klineFailureMessage(title: string | undefined, problems: readonly string[], kind: "validation" | "render"): string {
	const name = title ? `The kline chart "${title}"` : "The kline chart";
	const verb = kind === "validation" ? "failed validation" : "failed to render";
	return `${name} ${verb}:\n${klineProblemLines(problems).map((p) => `- ${p}`).join("\n")}\nPlease fix and redraw it.`;
}
