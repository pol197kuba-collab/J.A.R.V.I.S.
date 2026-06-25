import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SUB_SYSTEMS, type SubSystemId } from "@/data/subSystems";
import { SubSystemGrid } from "@/components/jarvis/subsystems/SubSystemGrid";
import { ModuleLoader } from "@/components/jarvis/subsystems/ModuleLoader";
import { ModuleFrame } from "@/components/jarvis/subsystems/ModuleFrame";
import { CrtShutdown } from "@/components/jarvis/subsystems/CrtShutdown";

export const Route = createFileRoute("/sub-systems")({
  head: () => ({
    meta: [
      { title: "JARVIS // Sub-Systems" },
      { name: "description", content: "Stark sub-systems portal — secure containerised access to external modules." },
      { property: "og:title", content: "JARVIS // Sub-Systems" },
      { property: "og:description", content: "Stark sub-systems portal — secure containerised access to external modules." },
    ],
  }),
  component: SubSystemsPage,
});

type PortalState = "grid" | "loading" | "active" | "terminating";

function SubSystemsPage() {
  const [state, setState] = useState<PortalState>("grid");
  const [activeId, setActiveId] = useState<SubSystemId | null>(null);
  const mod = SUB_SYSTEMS.find((m) => m.id === activeId) ?? null;

  return (
    <div className="relative h-full min-h-[calc(100vh-3rem)]">
      {(state === "grid" || state === "loading") && (
        <div
          className={
            "transition-opacity duration-300" +
            (state === "loading" ? " pointer-events-none opacity-30 blur-[1px]" : "")
          }
        >
          <SubSystemGrid
            disabled={state !== "grid"}
            onInitialize={(id) => {
              setActiveId(id);
              setState("loading");
            }}
          />
        </div>
      )}

      {state === "loading" && mod && (
        <ModuleLoader mod={mod} onReady={() => setState("active")} />
      )}

      {(state === "active" || state === "terminating") && mod && (
        <ModuleFrame mod={mod} onTerminate={() => setState("terminating")} />
      )}

      {state === "terminating" && (
        <CrtShutdown
          onDone={() => {
            setActiveId(null);
            setState("grid");
          }}
        />
      )}
    </div>
  );
}