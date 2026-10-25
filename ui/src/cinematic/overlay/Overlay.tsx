// DOM typography over the canvas. Pure markup: every reveal is a clip-path driven by CSS variables the driver writes
// (driver.ts), so nothing here re-renders per frame. Colour carries meaning only through `visual`.
import type { CSSProperties } from "react";
import type { CineVisual } from "../contract";
import { ENTER_TITLE, EXITS, HEADLINES, NOTES, PROVENANCE_LABEL } from "./copy";

const v = (name: string): CSSProperties => ({ ["--in" as string]: `var(${name}, 0)` });

/** A display line that is revealed by a wipe with a hairline leading edge: the trace, drawn left to right. */
function Head({ id, lines }: { id: "a" | "d"; lines: readonly string[] }) {
  return (
    <p className="forge-head" aria-hidden="true">
      {lines.map((line, i) => (
        <span key={line} className="forge-line" style={{ ...v(`--${id}${i + 1}-in`), ["--out" as string]: `var(--${id}-out, 0)` } as CSSProperties}>
          {line}
          <i className="forge-edge" />
        </span>
      ))}
    </p>
  );
}

export function Provenance({ visual }: { visual: CineVisual }) {
  return (
    <p className="forge-provenance" data-provenance={visual.provenance}>
      <span className="forge-provenance-mark" aria-hidden="true" />
      {PROVENANCE_LABEL[visual.provenance]}
    </p>
  );
}

export function Words({ visual }: { visual: CineVisual }) {
  const beat = visual.beat;
  const note = NOTES[beat];
  const cap = visual.caption;
  const spoken = beat === "awaken" ? HEADLINES.awaken.join(" ") : beat === "forge" && !cap ? HEADLINES.forge.join(" ") : beat === "enter" ? ENTER_TITLE : cap ? `${cap.title}. ${cap.detail}` : "";
  return (
    <>
      <div className="forge-text" aria-hidden="true">
        <div className="forge-heads">
          <Head id="a" lines={HEADLINES.awaken} />
          <Head id="d" lines={HEADLINES.forge} />
        </div>
        {cap && beat !== "enter" ? (
          <div className="forge-caption">
            <p className="forge-cap-title">{cap.title}</p>
            <p className="forge-cap-detail">{cap.detail}</p>
          </div>
        ) : null}
        {note ? <p className="forge-note" data-waiting={visual.review === "waiting" ? "true" : undefined}>{note}</p> : null}
      </div>
      <p className="forge-sr" role="status">{spoken}{note ? ` ${note}` : ""}</p>
    </>
  );
}

/** The last act: the camera has become the product's own top-down view; three real routes lead in. */
export function Exits({ onNavigate }: { onNavigate: (href: string, e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <div className="forge-enter">
      <p className="forge-enter-title" style={v("--en-title")}>{ENTER_TITLE}</p>
      <nav className="forge-exits" aria-label="Where to next">
        {EXITS.map((x, i) => (
          <a key={x.href} href={x.href} className={`btn forge-exit ${x.primary ? "btn-primary" : "btn-quiet"}`} style={v(`--en-${i + 1}`)} onClick={(e) => onNavigate(x.href, e)}>{x.label}</a>
        ))}
      </nav>
    </div>
  );
}
