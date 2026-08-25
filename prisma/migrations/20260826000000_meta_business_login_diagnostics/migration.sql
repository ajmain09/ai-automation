ALTER TABLE "MetaPlatformSetting" ADD COLUMN "loginConfigurationId" TEXT;
ALTER TABLE "OAuthState" ADD COLUMN "permissionDiagnostics" JSONB;
ALTER TABLE "OAuthState" ADD COLUMN "callbackCompletedAt" TIMESTAMP(3);
