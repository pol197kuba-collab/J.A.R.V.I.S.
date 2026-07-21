import { describe, it, expect, vi, beforeEach } from "vitest";

// isBlockedTarget resolves hostnames via dns.lookup — stub it so tests are
// deterministic and never touch the network.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { isPrivateIp, isBlockedTarget, ALL_TOOLS, getToolByName } from "./tools.server";

const lookupMock = vi.mocked(lookup);

// The SSRF guard protects agent-driven fetch_url calls (URL chosen by the
// model, steerable via prompt injection) from reaching cloud metadata and
// internal services. A regression here is a security hole, so the ranges
// are pinned exhaustively.
describe("isPrivateIp", () => {
  it("blocks IPv4 loopback, RFC1918 and link-local ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
      "169.254.169.254", // cloud metadata endpoint
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4 addresses, including 172.x outside /12", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "1.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local and link-local", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "FE80::1".toLowerCase()]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("unwraps IPv4-mapped IPv6 (::ffff:...) instead of letting it bypass the v4 rules", () => {
    expect(isPrivateIp("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("treats non-IP input as private (fail closed)", () => {
    expect(isPrivateIp("example.com")).toBe(true);
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("isBlockedTarget", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("blocks well-known internal hostnames without touching DNS", async () => {
    expect(await isBlockedTarget("localhost")).toBe(true);
    expect(await isBlockedTarget("LOCALHOST")).toBe(true);
    expect(await isBlockedTarget("foo.localhost")).toBe(true);
    expect(await isBlockedTarget("metadata.google.internal")).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("evaluates literal IPs directly, without DNS", async () => {
    expect(await isBlockedTarget("169.254.169.254")).toBe(true);
    expect(await isBlockedTarget("8.8.8.8")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks a public hostname that resolves to an internal IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    expect(await isBlockedTarget("evil-rebind.example.com")).toBe(true);
  });

  it("blocks when ANY resolved address is internal (multi-record rebinding)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ] as never);
    expect(await isBlockedTarget("mixed.example.com")).toBe(true);
  });

  it("allows a hostname resolving only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    expect(await isBlockedTarget("example.com")).toBe(false);
  });

  it("fails closed on DNS errors and empty results", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isBlockedTarget("does-not-resolve.example.com")).toBe(true);
    lookupMock.mockResolvedValue([] as never);
    expect(await isBlockedTarget("empty.example.com")).toBe(true);
  });
});

// Registry sanity: a duplicated or malformed declaration would confuse the
// model's function-calling (or shadow another tool) without any visible
// error at build time.
describe("tool registry", () => {
  it("every tool name is unique", () => {
    const names = ALL_TOOLS.map((t) => t.declaration.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every declaration is well-formed", () => {
    for (const tool of ALL_TOOLS) {
      const { name, description, parameters } = tool.declaration;
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(description.trim().length).toBeGreaterThan(0);
      expect(parameters).toMatchObject({ type: "object" });
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("getToolByName finds registered tools and rejects unknown names", () => {
    const first = ALL_TOOLS[0];
    expect(getToolByName(first.declaration.name)).toBe(first);
    expect(getToolByName("definitely_not_a_tool")).toBeUndefined();
  });
});
