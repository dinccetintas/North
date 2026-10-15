"use client";

import { useEffect, useState } from "react";

const FRAMES = ["|", "/", "-", "\\"] as const;
const FRAME_MS = 120;

/** The design system's spinner: four ASCII frames; a still ellipsis when the user prefers reduced motion. */
export function AsciiSpinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(reduced.matches);
    update();
    reduced.addEventListener("change", update);
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => {
      clearInterval(id);
      reduced.removeEventListener("change", update);
    };
  }, []);

  return (
    <span className="mono-label inline-flex items-center gap-2" aria-live="polite">
      <span aria-hidden className="inline-block w-[1ch] text-deep">
        {still ? "…" : FRAMES[frame]}
      </span>
      <span>{label}</span>
    </span>
  );
}
