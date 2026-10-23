"use client";

// Saves the report as a standalone HTML file (styles inlined from the page), so it opens without the site.
export default function SaveButton({ name }: { name: string }) {
  const save = () => {
    const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
    const body = document.querySelector(".report")?.outerHTML ?? "";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${document.title}</title><style>${css}</style></head><body>${body}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return <button className="btn" type="button" onClick={save}>Download the report</button>;
}
