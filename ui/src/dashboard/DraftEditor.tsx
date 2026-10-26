import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";

export default function DraftEditor({ text, createdAt, title = "Task draft", onSave, onClose }: { text: string; createdAt: string; title?: string; onSave: (text: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(text);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => { el?.close(); };
  }, []);
  return <dialog className="ed-draft-dialog" ref={dialog} onCancel={onClose} aria-labelledby="draft-editor-title">
    <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSave(value.trim()); }}>
      <div className="ed-draft-dialog-heading"><span className="ed-row-icon"><FileText size={18} /></span><div><h2 id="draft-editor-title">{title}</h2><p>Created {new Date(createdAt).toLocaleString()}</p></div><button className="ed-icon-button" type="button" onClick={onClose} aria-label="Close draft"><X size={18} /></button></div>
      <label htmlFor="draft-editor-text">What do you want Ember to do?</label>
      <textarea autoFocus id="draft-editor-text" value={value} onChange={(e) => setValue(e.target.value)} maxLength={3000} rows={6} />
      <p className="ed-draft-dialog-note">Saved on this browser. This draft has not been submitted to the local engine.</p>
      <div className="ed-draft-dialog-actions"><button className="ed-button ed-button-subtle" type="button" onClick={onClose}>Cancel</button><button className="ed-button ed-button-primary" type="submit" disabled={!value.trim()}>Save changes</button></div>
    </form>
  </dialog>;
}
