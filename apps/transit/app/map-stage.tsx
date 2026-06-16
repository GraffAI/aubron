"use client";

import dynamic from "next/dynamic";

// deck.gl needs WebGL + window, so it must never render on the server.
const TransitDeck = dynamic(() => import("./deck").then((m) => m.TransitDeck), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-white/30">…</div>,
});

export function MapStage() {
  return (
    <main className="fixed inset-0 overflow-hidden">
      <TransitDeck />
      <Hud />
    </main>
  );
}

function Hud() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <header className="absolute left-5 top-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/70">
          Puget Sound
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-cyan-300/50">
          transit · live
        </div>
      </header>
    </div>
  );
}
