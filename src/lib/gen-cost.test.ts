import { describe, expect, it } from "vitest";
import { planTotalCredits, sceneTotalCredits } from "./gen-cost";

describe("generation cost estimates", () => {
  it("charges video per second plus a small voice cost per scene", () => {
    expect(sceneTotalCredits(10, "720p")).toBeCloseTo(2.22, 5);
    expect(sceneTotalCredits(10, "1080p")).toBeCloseTo(4.42, 5);
  });
  it("a 30s economy plan (3 clips x 10s, 720p) stays under 7 credits", () => {
    const total = planTotalCredits([{ duration: 10 }, { duration: 10 }, { duration: 10 }], "720p");
    expect(total).toBeGreaterThan(6);
    expect(total).toBeLessThan(7);
  });
});
