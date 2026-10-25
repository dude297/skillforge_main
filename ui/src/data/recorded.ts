// RECORDED: a real benchmark result file (python -m app bench --out <dir> -> result.json) loaded by the operator.
// Numbers are shown exactly as measured; null stays "not measured". Mock runs are labelled as mock.
import type { BenchRow, Compare } from "./types";

export interface Recorded {
  fileName: string;
  realModel: boolean;
  agent: string;
  trials: number;
  rows: BenchRow[];
  compare: Compare | null;
  breakevenC: string | null;
}

type Summary = { case: string; mode: "A" | "B" | "C"; n: number; correct: string; decision: string;
  median_s: number | null; model_calls: number | null; tool_calls: number | null };

export function parseBenchResult(fileName: string, text: string): Recorded {
  const j = JSON.parse(text) as { real_model?: boolean; agent?: string; trials?: number; summary?: Summary[];
    breakeven_C?: { model_calls?: { n_star?: string | number } } };
  if (!Array.isArray(j.summary)) throw new Error("not a bench result.json (no 'summary' array)");
  const rows: BenchRow[] = j.summary.map((r) => ({
    case: r.case, mode: r.mode, n: r.n, correct: r.correct, decision: r.decision,
    median_s: r.median_s ?? null, model_calls: r.model_calls ?? null, tool_calls: r.tool_calls ?? null,
  }));
  // "Same task, before and after": A and C must come from the SAME case (prefer unseen_compatible)
  const cases = [...new Set(rows.map((r) => r.case))].sort((x, y) => Number(y === "unseen_compatible") - Number(x === "unseen_compatible"));
  const both = cases.find((k) => rows.some((r) => r.case === k && r.mode === "A") && rows.some((r) => r.case === k && r.mode === "C"));
  const a = rows.find((r) => r.case === both && r.mode === "A"), c = rows.find((r) => r.case === both && r.mode === "C");
  const real = j.real_model === true;
  return {
    fileName, realModel: real, agent: j.agent ?? "unknown", trials: j.trials ?? 0, rows,
    breakevenC: j.breakeven_C?.model_calls?.n_star != null ? String(j.breakeven_C.model_calls.n_star) : null,
    compare: a && c ? {
      source: "recorded",
      label: real ? `Measured on this system: ${a.case}, ${fileName}, median of ${a.n} (agent) and ${c.n} (skill) trials`
        : `Recorded MOCK run (${fileName}, ${a.case}): plumbing only, no model involved`,
      rows: [
        { mode: "A", title: "Agent with model", model_calls: a.model_calls, seconds: a.median_s, tool_calls: a.tool_calls },
        { mode: "C", title: "Learned skill", model_calls: c.model_calls, seconds: c.median_s, tool_calls: c.tool_calls },
      ],
    } : null,
  };
}
