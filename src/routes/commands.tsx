import { createFileRoute } from "@tanstack/react-router";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { CommandDirectory } from "@/components/jarvis/CommandDirectory";
import { CommandPlayground } from "@/components/jarvis/CommandPlayground";
import { Phrasebook } from "@/components/jarvis/orders/Phrasebook";

export const Route = createFileRoute("/commands")({
  head: () => ({
    meta: [
      { title: "JARVIS // Commands" },
      {
        name: "description",
        content:
          "Every voice and text navigation command JARVIS understands, a phrasebook of things you can ask him, and a live playground to test them.",
      },
    ],
  }),
  component: CommandsModule,
});

function CommandsModule() {
  return (
    <div className="space-y-6 p-6">
      <CommandDirectory index={0} />

      {/* Rozmówki NAD playgroundem: kliknięty przykład ląduje w logu poniżej,
          więc kolejność na stronie odpowiada kolejności zdarzeń. */}
      <HudPanel index={1} title="ROZMÓWKI // CO MOŻNA POWIEDZIEĆ" className="p-0">
        <Phrasebook />
      </HudPanel>

      <HudPanel index={2} title="COMMAND PLAYGROUND" className="p-0">
        <CommandPlayground />
      </HudPanel>
    </div>
  );
}
