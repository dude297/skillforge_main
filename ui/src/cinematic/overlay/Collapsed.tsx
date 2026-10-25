// What a returning visitor sees instead of the film: the two lines, one honest sentence, Replay, and the three exits.
import { RotateCcw } from "lucide-react";
import { EXITS, HEADLINES, PROVENANCE_LABEL } from "./copy";

export function Collapsed({ onReplay, onNavigate }: { onReplay: () => void; onNavigate: (href: string, e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <div className="forge-collapsed-inner">
      <div className="forge-collapsed-copy">
        <p className="forge-collapsed-title">{HEADLINES.awaken.join(" ")} {HEADLINES.forge.join(" ")}</p>
        <p className="forge-meta">{PROVENANCE_LABEL.illustration}.</p>
      </div>
      <div className="forge-collapsed-actions">
        <button type="button" className="forge-btn" onClick={onReplay}><RotateCcw size={16} aria-hidden="true" />Replay the intro</button>
        {EXITS.map((x) => (
          <a key={x.href} href={x.href} className={`btn ${x.primary ? "btn-primary" : "btn-quiet"}`} onClick={(e) => onNavigate(x.href, e)}>{x.label}</a>
        ))}
      </div>
    </div>
  );
}
