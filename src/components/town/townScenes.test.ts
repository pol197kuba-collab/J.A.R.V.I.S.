import { describe, expect, it } from "vitest";
import { SceneQueue, workHold } from "./townScenes";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("SceneQueue", () => {
  it("plays scenes strictly one after another", async () => {
    const q = new SceneQueue();
    const log: string[] = [];
    const scene = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await tick(ms);
      log.push(`${name}:end`);
    };
    void q.push(scene("a", 15));
    void q.push(scene("b", 1));
    await q.push(scene("c", 1));
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("counts running + waiting scenes and survives a broken one", async () => {
    const q = new SceneQueue();
    void q.push(async () => {
      throw new Error("boom");
    });
    const ran: string[] = [];
    const last = q.push(async () => {
      ran.push("after");
    });
    expect(q.depth).toBe(2);
    await last;
    expect(ran).toEqual(["after"]);
    expect(q.depth).toBe(0);
  });
});

describe("workHold", () => {
  it("keeps a quick run at its desk for the minimum time, then lets go", () => {
    expect(workHold(1000, 1400, 2600)).toBe(2200);
    expect(workHold(1000, 4000, 2600)).toBe(0);
    expect(workHold(undefined, 4000, 2600)).toBe(0);
  });
});
