/**
 * Render tests for the ```kline fence (md-blocks → components/kline-chart).
 * Static HTML via react-dom/server, the render-md-blocks idiom: effects never
 * run, so the chart library never loads — what is pinned here is the block
 * shell, the error card, the corner affordances and the overlay shell.
 * tsx note: classic JSX transform — the React global shim provides React.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageResponse } from "../components/ai-elements/message.tsx";
import { SessionMermaidContext } from "../components/session-overlay.tsx";
import { ChatActionsContext } from "../components/chat-actions.ts";
import { KlineOverlay } from "../components/kline-chart.tsx";

const VALID = JSON.stringify({ title: "Bullish FVG", candles: [[10, 11, 9, 10.5], [10.5, 12, 10, 11.5]] });
const INVALID = JSON.stringify({ title: "Broken", candles: [[10, 9, 8, 9.5]] });

const fence = (body: string) => "```kline\n" + body + "\n```";

function render(md: string): string {
	return renderToStaticMarkup(<MessageResponse mode="static">{md}</MessageResponse>);
}

const actions = { chatId: "c1", syncFromServer: async () => {}, sendText: () => {}, openSetup: () => {} };
const overlay = (withKline: boolean) => ({
	openMermaid: () => {},
	openFigure: () => {},
	...(withKline ? { openKline: () => {} } : {}),
});

describe("kline fence — inline block", () => {
	it("a valid block renders the chart holder, its title and the copy corner — not a code block", () => {
		const html = render(fence(VALID));
		assert.ok(html.includes('data-testid="md-kline"'), "the kline wrapper mounts");
		assert.ok(html.includes('data-testid="kline-chart"'), "the chart holder mounts");
		assert.ok(html.includes("Bullish FVG"), "the title shows above the chart");
		assert.match(html, /height:360px/, "inline height");
		assert.match(html, /aria-label="Copy chart source"/);
		assert.ok(!html.includes('data-streamdown="code-block"'), "never falls through to a code block");
		assert.ok(!html.includes('data-testid="kline-error"'));
	});

	it("an invalid block renders the error card with the problems and the source", () => {
		const html = render(fence(INVALID));
		assert.ok(html.includes('data-testid="kline-error"'));
		assert.ok(html.includes("Chart failed validation"));
		assert.ok(html.includes("Broken"), "the card names the chart");
		assert.ok(html.includes("Bar 1: high 9 is below max(open, close) = 10."));
		assert.ok(html.includes("Show chart source"));
		assert.ok(!html.includes('data-testid="kline-chart"'), "no chart for an invalid spec");
	});

	it("Send to teacher appears only inside a chat page", () => {
		assert.ok(!render(fence(INVALID)).includes('data-testid="kline-error-send"'), "no chat actions → no button");
		const html = renderToStaticMarkup(
			<ChatActionsContext.Provider value={actions}>
				<MessageResponse mode="static">{fence(INVALID)}</MessageResponse>
			</ChatActionsContext.Provider>,
		);
		assert.ok(html.includes('data-testid="kline-error-send"'));
	});

	it("the expand button needs a session context that can open a kline focus", () => {
		const withProvider = (withKline: boolean) =>
			renderToStaticMarkup(
				<SessionMermaidContext.Provider value={overlay(withKline)}>
					<MessageResponse mode="static">{fence(VALID)}</MessageResponse>
				</SessionMermaidContext.Provider>,
			);
		assert.ok(!render(fence(VALID)).includes('data-testid="md-kline-expand"'), "no session → no expand");
		assert.ok(!withProvider(false).includes('data-testid="md-kline-expand"'), "provider without openKline → no expand");
		assert.ok(withProvider(true).includes('data-testid="md-kline-expand"'));
	});
});

describe("kline fence — fullscreen overlay", () => {
	it("renders the session-scoped shell with the title and a close button", () => {
		const html = renderToStaticMarkup(<KlineOverlay source={VALID} onClose={() => {}} />);
		assert.match(html, /class="absolute inset-0[^"]*z-40/, "scoped to the session area, not fixed");
		assert.ok(html.includes('data-testid="kline-overlay-close"'));
		assert.ok(html.includes("Bullish FVG"));
		assert.ok(html.includes('data-testid="kline-chart"'));
	});

	it("an invalid source shows the error card inside the overlay", () => {
		const html = renderToStaticMarkup(<KlineOverlay source={INVALID} onClose={() => {}} />);
		assert.ok(html.includes('data-testid="kline-error"'));
	});
});
