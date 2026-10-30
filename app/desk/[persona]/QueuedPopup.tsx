"use client";
// Shown once after approving a real email that's now waiting for its sending window. The cookie goes when it's closed, so a
// reload doesn't bring it back; the board's refreshes during a run leave it open.
import { useState } from "react";

export default function QueuedPopup({ org, did }: { org: string; did: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const close = () => {
    document.cookie = "syz_desk_queued=; path=/desk; max-age=0; secure; samesite=lax";
    setOpen(false);
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="queued-h" className="real-modal-back" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="panel real-modal">
        <h3 id="queued-h" style={{ margin: "0 0 8px" }}>Your email to {org} is queued</h3>
        <p style={{ margin: "0 0 10px" }}>{did}</p>
        <p style={{ margin: "0 0 14px", color: "var(--dim)", fontSize: 13.5 }}>It hasn&apos;t left yet. Changed your mind? Undo on the card takes it back before then.</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={close} autoFocus>Got it</button>
        </div>
      </div>
    </div>
  );
}
