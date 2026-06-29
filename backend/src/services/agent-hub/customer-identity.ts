import { createHash } from "node:crypto";

export function normalizePhoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizeCustomerNameKey(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildCustomerKey(params: { clinicCode: string; phoneNumber?: string | null; customerName?: string | null }) {
  const digits = normalizePhoneDigits(params.phoneNumber);
  const identity = digits || normalizeCustomerNameKey(params.customerName);

  return createHash("sha256").update(`${params.clinicCode.toLowerCase()}:${identity}`).digest("hex").slice(0, 32);
}
