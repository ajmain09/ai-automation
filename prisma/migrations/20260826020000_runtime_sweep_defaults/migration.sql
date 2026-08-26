-- Forward-only production-safe defaults for the current Bangladesh deployment.
ALTER TABLE "PageSettings" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "PageSettings" ALTER COLUMN "countryCode" SET DEFAULT 'BD';
ALTER TABLE "PageAiSettings" ADD COLUMN "maxProductsPerRecommendation" INTEGER NOT NULL DEFAULT 1;
