export type ChatMessage = {
  id: string;
  role: "user" | "jarvis";
  text: string;
  time: string;
};

export const initialMessages: ChatMessage[] = [
  { id: "1", role: "jarvis", time: "21:42:01", text: "Good evening, sir. All systems are nominal. Shall I prepare your daily briefing?" },
  { id: "2", role: "user", time: "21:42:18", text: "Yes, and pull the latest activity from the lab." },
  { id: "3", role: "jarvis", time: "21:42:19", text: "Compiling now. I have flagged three anomalies in the arc reactor telemetry that warrant your attention." },
  { id: "4", role: "user", time: "21:43:05", text: "Schedule a meeting with Pepper for tomorrow at 9." },
  { id: "5", role: "jarvis", time: "21:43:06", text: "Confirmed. Calendar updated. I have also rerouted your 10 AM call to make room." },
];

export const jarvisReplies = [
  "Acknowledged, sir. Working on it.",
  "Right away. I will notify you the moment it is complete.",
  "Of course. Cross-referencing now with available records.",
  "Understood. Deploying the requested subroutine.",
  "Consider it done. I will keep you apprised.",
];

export type ActiveTask = {
  id: string;
  title: string;
  subsystem: string;
  progress: number;
  status: "running" | "queued" | "warning";
  elapsed: string;
};

export const activeTasks: ActiveTask[] = [
  { id: "t1", title: "Generating quarterly intelligence report", subsystem: "Analytics", progress: 72, status: "running", elapsed: "00:04:21" },
  { id: "t2", title: "Monitoring Discord — Stark Industries", subsystem: "Comms", progress: 100, status: "running", elapsed: "12:47:09" },
  { id: "t3", title: "Indexing private repository", subsystem: "CodeSync", progress: 48, status: "running", elapsed: "00:01:55" },
  { id: "t4", title: "Calendar synchronization", subsystem: "Scheduler", progress: 35, status: "queued", elapsed: "00:00:12" },
  { id: "t5", title: "Perimeter threat scan", subsystem: "Security", progress: 88, status: "warning", elapsed: "00:00:48" },
];

export const systemStats = [
  { label: "CPU", value: "37%", trend: [20, 28, 34, 31, 40, 36, 37] },
  { label: "MEM", value: "12.4 GB", trend: [40, 42, 45, 44, 46, 48, 47] },
  { label: "NET", value: "184 Mbps", trend: [60, 55, 70, 80, 72, 90, 85] },
  { label: "LAT", value: "12 ms", trend: [15, 14, 13, 12, 14, 11, 12] },
];

export const systemLogs = [
  { ts: "21:43:06", level: "INFO", source: "scheduler", msg: "Meeting created: Pepper Potts @ 09:00" },
  { ts: "21:42:55", level: "WARN", source: "security", msg: "Unusual login attempt from 10.0.0.42 — challenged" },
  { ts: "21:42:30", level: "INFO", source: "analytics", msg: "Report job queued (id=rpt_8821)" },
  { ts: "21:41:12", level: "INFO", source: "comms", msg: "Discord channel #lab synced (412 new messages)" },
  { ts: "21:40:01", level: "ERROR", source: "codesync", msg: "Repository fetch timeout — retrying" },
  { ts: "21:38:47", level: "INFO", source: "core", msg: "Voice interface calibration complete" },
  { ts: "21:35:22", level: "INFO", source: "core", msg: "System boot sequence finished in 2.41s" },
];

export const agents = [
  { id: "a1", name: "Atlas", role: "Research", status: "online", tasks: 4 },
  { id: "a2", name: "Vega", role: "Communications", status: "online", tasks: 2 },
  { id: "a3", name: "Orion", role: "Security", status: "alert", tasks: 1 },
  { id: "a4", name: "Lyra", role: "Scheduling", status: "idle", tasks: 0 },
  { id: "a5", name: "Nyx", role: "Code Synthesis", status: "online", tasks: 3 },
];

export const bootLogs = [
  { ts: "00:00.012", tag: "[BIOS]", msg: "Arc-reactor handshake OK" },
  { ts: "00:00.041", tag: "[NET ]", msg: "ip 10.0.0.42 → 192.168.7.1" },
  { ts: "00:00.087", tag: "[SEC ]", msg: "TLS 1.3 // cipher CHACHA20-POLY1305" },
  { ts: "00:00.124", tag: "[CORE]", msg: "loading neural map J-3140.bin" },
  { ts: "00:00.198", tag: "[HUD ]", msg: "calibrating overlay matrix" },
  { ts: "00:00.241", tag: "[BIO ]", msg: "voiceprint sample 0x9F4A acquired" },
  { ts: "00:00.302", tag: "[NET ]", msg: "uplink stark-orbital established" },
  { ts: "00:00.355", tag: "[CORE]", msg: "subroutine atlas.online()" },
  { ts: "00:00.410", tag: "[SEC ]", msg: "perimeter scan 360° clean" },
  { ts: "00:00.488", tag: "[SYS ]", msg: "kernel J7.2.1 ready" },
  { ts: "00:00.541", tag: "[HUD ]", msg: "fonts // Orbitron loaded" },
  { ts: "00:00.612", tag: "[CORE]", msg: "spinning up agent hub" },
];