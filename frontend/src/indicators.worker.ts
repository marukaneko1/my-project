/// <reference lib="webworker" />

export type InBar = { time: number; open: number; high: number; low: number; close: number; volume?: number };

export type IndicatorRequest =
  | { type: "warmup" }
  | {
      type: "compute";
      payload: {
        bars: InBar[]; // newest last
        indicators: Array<
          | { kind: "SMA"; period: number; source?: "close" | "open" | "hl2" | "hlc3" }
          | { kind: "EMA"; period: number; source?: "close" | "open" | "hl2" | "hlc3" }
          | { kind: "RSI"; period: number; source?: "close" | "open" }
        >;
      };
    };

export type IndicatorResponse =
  | { ok: true; results: Record<string, Array<number | null>> }
  | { ok: false; error: string };

self.onmessage = (ev: MessageEvent<IndicatorRequest>) => {
  try {
    if (ev.data.type === "warmup") {
      (self as any).postMessage({ ok: true, results: {} } as IndicatorResponse);
      return;
    }

    if (ev.data.type === "compute") {
      const { bars, indicators } = ev.data.payload;
      const results: Record<string, Array<number | null>> = {};

      const pick = (src?: string) =>
        bars.map(b =>
          src === "open" ? b.open :
          src === "hl2"  ? (b.high + b.low) / 2 :
          src === "hlc3" ? (b.high + b.low + b.close) / 3 :
                           b.close
        );

      for (const ind of indicators) {
        const src = (ind as any).source ?? "close";
        const series = pick(src);

        if (ind.kind === "SMA") {
          results[`SMA(${ind.period},${src})`] = sma(series, ind.period);
        } else if (ind.kind === "EMA") {
          results[`EMA(${ind.period},${src})`] = ema(series, ind.period);
        } else if (ind.kind === "RSI") {
          results[`RSI(${ind.period},${src})`] = rsi(series, ind.period);
        }
      }

      (self as any).postMessage({ ok: true, results } as IndicatorResponse);
      return;
    }

    (self as any).postMessage({ ok: false, error: "unknown message" } as IndicatorResponse);
  } catch (e: any) {
    (self as any).postMessage({ ok: false, error: e?.message ?? String(e) } as IndicatorResponse);
  }
};

// --- indicator math (nulls for warmup) ---
function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(period - 1).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out.slice(0, values.length);
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[i - j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + (prev as number) * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;

    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      // Wilder’s smoothing
      const prev = out[i - 1] != null ? out[i - 1] : null; // not used directly; recompute from avgs
      // We need running avgs; derive from previous avgs using prices:
      // Maintain avgs implicitly using sums:
      // To avoid tracking, recompute prev avgs from last (i-1) window (cheap for small period)
      let g = 0, l = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const ch2 = values[j] - values[j - 1];
        g += ch2 > 0 ? ch2 : 0;
        l += ch2 < 0 ? -ch2 : 0;
      }
      const avgGain = g / period;
      const avgLoss = l / period;
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }

  // Ensure first (period-1) are null
  for (let i = 0; i < period; i++) out[i] = null;
  return out;
}

export {};