/**
 * The ```kline fence spec (components/kline-spec.ts): parsing, validation,
 * the time-axis mapping, and the prompt fragment's own example.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	KLINE_MAX_CANDLES,
	KLINE_MAX_SHOWN_PROBLEMS,
	formatKlineCrosshair,
	klineBarAt,
	klineBarTime,
	klineFailureMessage,
	klinePricePrecision,
	klineProblemLines,
	parseKline,
	parseKlineStart,
	type KlineSpec,
} from "../components/kline-spec.ts";

const CANDLES = [
	[10, 11, 9, 10.5],
	[10.5, 12, 10, 11.5],
	[11.5, 11.8, 10.8, 11],
];

function ok(body: object): KlineSpec {
	const r = parseKline(JSON.stringify(body));
	assert.ok(r.ok, r.ok ? "" : r.problems.join("\n"));
	return r.spec;
}

function problems(body: unknown): string[] {
	const r = parseKline(typeof body === "string" ? body : JSON.stringify(body));
	assert.equal(r.ok, false, "expected a validation failure");
	return r.ok ? [] : r.problems;
}

describe("kline spec — parsing", () => {
	it("accepts a minimal block: candles only, no time axis, no volume", () => {
		const spec = ok({ candles: CANDLES });
		assert.equal(spec.candles.length, 3);
		assert.deepEqual(spec.candles[0], { open: 10, high: 11, low: 9, close: 10.5 });
		assert.equal(spec.time, undefined);
		assert.equal(spec.hasVolume, false);
		assert.deepEqual(spec.annotations, []);
	});

	it("volume is optional per candle; one volume turns the volume pane on", () => {
		const spec = ok({ candles: [[10, 11, 9, 10.5, 1200], ...CANDLES.slice(1)] });
		assert.equal(spec.hasVolume, true);
		assert.equal(spec.candles[0]!.volume, 1200);
		assert.equal(spec.candles[1]!.volume, undefined);
	});

	it("parses all four annotation types with defaults (blue, solid)", () => {
		const spec = ok({
			title: "  Demo  ",
			candles: CANDLES,
			annotations: [
				{ type: "hline", price: 10 },
				{ type: "zone", from: 1, to: 2, top: 11, bottom: 10.5, label: "FVG", color: "purple" },
				{ type: "marker", bar: 3, position: "above", shape: "arrowDown", label: "Sweep" },
				{ type: "trendline", from: [1, 9], to: [3, 10.8], style: "dashed", extra: "ignored" },
			],
		});
		assert.equal(spec.title, "Demo");
		assert.deepEqual(spec.annotations, [
			{ type: "hline", price: 10, style: "solid", color: "blue" },
			{ type: "zone", from: 1, to: 2, top: 11, bottom: 10.5, label: "FVG", color: "purple" },
			{ type: "marker", bar: 3, position: "above", shape: "arrowDown", label: "Sweep", color: "blue" },
			{ type: "trendline", from: [1, 9], to: [3, 10.8], style: "dashed", color: "blue" },
		]);
	});

	it("hline from/to are each optional", () => {
		const spec = ok({ candles: CANDLES, annotations: [{ type: "hline", price: 10, from: 2 }, { type: "hline", price: 10, to: 2 }] });
		assert.deepEqual(spec.annotations.map((a) => a.type === "hline" && [a.from, a.to]), [[2, undefined], [undefined, 2]]);
	});
});

describe("kline spec — validation", () => {
	it("rejects non-JSON and non-object bodies", () => {
		assert.match(problems("{not json")[0]!, /not valid JSON/);
		assert.match(problems("[1,2]")[0]!, /one JSON object/);
	});

	it("rejects missing, empty and oversized candle arrays", () => {
		assert.match(problems({})[0]!, /`candles` must be a non-empty array/);
		assert.match(problems({ candles: [] })[0]!, /`candles` must be a non-empty array/);
		const many = Array.from({ length: KLINE_MAX_CANDLES + 1 }, () => [1, 1, 1, 1]);
		assert.match(problems({ candles: many })[0]!, /maximum is 1000/);
	});

	it("rejects malformed bars and impossible OHLC, naming the bar", () => {
		const p = problems({ candles: [[1, 2, 0], [10, 9, 8, 9.5], [10, 12, 10.5, 11], [1, 2, 0, 1, -5]] });
		assert.deepEqual(p, [
			"Bar 1: must be [open, high, low, close] or [open, high, low, close, volume] with finite numbers.",
			"Bar 2: high 9 is below max(open, close) = 10.",
			"Bar 3: low 10.5 is above min(open, close) = 10.",
			"Bar 4: volume -5 is negative.",
		]);
	});

	it("start and interval must come together and be well-formed", () => {
		assert.match(problems({ candles: CANDLES, start: "2024-03-05" })[0]!, /must be given together/);
		const p = problems({ candles: CANDLES, start: "2024-02-31 09:30", interval: "7m" });
		assert.equal(p.length, 2);
		assert.match(p[0]!, /`start` must be a date/);
		assert.match(p[1]!, /`interval` must be one of: 1m, 3m/);
	});

	it("rejects out-of-range bar references, reversed ranges and bad enums", () => {
		const p = problems({
			candles: CANDLES,
			annotations: [
				{ type: "zone", from: 3, to: 2, top: 10, bottom: 11 },
				{ type: "marker", bar: 4, position: "inside", shape: "star" },
				{ type: "trendline", from: [0, 1], to: [2] },
				{ type: "hline", price: "10", color: "pink", style: "wavy" },
				{ type: "arrow" },
				"nope",
			],
		});
		assert.deepEqual(p, [
			"Annotation 1 (zone): `from` (3) must not be after `to` (2).",
			"Annotation 1 (zone): `top` (10) must not be below `bottom` (11).",
			"Annotation 2 (marker): `bar` must be a bar number from 1 to 3.",
			"Annotation 2 (marker): `position` must be one of: above, below.",
			"Annotation 2 (marker): `shape` must be one of: arrowUp, arrowDown, circle.",
			"Annotation 3 (trendline): `from[0]` must be a bar number from 1 to 3.",
			"Annotation 3 (trendline): `to` must be [bar, price].",
			"Annotation 4 (hline): `color` must be one of: red, green, blue, orange, purple, yellow, gray.",
			"Annotation 4 (hline): `style` must be one of: solid, dashed, dotted.",
			"Annotation 4 (hline): `price` must be a number.",
			"Annotation 5: `type` must be one of: hline, zone, marker, trendline.",
			"Annotation 6: must be an object.",
		]);
	});

	it("keeps the title on failure so the error card can name the chart", () => {
		const r = parseKline(JSON.stringify({ title: "Broken", candles: [] }));
		assert.equal(r.ok, false);
		assert.equal(!r.ok && r.title, "Broken");
	});
});

describe("kline spec — time axis", () => {
	it("parseKlineStart reads the wall clock as UTC seconds", () => {
		assert.equal(parseKlineStart("2024-03-05 09:30"), Date.UTC(2024, 2, 5, 9, 30) / 1000);
		assert.equal(parseKlineStart("2024-03-05T09:30"), Date.UTC(2024, 2, 5, 9, 30) / 1000);
		assert.equal(parseKlineStart("2024-03-05"), Date.UTC(2024, 2, 5) / 1000);
		assert.equal(parseKlineStart("2024-3-5"), null);
		assert.equal(parseKlineStart("2024-03-05 24:00"), null);
	});

	it("without a time axis the bar number is the time; crosshair shows #n", () => {
		const spec = ok({ candles: CANDLES });
		assert.equal(klineBarTime(spec, 2), 2);
		assert.equal(klineBarAt(spec, 2), 2);
		assert.equal(formatKlineCrosshair(spec, 2), "#2");
	});

	it("with a time axis bars are consecutive intervals and display as written", () => {
		const intraday = ok({ candles: CANDLES, start: "2024-03-05 09:30", interval: "5m" });
		const t3 = klineBarTime(intraday, 3);
		assert.equal(t3 - klineBarTime(intraday, 1), 600);
		assert.equal(klineBarAt(intraday, t3), 3);
		assert.equal(formatKlineCrosshair(intraday, t3), "#3 · 2024-03-05 09:40");
		const daily = ok({ candles: CANDLES, start: "2024-03-08", interval: "1d" });
		assert.equal(formatKlineCrosshair(daily, klineBarTime(daily, 3)), "#3 · 2024-03-10");
	});
});

describe("kline spec — helpers", () => {
	it("price precision follows the most precise price, capped at 8", () => {
		assert.equal(klinePricePrecision(ok({ candles: [[100, 101, 99, 100]] })), 0);
		assert.equal(klinePricePrecision(ok({ candles: CANDLES })), 1);
		assert.equal(
			klinePricePrecision(ok({ candles: [[1.08, 1.09, 1.07, 1.085]], annotations: [{ type: "hline", price: 1.08345 }] })),
			5,
		);
		assert.equal(klinePricePrecision(ok({ candles: [[1e-9, 1e-9, 1e-9, 1e-9]] })), 8);
	});

	it("problem lines cap with a count tail; the teacher message lists them", () => {
		const many = Array.from({ length: KLINE_MAX_SHOWN_PROBLEMS + 3 }, (_, i) => `p${i}`);
		const lines = klineProblemLines(many);
		assert.equal(lines.length, KLINE_MAX_SHOWN_PROBLEMS + 1);
		assert.equal(lines.at(-1), "…and 3 more.");
		assert.equal(
			klineFailureMessage("FVG", ["a", "b"], "validation"),
			'The kline chart "FVG" failed validation:\n- a\n- b\nPlease fix and redraw it.',
		);
		assert.equal(klineFailureMessage(undefined, ["x"], "render"), "The kline chart failed to render:\n- x\nPlease fix and redraw it.");
	});
});

describe("kline prompt fragment", () => {
	it("its example block is a valid spec that really shows the sweep and the FVG", () => {
		const md = readFileSync("src/agent/prompts/shared/42-kline-charts.md", "utf8");
		const body = /```kline\r?\n([\s\S]*?)\r?\n```/.exec(md)?.[1];
		assert.ok(body, "the fragment carries a kline example");
		const spec = ok(JSON.parse(body));
		const c = spec.candles;
		// the sweep: bar 4 trades below the 99.8 level and closes back above
		assert.ok(c[3]!.low < 99.8 && c[3]!.close > 99.8);
		// the FVG: bar 5's high sits below bar 7's low — the zone is that gap
		const zone = spec.annotations.find((a) => a.type === "zone");
		assert.ok(zone && zone.type === "zone");
		assert.equal(zone.bottom, c[4]!.high);
		assert.equal(zone.top, c[6]!.low);
		// price returns into the gap on bar 8
		assert.ok(c[7]!.low < zone.top);
	});
});
