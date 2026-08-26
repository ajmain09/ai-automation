import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/pages/manual-facebook-connect.tsx", "utf8");
describe("manual Facebook onboarding UI contract", () => {
  it("uses the manual endpoint and keeps OAuth advanced", () => {
    expect(source).toContain("/api/meta/manual-connect");
    expect(source).toContain("Verify & Connect");
    expect(source).toContain("Advanced connection methods");
    expect(source).toContain("/api/meta/oauth/start");
    expect(source).toContain("existingPageId");
    expect(source).toContain("setToken(\"\")");
  });
});
