import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

const KEYS = [
  "JARVIS_SUPABASE_URL",
  "SUPABASE_URL",
  "JARVIS_SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("supabase env", () => {
  it("JARVIS_* wygrywa z wstrzykiwanymi przez Lovable SUPABASE_*", () => {
    process.env.SUPABASE_URL = "https://stara.supabase.co";
    process.env.JARVIS_SUPABASE_URL = "https://nowa.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stary";
    process.env.JARVIS_SUPABASE_SERVICE_ROLE_KEY = "nowy";

    expect(supabaseUrl()).toBe("https://nowa.supabase.co");
    expect(supabaseServiceRoleKey()).toBe("nowy");
  });

  it("rzuca, gdy serwer i build wskazują na różne projekty", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://nowa.supabase.co");
    process.env.SUPABASE_URL = "https://stara.supabase.co";
    delete process.env.JARVIS_SUPABASE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => supabaseUrl()).toThrow(/JARVIS_SUPABASE_URL/);
  });

  it("przepuszcza zgodny adres (różnica tylko w końcowym /)", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://nowa.supabase.co");
    process.env.JARVIS_SUPABASE_URL = "https://nowa.supabase.co/";

    expect(supabaseUrl()).toBe("https://nowa.supabase.co");
  });
});
