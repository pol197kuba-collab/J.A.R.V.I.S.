import { useEffect, useState } from "react";
import { audio } from "./AudioEngine";

export function useAudioSettings() {
  const [s, setS] = useState(audio.settings);
  useEffect(() => {
    const unsub = audio.subscribe(setS);
    return () => {
      unsub();
    };
  }, []);
  return {
    settings: s,
    set: (patch: Partial<typeof s>) => audio.setSettings(patch),
  };
}