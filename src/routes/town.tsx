import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TownView } from "@/components/town/TownView";
import { getUiMode, setUiMode } from "@/lib/theme/uiMode";

export const Route = createFileRoute("/town")({
  head: () => ({
    meta: [
      { title: "JARVIS // Agent Town" },
      {
        name: "description",
        content: "Pixel-art office where your agents work on tasks, live from their real activity.",
      },
    ],
  }),
  component: TownPage,
});

function TownPage() {
  // Opening Agent Town (from the menu, a link or the start screen) enters
  // Town mode, so the whole app wears the Town theme around it.
  useEffect(() => {
    if (getUiMode() !== "town") setUiMode("town");
  }, []);
  return <TownView />;
}
