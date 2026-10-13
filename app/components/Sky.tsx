"use client";

// Loads the constellation only in the browser, after the page itself has rendered.
import dynamic from "next/dynamic";
import { useEffect } from "react";

const Constellation = dynamic(() => import("./Constellation"), { ssr: false });

export default function Sky() {
  return <Constellation />;
}

/** Pages call this with the stars they're about; the camera eases toward them and the rest of the sky dims. */
export function FocusStars({ stars }: { stars: string[] }) {
  useEffect(() => {
    (window as unknown as { __syzygyFocus?: string[] }).__syzygyFocus = stars;
    dispatchEvent(new CustomEvent("syzygy:focus", { detail: { stars } }));
    return () => { (window as unknown as { __syzygyFocus?: string[] }).__syzygyFocus = []; dispatchEvent(new CustomEvent("syzygy:focus", { detail: { stars: [] } })); };
  }, [stars.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
