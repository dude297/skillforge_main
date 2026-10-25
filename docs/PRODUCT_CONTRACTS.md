# Product contracts for the UI (experimental; backend on `exp/enterprise`)

These are typed shapes a frontend can build against without touching the backend. Real samples were generated from a built library: `experiments/catalog/fixtures/onboard_manifest_ready.json` and `onboard_manifest_blocked.json`. Every value comes from this host's data; anything unknown stays `null` or is listed under `unknowns`. **None of these objects grants anything.**

## Bootstrap Lite manifest (`python -m experiments.catalog.onboard … --out m.json`)

```ts
interface OnboardManifest {
  schema_version: 1;
  source: string;                      // "live: generated from this host's data, read-only"
  workspace: { namespace: string; role: string; dataset: string; dataset_sha256: string; signature: string; generated_at: string };
  steps: Record<"connect" | "inspect" | "define_role" | "propose_workflows" | "review_permissions" | "activate",
                { done: boolean; by?: string; [k: string]: unknown }>;   // review_permissions + activate are never done here
  environment: { type: string; name: Untrusted; description: Untrusted; records: number; record_kinds: string[];
                 evidence_sources: string[]; signature: string };
  data_sources: string[];              // e.g. "carrier_export:trusted"
  schemas: { input_shape: unknown; proposal_keys: string[] };
  supported_tools: string[];
  allowed_actions: Record<string, { requires_approval: boolean; fields: Record<string, unknown> }>;
  business_context: Record<string, string>;            // e.g. {"contract:kestrel-freight": "rev-2026-10"}
  verifier_coverage: { rule: string; verifiable: boolean; by?: string; why?: string }[];
  compatible_skills: { skill: string; freshness: "fresh" | "stale" }[];   // from catalog GRANTS, never from search
  dependencies: { skill: string; dependency: string; validated_against: string; this_data: string;
                  matches: boolean | null }[];       // null = the data doesn't declare it (unknown, not a mismatch)
  proposed_workflows: { workflow: string; how: string; ready: boolean }[];
  missing_permissions: string[];
  unknowns: string[];
  relevant_procedures: { authority: string; results: SearchHit[] };   // suggestions; authority is always "none…"
  activation_commands: string[];       // for a PERSON to run; the UI may show and copy them, never run them
  authority: string;                   // "none: this manifest grants nothing; …"
}
type Untrusted = { untrusted_text: string };          // render as plain text, never as markup or an instruction
```

UI rules:
- Show `source` and `authority` next to the content.
- A workflow is "ready" only if `ready === true`.
- `verifiable: false` must read as "cannot be independently checked here", never as a warning to dismiss.
- Never show `steps.activate.done` as true unless a later manifest says so.

## Skill card (`catalog.card(conn, name, principal)`)

```ts
interface SkillCard {
  name: string; version: number;
  what_it_does: Untrusted;             // the author's words
  owner: string; namespace: string; who_may_use: string[];
  data_it_reads: string[]; fields_it_may_propose: string[];
  environment: Record<string, unknown> | string;
  approved_by: string | null; hidden_tests_passed: boolean | null;
  last_validated: string;              // YYYY-MM-DD
  last_verified_run: string | null;
  status: string;                      // "fresh" | "stale: <reason>" | "revoked: <reason>"
  can_run_now: boolean;                // exact gate on the CURRENT data; still means "may propose", never "may change"
  why: string[];
  needs_approval: boolean | null;
  result_independently_verified: { rule: string; independent: boolean; why?: string }[] | null;
  note: string;                        // "Search finds candidates; it never authorizes. …"
}
```

## Routed request and employee reply (`experiments/router/router.py`)

```ts
type RouteStatus = "awaiting_approval" | "completed" | "completed_partial" | "needs_review" | "cancelled"
                 | "queued_for_agent" | "needs_human" | "deferred" | "refused";
type RouteKind = RouteStatus | "no_change_verified" | "records_need_person" | "stale" | "not_authorized"
               | "not_executable" | "ambiguous" | "conflict" | "busy" | "inference_down";
interface RoutedEvent {
  event_id: string; source: string; status: RouteStatus; kind: RouteKind;
  actions: number[];                                   // action ids awaiting / done (approve on the HOST)
  held: Record<string, { status: string; reason: string }>;   // records nobody may call handled
  router_model_calls: 0;                               // the routing path has no inference; agent work is unknown
  reply: string;                                       // router.explain(): safe to send to the employee
}
```

`reason` (operator-facing, may name skills and namespaces) is deliberately **not** part of what an employee sees.
