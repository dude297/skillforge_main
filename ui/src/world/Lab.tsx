import { Mascot } from "./Mascot";
import { STATES, type MascotState } from "./sprites";

export function Lab() {
  return (
    <main id="main" tabIndex={-1} className="space-y-8 p-8">
      {(["#0B1018", "#EEF4FB"] as const).map((bg) => (
        <div key={bg} className="flex flex-wrap gap-6 rounded-xl p-6" style={{ background: bg }}>
          {(Object.keys(STATES) as MascotState[]).map((s) => (
            <figure key={s} className="text-center text-meta" style={{ color: bg === "#EEF4FB" ? "#14203A" : "#9CADBA" }}>
              <Mascot state={s} px={6} /><figcaption>{STATES[s].label}</figcaption>
            </figure>
          ))}
        </div>
      ))}
    </main>
  );
}
