// Single list of routes every preview QA tool visits (e2e-preview, a11y-sweep, check-csp).
// Superset of scripts/lab-tour.mjs: the same 12 routes plus the console incident view and the dev-only world lab,
// because both are reachable in a built bundle and a judge can type the URL.
export const ROUTES = [
  { name: "story", hash: "#/" },
  { name: "onboard", hash: "#/world/onboard" },
  { name: "bootstrap", hash: "#/world/bootstrap" },
  { name: "world", hash: "#/world" },
  { name: "moonshot", hash: "#/world/moonshot" },
  { name: "world-lab", hash: "#/world/lab" },
  { name: "console-investigations", hash: "#/console/investigations" },
  { name: "console-incident", hash: "#/console/investigations/incident" },
  { name: "console-overview", hash: "#/console/overview" },
  { name: "console-skills", hash: "#/console/skills" },
  { name: "console-history", hash: "#/console/history" },
  { name: "console-benchmarks", hash: "#/console/benchmarks" },
  { name: "console-system", hash: "#/console/system" },
  { name: "demo", hash: "#/demo" },
  { name: "pitch", hash: "#/demo/pitch" },
];

export const SIZES = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "phone", width: 390, height: 844 },
];

/** Controls that on a real system would change state. In the hosted preview none may reach the network. */
export const MUTATING_NAME = /approve|promote|execute|reject|rollback/i;
