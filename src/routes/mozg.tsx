import { createFileRoute } from "@tanstack/react-router";
import { BrainView } from "@/components/brain/BrainView";

export const Route = createFileRoute("/mozg")({
  head: () => ({
    meta: [
      { title: "JARVIS // Mózg" },
      {
        name: "description",
        content: "Mapa wiedzy 3D — notatki, wspomnienia i dokumenty jako gromady tematów.",
      },
    ],
  }),
  component: BrainView,
});
