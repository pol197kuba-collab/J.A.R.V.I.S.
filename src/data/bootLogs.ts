// Linie logu sekwencji startowej (BootSequence) — dekoracja, nie dane.
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
