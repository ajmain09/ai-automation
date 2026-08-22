export type PhoneNormalizationOptions = {
  countryCode?: string;
  defaultCountryCallingCode?: string;
};

export type NormalizedPhone = {
  normalized: string;
  original: string;
  countryCallingCode: string;
};

const COUNTRY_CALLING_CODES: Record<string, string> = {
  BD: "880",
  US: "1",
  CA: "1",
  GB: "44",
  IN: "91",
};

export function normalizePhone(value: string, options: PhoneNormalizationOptions = {}): NormalizedPhone | null {
  const original = value.trim();
  if (!original) return null;
  const digits = original.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const country = (options.countryCode ?? "").trim().toUpperCase();
  const configuredCode = COUNTRY_CALLING_CODES[country] ?? options.defaultCountryCallingCode?.replace(/\D/g, "");
  let international = digits;
  let countryCallingCode = "";

  if (original.startsWith("+")) {
    international = digits;
  } else if (configuredCode && digits.startsWith("0")) {
    international = `${configuredCode}${digits.slice(1)}`;
  } else if (configuredCode && digits.startsWith(configuredCode)) {
    international = digits;
  } else if (configuredCode) {
    international = `${configuredCode}${digits}`;
  }

  if (configuredCode && international.startsWith(configuredCode)) countryCallingCode = configuredCode;
  if (!countryCallingCode) countryCallingCode = inferCallingCode(international);
  if (international.length < 8 || international.length > 15) return null;
  if (!/^\d+$/.test(international)) return null;
  if (country === "BD" && !/^8801[3-9]\d{8}$/.test(international)) return null;
  return { normalized: `+${international}`, original, countryCallingCode };
}

function inferCallingCode(value: string) {
  for (const code of Object.values(COUNTRY_CALLING_CODES).sort((a, b) => b.length - a.length)) {
    if (value.startsWith(code)) return code;
  }
  return value.slice(0, 1);
}

export function isValidPhone(value: string, options?: PhoneNormalizationOptions) {
  return normalizePhone(value, options) !== null;
}
