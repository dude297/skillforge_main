// Presentation config: the ONLY place product/domain wording lives. Shared components read terms from here.
// Pick a preset with ?product=<key> (default: neutral). Adding a use case = adding one object.
import { Boxes, ServerCrash, Truck, type LucideIcon } from "lucide-react";

export interface ProductConfig {
  key: string;
  name: string;
  /** hero headline, one entry per line */
  tagline: string[];
  /** what one unit of work is called */
  terms: { task: string; tasks: string; record: string; records: string; fix: string };
  icon: LucideIcon;
  /** names of the two runs in the console's synthetic preview */
  scenario: { first: string; second: string };
  story: {
    problem: string;
    problemDetail: string;
    investigate: string;
    compile: string;
    reuse: string;
    product: string;
  };
}

export const PRODUCTS: Record<string, ProductConfig> = {
  neutral: {
    key: "neutral",
    name: "SkillForge",
    tagline: ["Fix it once with AI.", "Reuse the fix without it."],
    terms: { task: "Investigation", tasks: "Investigations", record: "record", records: "records", fix: "fix" },
    icon: Boxes,
    scenario: { first: "Totals check, batch A", second: "Totals check, batch B" },
    story: {
      problem: "Five records. One total is wrong. Nobody wrote a rule for this.",
      problemDetail: "The line items say 17.40. The record says 18.00. The data never leaves this machine.",
      investigate: "A local model reads the evidence, proposes one bounded fix, and waits. A person approves it. Independent code verifies the result.",
      compile: "The verified fix becomes a skill: a small program, its tests, and a locked version. Hidden tests it never saw decide whether a person may promote it.",
      reuse: "Next week, new data with the same shape. The skill proposes the fix in milliseconds, without the model, under the same approval and verifier. Data that only looks similar is refused, not guessed: the agent takes over.",
      product: "This is the console your team works in.",
    },
  },
  oncall: {
    key: "oncall",
    name: "OnCall",
    tagline: ["Every incident fixed.", "Every fix remembered."],
    terms: { task: "Incident", tasks: "Incidents", record: "service", records: "services", fix: "patch" },
    icon: ServerCrash,
    scenario: { first: "Ledger mismatch after deploy 1.4.2", second: "Ledger mismatch, invoice service" },
    story: {
      problem: "Invoices are off by one cent. The deploy was an hour ago.",
      problemDetail: "Logs, a failing test, and a ledger mismatch, all on this machine.",
      investigate: "A local model reads the logs and the code, proposes a small patch, and waits. A person approves it. Tests and a hidden validator check it.",
      compile: "The fix pattern becomes a skill with its own tests and a locked version, promoted only after hidden tests it never saw pass.",
      reuse: "The same class of failure returns. The skill drafts the fix without the model; a person still approves.",
      product: "This is the console your on-call engineer works in.",
    },
  },
  ops: {
    key: "ops",
    name: "Ledgerline",
    tagline: ["Every discrepancy explained.", "Every fix reusable."],
    terms: { task: "Case", tasks: "Cases", record: "purchase order", records: "purchase orders", fix: "correction" },
    icon: Truck,
    scenario: { first: "Freight accrual, PO-7731", second: "Freight accrual, PO-8810" },
    story: {
      problem: "A carrier invoice and the purchase order disagree. Nobody wrote a rule for this export.",
      problemDetail: "Fixed-width lines, implied cents, a control total. Confidential, so it stays on this machine.",
      investigate: "A local model reads the export and the order, proposes one bounded correction, and waits. A person approves it. Independent code recounts the raw lines.",
      compile: "The verified correction becomes a skill: a small parser, its tests, and a locked version. Hidden tests it never saw decide whether a person may promote it.",
      reuse: "The next invoice from the same carrier is reconciled without the model. A different currency is escalated, not guessed.",
      product: "This is the console your operations team works in.",
    },
  },
};

export function currentProduct(): ProductConfig {
  const key = new URLSearchParams(window.location.search).get("product") ?? "neutral";
  return PRODUCTS[key] ?? PRODUCTS.neutral;
}
