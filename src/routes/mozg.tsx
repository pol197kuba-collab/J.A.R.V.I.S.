import { createFileRoute } from "@tanstack/react-router";
import { BrainPage } from "@/components/brain/BrainPage";

export const Route = createFileRoute("/mozg")({
  head: () => ({
    meta: [
      { title: "JARVIS // Mózg" },
      {
        name: "description",
        content: "Mapa wiedzy 3D i mapa bazy danych — notatki, wspomnienia, dokumenty i tabele.",
      },
    ],
  }),
  component: BrainPage,
});
