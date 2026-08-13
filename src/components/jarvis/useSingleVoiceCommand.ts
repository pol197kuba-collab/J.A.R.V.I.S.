import { useCallback, useRef, useState } from "react";
import { getSpeechCtor, type AnySpeechRecognition } from "./VoiceCommandContext";

// One-shot dictation for a chat mic button: capture exactly ONE spoken
// utterance and resolve with its transcript, then stop — deliberately NOT
// VoiceCommandContext's always-on wake-word listener (that toggle is global
// and continuous; this is a local "press to say one thing" action). Reuses
// the same SpeechRecognition constructor lookup so browser-support detection
// isn't duplicated between the two.
export type SingleVoiceCommand = {
  supported: boolean;
  listening: boolean;
  /** Starts a single recognition pass. Resolves with the transcript once the
   *  browser reports a final result, or null if nothing usable was heard,
   *  the browser doesn't support speech recognition, a capture is already
   *  in progress, or the pass errored/ended with no result. */
  capture: () => Promise<string | null>;
};

export function useSingleVoiceCommand(): SingleVoiceCommand {
  const Ctor = getSpeechCtor();
  const [listening, setListening] = useState(false);
  const recRef = useRef<AnySpeechRecognition | null>(null);

  const capture = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!Ctor || recRef.current) {
        resolve(null);
        return;
      }
      const rec = new Ctor();
      recRef.current = rec;
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "pl-PL";
      let settled = false;
      const finish = (text: string | null) => {
        if (settled) return;
        settled = true;
        setListening(false);
        recRef.current = null;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
        resolve(text);
      };
      rec.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        const text = last?.[0]?.transcript ?? "";
        finish(text.trim() || null);
      };
      rec.onerror = () => finish(null);
      rec.onend = () => finish(null);
      try {
        rec.start();
        setListening(true);
      } catch {
        finish(null);
      }
    });
  }, [Ctor]);

  return { supported: !!Ctor, listening, capture };
}
