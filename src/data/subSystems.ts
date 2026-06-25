export type SubSystemId = "fuel-monitor" | "rto-calculator" | "jobfit-ai";

export type SubSystem = {
  id: SubSystemId;
  name: string;
  description: string;
  url: string;
  sysRef: string;
  codename: string;
};

export const SUB_SYSTEMS: SubSystem[] = [
  {
    id: "fuel-monitor",
    name: "FUEL MONITOR",
    description: "Fuel surcharge monitoring & logistics analytics.",
    url: "https://oplata-paliwowa-phl.lovable.app",
    sysRef: "SYS_REF: 404-X / FM-01",
    codename: "FUEL_MONITOR.SYS",
  },
  {
    id: "rto-calculator",
    name: "RTO CALCULATOR",
    description: "Return To Office financial & commute impact calculator.",
    url: "https://rtocalculator.lovable.app",
    sysRef: "SYS_REF: 707-K / RTO-02",
    codename: "RTO_CALC.SYS",
  },
  {
    id: "jobfit-ai",
    name: "JOBFIT AI",
    description: "AI-powered CV optimization & job advertisement matching platform.",
    // TODO: replace with the real JobFit AI deployment URL once available.
    // Empty string keeps the tile in the grid but ModuleFrame should treat
    // it as "not yet wired" instead of loading the placeholder domain.
    url: "",
    sysRef: "SYS_REF: 909-Z / JF-03",
    codename: "JOBFIT_AI.SYS",
  },
];