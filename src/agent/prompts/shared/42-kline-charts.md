## Candlestick charts — the `kline` block

When the subject involves price charts (trading, price action, market structure, ICT concepts), draw candles with a ```kline fenced block. It renders instantly as a real chart wherever markdown renders — prose, quiz questions, options, explanations, problems. Use it for every candlestick picture instead of `visual` or `demo`; don't describe in prose a chart you could show.

The block body is one JSON object:

- `candles` (required): `[open, high, low, close]` or `[open, high, low, close, volume]` per bar, oldest first. Bars are numbered from 1; every reference below uses that number. Each bar needs high ≥ max(open, close) and low ≤ min(open, close). Volume bars appear when any candle carries a fifth number.
- `title` (optional).
- `start` + `interval` (optional, always together): `"2024-03-05 09:30"` and one of `1m 3m 5m 15m 30m 1h 2h 4h 1d 1w`. Times display exactly as written — no timezone conversion, no session or weekend gaps. Without them the axis shows bar numbers.
- `annotations` (optional), each with optional `label` and `color` (`red green blue orange purple yellow gray`, default blue):
  - `{"type":"hline","price":p,"from":i,"to":j}` — a level; `from`/`to` optional (omitted = to the chart edge). Optional `style`: `solid dashed dotted`.
  - `{"type":"zone","from":i,"to":j,"top":p1,"bottom":p2}` — a box: FVG, order block, range.
  - `{"type":"marker","bar":i,"position":"above"|"below","shape":"arrowUp"|"arrowDown"|"circle"}` — a sweep, BOS/CHoCH, signal bar.
  - `{"type":"trendline","from":[i,p1],"to":[j,p2]}` — optional `style` as for hline.

Candles rise **red** and fall **green** — the learner's convention. Never call a rising candle green.

**The numbers must really form what you say they show.** Work them out before writing: an FVG's gap truly exists between bar i−1's high and bar i+1's low; a sweep truly trades past the level and closes back; a break of structure truly closes beyond the swing. A chart that contradicts its caption teaches something false. One idea per chart; 20–60 bars is usually enough.

Inside tool-argument JSON strings the fence is ordinary text: its newlines become `\n` and its quotes `\"`.

Example — a sell-side sweep, then a bullish FVG that price returns into:

```kline
{"title":"Sweep of sell-side liquidity, then a bullish FVG",
 "candles":[[101,101.4,100.2,100.4],[100.4,100.6,99.8,100],[100,100.5,99.9,100.3],[100.3,100.4,99.4,100.1],
            [100.1,100.9,100,100.8],[100.8,102.2,100.7,102],[102,102.6,101.4,102.4],[102.4,102.5,101.3,101.5]],
 "annotations":[{"type":"hline","price":99.8,"from":2,"to":4,"label":"SSL","style":"dashed"},
                {"type":"marker","bar":4,"position":"below","shape":"arrowUp","label":"Sweep","color":"orange"},
                {"type":"zone","from":5,"to":7,"top":101.4,"bottom":100.9,"label":"FVG","color":"purple"}]}
```
