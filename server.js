const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const alerts = [];

// TradingView sends alerts here
app.post("/webhook", async (req, res) => {
  console.log("Alert received:", req.body);

  const payload = req.body;
  const ticker = payload.ticker || payload.symbol || "UNKNOWN";
  const price = payload.price || payload.close || "N/A";
  const indicator = payload.indicator || payload.strategy || "Alert";
  const timeframe = payload.timeframe || payload.interval || "N/A";
  const message = payload.message || payload.alert_message || "";

  const alert = {
    id: Date.now(),
    ticker,
    price,
    indicator,
    timeframe,
    message,
    time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    status: "analyzing",
    analysis: null,
  };

  alerts.unshift(alert);
  if (alerts.length > 50) alerts.pop();

  res.json({ received: true, id: alert.id });

  // Run Claude analysis in background
  try {
    const analysis = await analyzeWithClaude(ticker, price, indicator, timeframe, message);
    alert.analysis = analysis;
    alert.status = "done";
  } catch (e) {
    alert.status = "error";
    alert.error = e.message;
    console.error("Claude error:", e.message);
  }
});

// Dashboard polls this for live updates
app.get("/alerts", (req, res) => {
  res.json(alerts);
});

// Health check
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

async function analyzeWithClaude(ticker, price, indicator, timeframe, message) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const dateShort = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const prompt = [
    "TODAY IS " + today + ".",
    "",
    "A TradingView alert just fired with this data:",
    "- Ticker: " + ticker,
    "- Price at alert: $" + price,
    "- Indicator/Strategy: " + indicator,
    "- Timeframe: " + timeframe,
    (message ? "- Alert message: " + message : ""),
    "",
    "Use web_search to find:",
    '1. "' + ticker + ' stock price today ' + dateShort + '" - confirm live price',
    '2. "' + ticker + ' technical analysis RSI MACD 2026"',
    '3. "' + ticker + ' options implied volatility earnings 2026"',
    "",
    "Then give a complete options trade analysis. Output ONLY raw JSON:",
    "{",
    '  "ticker": "' + ticker + '",',
    '  "alertPrice": "$' + price + '",',
    '  "currentPrice": "live price found",',
    '  "directionalBias": "Bullish or Bearish or Neutral",',
    '  "confidence": 0-100,',
    '  "biasReason": "why, referencing real data",',
    '  "strongSupport": "$X",',
    '  "support": "$X",',
    '  "resistance": "$X",',
    '  "strongResistance": "$X",',
    '  "priceTarget": "$X by timeframe",',
    '  "signals": [{"indicator":"name","signal":"Bullish/Bearish/Neutral","detail":"value"}],',
    '  "strategyType": "e.g. Long Call",',
    '  "strikes": "specific strikes",',
    '  "expiration": "specific date",',
    '  "estimatedCost": "$X per contract",',
    '  "maxProfit": "$X",',
    '  "maxLoss": "$X",',
    '  "breakeven": "$X",',
    '  "probabilityOfProfit": "~X%",',
    '  "entryCondition": "specific entry with price levels",',
    '  "profitTarget": "specific % or $ exit",',
    '  "stopLoss": "specific stop",',
    '  "riskWarnings": ["warning1", "warning2"],',
    '  "tradeGrade": "A or B or C or D",',
    '  "tradeVerdict": "TAKE THE TRADE or SKIP THIS TRADE or WAIT FOR BETTER ENTRY",',
    '  "verdictReason": "blunt 3-5 sentence honest assessment"',
    "}",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error("Claude API " + resp.status + ": " + text.slice(0, 200));

  const env = JSON.parse(text);
  const textBlocks = (env.content || []).filter(b => b.type === "text");
  if (!textBlocks.length) throw new Error("No response from Claude");

  let raw = textBlocks[textBlocks.length - 1].text.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("No JSON in response");

  return JSON.parse(raw.slice(a, b + 1).replace(/,(\s*[}\]])/g, "$1"));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Oracle webhook server running on port " + PORT));
