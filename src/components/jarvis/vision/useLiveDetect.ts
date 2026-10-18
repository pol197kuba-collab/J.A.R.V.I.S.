// Vision AR (S4.3) — live mode loop: every LIVE_INTERVAL_MS take a small
// frame, skip it if the picture hasn't changed, otherwise ask the model for
// boxes. Stops itself after LIVE_MAX_MS, when the tab is hidden and on
// unmount — every frame sent is a paid call on the user's key.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useServerFn } from "@tanstack/react-start";
import { detectObjects } from "@/lib/vision/live.functions";
import {
  DIFF_SIDE,
  DIFF_THRESHOLD,
  LIVE_FRAME_SIDE,
  LIVE_INTERVAL_MS,
  LIVE_MAX_MS,
  frameDiff,
  toGrey,
  type Detection,
} from "@/lib/vision/live";

export type LiveState = {
  live: boolean;
  detections: Detection[];
  /** Size of the camera frame the boxes refer to. */
  frame: { w: number; h: number } | null;
  secondsLeft: number;
  calls: number;
  skipped: number;
  error: string | null;
  start: () => void;
  stop: () => void;
};

export function useLiveDetect(videoRef: RefObject<HTMLVideoElement | null>): LiveState {
  const detect = useServerFn(detectObjects);
  const [live, setLive] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [calls, setCalls] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const lastGrey = useRef<Uint8Array | null>(null);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    setLive(false);
    setDetections([]);
    lastGrey.current = null;
  }, []);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    lastGrey.current = null;
    setCalls(0);
    setSkipped(0);
    setError(null);
    setSecondsLeft(Math.round(LIVE_MAX_MS / 1000));
    setLive(true);
  }, []);

  const tick = useCallback(async () => {
    const left = LIVE_MAX_MS - (Date.now() - startedAt.current);
    setSecondsLeft(Math.max(0, Math.ceil(left / 1000)));
    if (left <= 0) return stop();
    const video = videoRef.current;
    if (busy.current || !video || video.videoWidth === 0) return;

    // cheap change check on a 16×16 grey thumbnail
    const t = document.createElement("canvas");
    t.width = t.height = DIFF_SIDE;
    const tctx = t.getContext("2d", { willReadFrequently: true });
    if (!tctx) return;
    tctx.drawImage(video, 0, 0, DIFF_SIDE, DIFF_SIDE);
    const grey = toGrey(tctx.getImageData(0, 0, DIFF_SIDE, DIFF_SIDE).data);
    if (lastGrey.current && frameDiff(grey, lastGrey.current) < DIFF_THRESHOLD) {
      setSkipped((n) => n + 1);
      return;
    }

    const scale = Math.min(1, LIVE_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    const base64 = c.toDataURL("image/jpeg", 0.7).split(",")[1];
    if (!base64) return;
    const size = { w: video.videoWidth, h: video.videoHeight };

    busy.current = true;
    try {
      const res = await detect({ data: { imageBase64: base64, mimeType: "image/jpeg" } });
      lastGrey.current = grey;
      setCalls((n) => n + 1);
      setFrame(size);
      setDetections(res.objects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, [detect, stop, videoRef]);

  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!live) return;
    void tickRef.current();
    const id = window.setInterval(() => void tickRef.current(), LIVE_INTERVAL_MS);
    const countdown = window.setInterval(() => {
      const left = LIVE_MAX_MS - (Date.now() - startedAt.current);
      setSecondsLeft(Math.max(0, Math.ceil(left / 1000)));
    }, 1000);
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(id);
      window.clearInterval(countdown);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [live, stop]);

  return { live, detections, frame, secondsLeft, calls, skipped, error, start, stop };
}
