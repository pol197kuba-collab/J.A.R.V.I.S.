import { createFileRoute } from "@tanstack/react-router";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { CommandDirectory } from "@/components/jarvis/CommandDirectory";
import { CommandPlayground } from "@/components/jarvis/CommandPlayground";

export const Route = createFileRoute("/commands")({
  head: () => ({
    meta: [
      { title: "JARVIS // Commands" },
      {
        name: "description",
        content:
          "Every voice and text navigation command JARVIS understands, plus a live playground to test them.",
      },
    ],
  }),
  component: CommandsModule,
});

function CommandsModule() {
  return (
    <div className="space-y-6 p-6">
      <CommandDirectory index={0} />
      <HudPanel index={1} title="COMMAND PLAYGROUND" className="p-0">
        <CommandPlayground />
      </HudPanel>
    </div>
  );
}
