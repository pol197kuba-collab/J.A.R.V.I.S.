// Mózg 3D — strona /mozg: dwa tryby jednej mapy. WIEDZA (gwiazdy z notatek,
// wspomnień i dokumentów) i STRUKTURA (tabele bazy jako planety). Wybór
// trybu zapamiętany w przeglądarce; przejścia między nimi z kart.

import { useState } from "react";
import { BrainView } from "./BrainView";
import { StructureView } from "./StructureView";
import { useBrainKind } from "./hooks";

export function BrainPage() {
  const [kind, setKind] = useBrainKind();
  // Tabela do zaznaczenia po przejściu z karty gwiazdy („Pokaż w STRUKTURZE”).
  const [structureTable, setStructureTable] = useState<string | null>(null);

  return kind === "structure" ? (
    <StructureView kind={kind} onKindChange={setKind} initialTable={structureTable} />
  ) : (
    <BrainView
      kind={kind}
      onKindChange={(k) => {
        setStructureTable(null);
        setKind(k);
      }}
      onShowInStructure={(table) => {
        setStructureTable(table);
        setKind("structure");
      }}
    />
  );
}
