import { useEffect, useState } from "react";

/**
 * Czy warstwa 3D jest włączona (html[data-depth3d], ustawia ją
 * ModuleTransitionLayer). Na serwerze i do pierwszego renderu klienta false —
 * dzięki temu SSR i hydracja się zgadzają.
 */
export function useDepth3d(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setOn(el.hasAttribute("data-depth3d"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-depth3d"] });
    return () => mo.disconnect();
  }, []);
  return on;
}
