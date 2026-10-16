import { describe, expect, it } from "vitest";
import { samePrice } from "./ingest.server";

describe("samePrice", () => {
  it("ta sama cena po zapisie NUMERIC(20,8) to kopia", () => {
    expect(samePrice(83977.1309, 83977.1309)).toBe(true);
    expect(samePrice(2674.97521, 2674.975210001)).toBe(true);
  });

  it("realny ruch, nawet minimalny, to nowa obserwacja", () => {
    expect(samePrice(83977.1309, 83977.14)).toBe(false);
    expect(samePrice(4.2311, 4.2312)).toBe(false);
  });
});
