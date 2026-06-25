import { useEffect } from "react";

export function CrtShutdown({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 720);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black">
      <div
        className="crt-frame h-full w-full"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in oklab, var(--primary) 35%, transparent), transparent 60%), #000",
          animation: "crt-off 0.7s cubic-bezier(.6,.05,.2,1) forwards",
        }}
      />
    </div>
  );
}