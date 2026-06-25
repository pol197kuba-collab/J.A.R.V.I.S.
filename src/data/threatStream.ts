export type ThreatLevel = "ALERT" | "DATA" | "WARNING" | "INTEL";

export type ThreatEntry = {
  id: string;
  level: ThreatLevel;
  time: string;
  text: string;
};

const POOL: Array<Pick<ThreatEntry, "level" | "text">> = [
  { level: "ALERT", text: "NETWORK INFRASTRUCTURE NOMINAL" },
  { level: "DATA", text: "SECURE STARK ENCRYPTION ACTIVE" },
  { level: "WARNING", text: "UNIDENTIFIED DATAPACKET BLOCKED" },
  { level: "INTEL", text: "ORBITAL UPLINK SYNCHRONIZED // KEYHOLE-12" },
  { level: "DATA", text: "PERIMETER SENSORS REPORTING GREEN" },
  { level: "ALERT", text: "BIO-METRIC SCAN VERIFIED // JACOB_SLAWINSKY" },
  { level: "WARNING", text: "ANOMALOUS TRAFFIC // 187.43.x.x THROTTLED" },
  { level: "INTEL", text: "FRIENDLY ASSET ONLINE // J-7" },
  { level: "DATA", text: "FIREWALL POLICY UPDATED // R-3.14" },
  { level: "ALERT", text: "BACKUP RELAYS HOT-STANDBY" },
  { level: "WARNING", text: "DRONE NETWORK LATENCY +14ms" },
  { level: "INTEL", text: "GLOBAL THREAT INDEX // 0.21 LOW" },
  { level: "DATA", text: "ARC REACTOR FLUX // 3.140 GW STABLE" },
  { level: "WARNING", text: "ATTEMPTED INTRUSION // PORT 2342 REPELLED" },
  { level: "ALERT", text: "SATELLITE 4 HANDOVER COMPLETE" },
];

function ts(d = new Date()) {
  return d.toTimeString().slice(0, 5);
}

export function seedThreats(): ThreatEntry[] {
  return POOL.slice(0, 10).map((p, i) => ({
    id: `seed-${i}`,
    level: p.level,
    text: p.text,
    time: ts(new Date(Date.now() - (10 - i) * 60_000)),
  }));
}

export function nextThreat(idSeed: number): ThreatEntry {
  const p = POOL[Math.floor(Math.random() * POOL.length)];
  return { id: `t-${idSeed}-${Math.random().toString(36).slice(2, 7)}`, level: p.level, text: p.text, time: ts() };
}