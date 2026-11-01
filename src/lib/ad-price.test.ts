import { expect, it } from "vitest";
import { AD_VIDEO_PRICE_SAR } from "./ad-price";
it("charges 20 Saudi riyals for one advertising video", () => {
  expect(AD_VIDEO_PRICE_SAR).toBe(20);
});