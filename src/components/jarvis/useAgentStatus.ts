import { useEffect, useState } from "react";
import { onSpeaking, isSpeakingNow } from "@/lib/audio/speak";
import { onAgentBusy, isAgentBusyNow } from "@/lib/ai/agentActivity";
import { useVoiceCommands } from "@/components/jarvis/VoiceCommandContext";

export function useAgentStatus() {
  const { listening } = useVoiceCommands();
  const [speaking, setSpeaking] = useState(() => isSpeakingNow());
  const [working, setWorking] = useState(() => isAgentBusyNow());
  useEffect(() => onSpeaking(setSpeaking), []);
  useEffect(() => onAgentBusy(setWorking), []);

  if (speaking) return { label: "Speaking…", color: "var(--primary)" };
  if (working) return { label: "Processing…", color: "var(--primary)" };
  if (listening) return { label: "Listening…", color: "var(--primary)" };
  return { label: "Standby", color: "var(--success)" };
}
