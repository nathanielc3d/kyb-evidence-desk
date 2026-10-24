// IBAN validation (ISO 13616, mod 97-10). Pure, no network.

// Registry lengths (SWIFT IBAN registry) for SEPA countries and common others.
export const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22,
  VG: 24, XK: 20,
};

export const SEPA = new Set(["AD", "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GI", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "SM", "VA"]);
export const EU_IBAN = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);

// Where the national bank code sits inside the BBAN (0 based start, length).
const BANK_CODE = { AT: [0, 5], BE: [0, 3], DE: [0, 8], ES: [0, 4], FR: [0, 5], IT: [1, 5], LU: [0, 3], NL: [0, 4], PT: [0, 4], IE: [0, 4], GB: [0, 4], CH: [0, 5], PL: [0, 8], FI: [0, 3], SE: [0, 3] };

export function normalizeIban(raw) {
  return String(raw || "").toUpperCase().replace(/[\s\-.]/g, "");
}

export function mod97(s) {
  let r = 0;
  for (const ch of s) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) r = (r * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return r;
}

export function checkIban(raw) {
  const iban = normalizeIban(raw);
  const out = { iban, valid: false, country: iban.slice(0, 2) || null, check_digits: iban.slice(2, 4) || null, bban: iban.slice(4) || null, length: iban.length, expected_length: null, sepa: false, eu: false, bank_code: null, errors: [] };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) { out.errors.push("format: expected 2 letters, 2 digits, then letters and digits"); return out; }
  const expected = IBAN_LENGTHS[out.country];
  out.expected_length = expected ?? null;
  out.sepa = SEPA.has(out.country);
  out.eu = EU_IBAN.has(out.country);
  if (!expected) out.errors.push(`country: ${out.country} does not issue IBANs (or is not in this registry)`);
  else if (iban.length !== expected) out.errors.push(`length: ${out.country} IBANs have ${expected} characters, got ${iban.length}`);
  if (mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) out.errors.push("checksum: mod 97 check failed (typo or invented number)");
  out.valid = out.errors.length === 0;
  if (out.valid && BANK_CODE[out.country]) { const [s, l] = BANK_CODE[out.country]; out.bank_code = out.bban.slice(s, s + l); }
  out.formatted = iban.replace(/(.{4})/g, "$1 ").trim();
  return out;
}
