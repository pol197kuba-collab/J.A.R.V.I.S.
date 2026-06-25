import { useEffect, useState } from "react";
import { audio } from "./AudioEngine";

export function useAudioSettings() {
  const [s, setS] = useState(audio.settings);
  useEffect(() => audio.subscribe(setS), []);
  return {
    settings: s,
    set: (patch: Partial<typeof s>) => audio.setSettings(patch),
  };
}