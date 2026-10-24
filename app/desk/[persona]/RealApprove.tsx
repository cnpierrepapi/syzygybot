"use client";
// The Approve button on a desk its owner verified: approving sends a real email or letter in the desk's name, so it asks
// first, unless the owner ticked "Don't show this message again" (kept in this browser).
import { useRef, useState } from "react";

const SKIP = "syz_real_ok";

export default function RealApprove({ channel, org, sender, disabled, title }: { channel: "email" | "letter"; org: string; sender: string; disabled?: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const send = () => {
    if (skip) try { localStorage.setItem(SKIP, "1"); } catch { /* private mode */ }
    setOpen(false);
    btn.current?.form?.requestSubmit();
  };
  return (
    <>
      <button ref={btn} className="btn" type="button" disabled={disabled} title={title}
        onClick={() => { let ok = false; try { ok = localStorage.getItem(SKIP) === "1"; } catch { /* private mode */ } if (ok) btn.current?.form?.requestSubmit(); else setOpen(true); }}>
        Approve and send
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="real-approve-h" className="real-modal-back" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="panel real-modal">
            <h3 id="real-approve-h" style={{ margin: "0 0 8px" }}>This sends a real {channel}</h3>
            <p style={{ margin: "0 0 10px" }}>
              {channel === "email"
                ? <>A real email goes to {org}, in your name as {sender}. It leaves in their next sending window, and once it&apos;s out it can&apos;t be unsent.</>
                : <>A real letter goes to {org}, in your name as {sender}. It&apos;s printed and posted within two business days, and once it&apos;s printed it can&apos;t be stopped.</>}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, margin: "0 0 14px" }}>
              <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> Don&apos;t show this message again
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn quiet" type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn" type="button" onClick={send} autoFocus>Send it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
