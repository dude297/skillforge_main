import { useState } from "react";
import { Copy, Check } from "lucide-react";

/** A host command to run by hand, with a Copy button that reports what actually happened. */
export function CopyCommand({ label, cmd }: { label?: string; cmd: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    if (!navigator.clipboard) return setState("failed");
    navigator.clipboard.writeText(cmd).then(() => setState("copied"), () => setState("failed"));
  };
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      {label ? <p className="mb-2 text-meta text-text-3">{label}</p> : null}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 font-mono text-[0.8125rem] [overflow-wrap:anywhere] text-text">{cmd}</code>
        <button type="button" className="btn btn-quiet h-8 shrink-0 px-2.5 text-meta" onClick={copy}>
          {state === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed: select the text" : "Copy"}
          <span className="sr-only"> command</span>
        </button>
      </div>
    </div>
  );
}
