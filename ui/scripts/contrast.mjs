// WCAG 2.x contrast for the design tokens (run: node scripts/contrast.mjs)
const hex = (h) => h.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const lum = (h) => { const [r, g, b] = hex(h.slice(1)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const bg = { canvas: "#080C12", surface: "#121A24", surface2: "#18222E" };
const fg = { text: "#F3F7FC", text2: "#9CADBA", text3: "#8193A0", signal: "#82D8FF", verified: "#65E9B7", warn: "#F1AD64", fail: "#FF8A94" };
let ok = true;
for (const [n, f] of Object.entries(fg)) {
  const row = Object.entries(bg).map(([bn, b]) => { const r = ratio(f, b); if (r < 4.5) ok = false; return `${bn} ${r.toFixed(1)}`; });
  console.log(n.padEnd(9), row.join("  "));
}
console.log(ok ? "PASS all >= 4.5:1" : "FAIL some < 4.5:1");
process.exit(ok ? 0 : 1);
