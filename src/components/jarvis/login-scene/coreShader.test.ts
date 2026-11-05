import { describe, expect, it } from "vitest";
import { NOISE, coreFragment, coreVertex } from "./coreShader";

// One GLSL for both renderers: the imperative intro scene (radius 72) and the
// R3F /jarvis canvas (radius 0.72). Displacement ∝ radius, so the look is equal.
describe("molten core shader", () => {
  it("contains the simplex noise and the molten fragment colours", () => {
    expect(NOISE).toContain("float snoise(vec3 v)");
    expect(coreFragment).toContain("smoothstep(-.45,.25,vD)");
    expect(coreFragment).toContain("c=mix(cold*1.1,c,heat)");
  });
  it("vertex displacement is .35·radius·.32 for the given sphere radius", () => {
    expect(coreVertex(72)).toContain("d*.35*72.0000*.32");
    expect(coreVertex(0.72)).toContain("d*.35*0.7200*.32");
  });
  it("is a valid float literal either way (no integer in a float product)", () => {
    expect(coreVertex(72)).not.toMatch(/\*\s*72\*/);
  });
});
