import { describe, expect, it } from "vitest";
import { deriveMetaPlatformReadiness, type MetaPlatformConfig } from "@/services/meta/settings";

const configured = (overrides: Partial<MetaPlatformConfig> = {}): MetaPlatformConfig => ({
  appId: "123456789",
  appSecret: "app-secret",
  verifyToken: "webhook-verify-token",
  graphApiVersion: "v23.0",
  loginConfigurationId: "",
  redirectUri: "https://ai.growthifyx.space/api/meta/oauth/callback",
  webhookUrl: "https://ai.growthifyx.space/api/meta/webhook",
  ...overrides,
});

describe("global Meta Messenger readiness", () => {
  it("is READY without a Login Configuration ID or business_management grant", () => {
    const result = deriveMetaPlatformReadiness(configured({ loginConfigurationId: "" }));

    expect(result.status).toBe("READY");
    expect(result.autoConnectStatus).toBe("AUTO_CONNECT_NOT_CONFIGURED");
  });

  it("is not configured when the App Secret is missing", () => {
    expect(deriveMetaPlatformReadiness(configured({ appSecret: "" })).status).toBe("NOT_CONFIGURED");
  });

  it("is not configured when the Webhook Verify Token is missing", () => {
    expect(deriveMetaPlatformReadiness(configured({ verifyToken: "" })).status).toBe("NOT_CONFIGURED");
  });

  it("requires a valid Graph API version and the canonical webhook endpoint", () => {
    expect(deriveMetaPlatformReadiness(configured({ graphApiVersion: "23" })).status).toBe("NOT_CONFIGURED");
    expect(deriveMetaPlatformReadiness(configured({ webhookUrl: "https://example.test/api/meta/webhook" })).status).toBe("NOT_CONFIGURED");
  });

  it("reports automatic Facebook Login readiness separately", () => {
    const result = deriveMetaPlatformReadiness(configured({ loginConfigurationId: "login-config-123" }));

    expect(result.status).toBe("READY");
    expect(result.autoConnectStatus).toBe("AUTO_CONNECT_READY");
  });
});
