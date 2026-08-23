import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

// Credentials are encrypted at rest behind this boundary. Meta token handling arrives in Step 2.
export function encryptCredential(value: string) {
  const env = getEnv();
  const key = crypto.createHash("sha256").update(env.APP_ENCRYPTION_KEY ?? env.SESSION_SECRET ?? "").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptCredential(payload: string) {
  const [ivEncoded, tagEncoded, valueEncoded] = payload.split(".");
  if (!ivEncoded || !tagEncoded || !valueEncoded) throw new Error("Invalid encrypted credential");
  const env = getEnv();
  const key = crypto.createHash("sha256").update(env.APP_ENCRYPTION_KEY ?? env.SESSION_SECRET ?? "").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(valueEncoded, "base64url")), decipher.final()]).toString("utf8");
}
