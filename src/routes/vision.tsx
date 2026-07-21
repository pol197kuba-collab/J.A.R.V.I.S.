import { createFileRoute } from "@tanstack/react-router";
import { VisionScanner } from "@/components/jarvis/VisionScanner";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "JARVIS // Vision" },
      { name: "description", content: "Optical sensor feed with HUD scanner overlay." },
      { property: "og:title", content: "JARVIS // Vision" },
      { property: "og:description", content: "Optical sensor feed with HUD scanner overlay." },
    ],
  }),
  component: VisionPage,
});

function VisionPage() {
  return (
    <div className="h-full w-full">
      <VisionScanner />
    </div>
  );
}
