import { describe, expect, it } from "vitest";
import { buildMetaAuthorizationUrl, REQUIRED_META_PERMISSIONS } from "@/services/meta/service";

describe("Facebook Login for Business OAuth", () => {
  it("includes the configured Login Configuration ID and production callback", () => {
    const url = buildMetaAuthorizationUrl({
      appId: "123456",
      appSecret: "secret",
      verifyToken: "verify",
      graphApiVersion: "v23.0",
      loginConfigurationId: "987654",
      redirectUri: "https://ai.growthifyx.space/api/meta/oauth/callback",
      webhookUrl: "https://ai.growthifyx.space/api/meta/webhook",
    }, "secure-state");

    expect(url.searchParams.get("config_id")).toBe("987654");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ai.growthifyx.space/api/meta/oauth/callback");
    expect(url.searchParams.get("scope")).toBe(REQUIRED_META_PERMISSIONS.join(","));
    expect(url.toString()).not.toContain("localhost");
  });
});
