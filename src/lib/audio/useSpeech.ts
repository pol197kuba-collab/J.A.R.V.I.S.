// Stan głosu J.A.R.V.I.S.-a dla komponentów: czy właśnie mówi i czy jest
// wyciszony (oba zmieniają się zdarzeniami z speak.ts).

import { useEffect, useState } from "react";
import { isSpeakingNow, isVoiceMuted, onSpeaking, onVoiceMuted } from "./speak";

export function useSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSpeaking(isSpeakingNow());
    return onSpeaking(setSpeaking);
  }, []);
  return speaking;
}

export function useVoiceMuted(): boolean {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(isVoiceMuted());
    return onVoiceMuted(setMuted);
  }, []);
  return muted;
}
