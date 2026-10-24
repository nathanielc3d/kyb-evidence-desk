// Evidence report builder: turns live public-registry checks into an auditable, explainable KYB report.
// Pure logic + an injectable fetch, so it runs the same in Cloudflare Workers, Node tests and the CRE workflow's data source.

import { checkIban, normalizeIban } from "./iban.js";
import { nameMatch } from "./counterparty.js";
import { LEGAL_BASIS } from "./legal.js";

export const SCHEMA = "kyb-evidence-report/1";
export const RULES_VERSION = "2026-10-24.1";
export const DECISIONS = ["pass", "review", "fail"];
const VIES_DOWN = new Set(["MS_UNAVAILABLE", "TIMEOUT", "SERVICE_UNAVAILABLE", "MS_MAX_CONCURRENT_REQ", "GLOBAL_MAX_CONCURRENT_REQ", "INVALID_REQUESTER_INFO"]);
const VIES_PREFIXES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"]);
const VAT_TO_IBAN_COUNTRY = { EL: "GR", XI: "GB" };
export const VIES_URL = (cc, num) => `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${encodeURIComponent(num)}`;

/** Deterministic JSON: keys sorted at every level, no whitespace. */
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return "0x" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeVat(raw) {
  return String(raw || "").toUpperCase().replace(/[\s.\-]/g, "");
}

export function validateInput({ vat, iban, name }) {
  const v = normalizeVat(vat);
  if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v) || !VIES_PREFIXES.has(v.slice(0, 2)) || !/\d/.test(v)) return "vat must look like an EU VAT number, e.g. FR39356000000";
  if (iban && !/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{8,32}$/.test(normalizeIban(iban))) return "iban, when given, must look like an IBAN";
  if (name && (String(name).length < 2 || String(name).length > 200)) return "name, when given, must be 2 to 200 characters";
  return null;
}

/** Mask an IBAN for the report (GDPR art. 5(1)(c) data minimisation): keep country, check digits and last 4. */
export function maskIban(iban) {
  const n = normalizeIban(iban);
  return n.length > 8 ? n.slice(0, 4) + "*".repeat(n.length - 8) + n.slice(-4) : n;
}

async function viesLookup(vat, fetchImpl, sleep) {
  const cc = vat.slice(0, 2), num = vat.slice(2), url = VIES_URL(cc, num);
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "kyb-evidence-desk/1.0 (+https://github.com/nathanielc3d/kyb-evidence-desk)" } });
      const text = await r.text();
      if (!r.ok) { lastErr = `VIES HTTP ${r.status}`; }
      else {
        const d = JSON.parse(text);
        if (!VIES_DOWN.has(d.userError)) {
          return { ok: true, url, response_sha256: await sha256Hex(text), data: { valid: !!d.isValid, status: d.userError || null, name: d.name && d.name !== "---" ? d.name.trim() : null, address: d.address && d.address !== "---" ? d.address.trim().replace(/\s*\n\s*/g, ", ") : null, request_date: d.requestDate || null } };
        }
        lastErr = d.userError;
      }
    } catch (e) { lastErr = String(e && e.message || e); }
    if (attempt === 0) await sleep(1500);
  }
  return { ok: false, url, error: lastErr };
}

/**
 * Build the evidence report.
 * @param {{vat:string, iban?:string, name?:string, purpose?:string}} input
 * @param {{fetchImpl?:Function, now?:Date, sleep?:Function}} deps
 */
export async function buildReport(input, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || new Date();
  const sleep = deps.sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const vat = normalizeVat(input.vat);
  const claimed = input.name ? String(input.name).trim() : null;
  const checks = [];
  const reasons = [];
  let level = 0;
  const add = (lvl, code, text) => { level = Math.max(level, lvl); reasons.push({ code, severity: DECISIONS[lvl], text }); };

  // 1. VAT number, live against the official EU VIES service.
  const v = await viesLookup(vat, fetchImpl, sleep);
  const retrievedAt = now.toISOString();
  if (!v.ok) {
    checks.push({ id: "vat.vies", status: "unavailable", source: { name: "EU VIES (European Commission)", url: v.url, retrieved_at: retrievedAt }, error: v.error, legal_basis: ["VAT_VIES", "AMLD_CDD"] });
    add(1, "VAT_UNAVAILABLE", `VIES could not confirm ${vat} right now (${v.error}). Not treated as invalid: retry later.`);
  } else {
    checks.push({ id: "vat.vies", status: v.data.valid ? "pass" : "fail", result: v.data, source: { name: "EU VIES (European Commission)", url: v.url, retrieved_at: retrievedAt, response_sha256: v.response_sha256 }, legal_basis: ["VAT_VIES", "AMLD_CDD"] });
    if (v.data.valid) reasons.push({ code: "VAT_VALID", severity: "pass", text: `VAT ${vat} is valid in VIES${v.data.name ? ` (registered name: ${v.data.name})` : ""}.` });
    else add(2, "VAT_INVALID", `VAT ${vat} is not valid in VIES (${v.data.status || "INVALID"}).`);
  }
  const viesData = v.ok ? v.data : null;

  // 2. IBAN structure (ISO 13616) and consistency with the VAT country.
  let ibanHash = null;
  if (input.iban) {
    const ib = checkIban(input.iban);
    ibanHash = await sha256Hex(ib.iban);
    checks.push({ id: "iban.structure", status: ib.valid ? (ib.sepa ? "pass" : "review") : "fail", result: { iban_masked: maskIban(ib.iban), country: ib.country, sepa: ib.sepa, valid: ib.valid, errors: ib.errors, bank_code: ib.bank_code }, source: { name: "ISO 13616 mod 97-10 + SWIFT IBAN registry lengths (computed offline)", retrieved_at: retrievedAt }, legal_basis: ["SEPA_VOP", "GDPR_MINIMISATION"] });
    if (!ib.valid) add(2, "IBAN_INVALID", `IBAN is invalid: ${ib.errors.join("; ")}.`);
    else {
      reasons.push({ code: "IBAN_VALID", severity: "pass", text: `IBAN checksum and length are valid (${ib.country}).` });
      if (!ib.sepa) add(1, "IBAN_NON_SEPA", `IBAN country ${ib.country} is outside SEPA.`);
      if (viesData) {
        const vc = VAT_TO_IBAN_COUNTRY[vat.slice(0, 2)] || vat.slice(0, 2);
        const same = vc === ib.country;
        checks.push({ id: "iban.country_consistency", status: same ? "pass" : "review", result: { vat_country: vat.slice(0, 2), iban_country: ib.country }, legal_basis: ["AMLD_CDD"] });
        if (!same) add(1, "IBAN_COUNTRY_MISMATCH", `IBAN country ${ib.country} differs from VAT country ${vat.slice(0, 2)}: common for groups, but also a classic invoice-redirection fraud signal.`);
      }
    }
  }

  // 3. Claimed name vs registered name.
  let match = null;
  if (claimed && viesData && viesData.valid) {
    if (!viesData.name) {
      checks.push({ id: "name.match", status: "not_applicable", result: { claimed_name: claimed }, note: "This member state does not publish the registered name through VIES.", legal_basis: ["SEPA_VOP"] });
      reasons.push({ code: "NAME_NOT_PUBLISHED", severity: "pass", text: "VIES does not publish the registered name for this country, so the name was not compared." });
    } else {
      match = nameMatch(claimed, viesData.name);
      const ok = match !== null && match >= 0.5;
      checks.push({ id: "name.match", status: ok ? "pass" : "review", result: { claimed_name: claimed, registered_name: viesData.name, token_overlap: match, threshold: 0.5 }, legal_basis: ["SEPA_VOP", "AMLD_CDD"] });
      if (ok) reasons.push({ code: "NAME_MATCH", severity: "pass", text: `Claimed name matches the registered name (overlap ${match}).` });
      else add(1, "NAME_MISMATCH", `Claimed name "${claimed}" matches the registered name "${viesData.name}" poorly (overlap ${match ?? "n/a"}).`);
    }
  }

  const decision = DECISIONS[level];
  const usedBases = [...new Set(checks.flatMap((c) => c.legal_basis || []).concat(["GDPR_ART22", "GDPR_LAWFUL_BASIS"]))];
  // Attestation core: only stable facts (no timestamps finer than a day, no raw IBAN), so independent
  // oracle nodes running the same checks reach byte-identical bytes and can agree on one hash.
  const attestation = {
    schema: SCHEMA,
    rules_version: RULES_VERSION,
    day: retrievedAt.slice(0, 10),
    subject_vat: vat,
    vat_valid: viesData ? viesData.valid : null,
    registered_name: viesData ? viesData.name : null,
    iban_sha256: ibanHash,
    claimed_name: claimed,
    decision,
    reason_codes: reasons.map((r) => r.code).sort(),
  };
  const report = {
    schema: SCHEMA,
    generated_at: retrievedAt,
    purpose: input.purpose || "counterparty due diligence before payment or contract",
    subject: { vat, claimed_name: claimed, iban_masked: input.iban ? maskIban(input.iban) : null },
    checks,
    verdict: {
      decision,
      reasons,
      rules_version: RULES_VERSION,
      human_review_required: decision !== "pass",
      human_review_note: decision === "pass"
        ? "Automated checks passed. A compliance officer should still sign off before any decision with legal effect (GDPR art. 22)."
        : "Escalate to a human reviewer before paying, onboarding or signing. Do not rely on this automated result alone (GDPR art. 22).",
    },
    legal_basis: usedBases.map((k) => ({ key: k, ...LEGAL_BASIS[k] })),
    attestation: { ...attestation, subject_id: await sha256Hex("vat:" + vat), hash: await sha256Hex(canonical(attestation)) },
    disclaimer: "Decision support built from official public data. Not legal advice. A pass does not prove who you are dealing with (no beneficial-owner, sanctions or PEP screening in this version).",
    generator: { name: "KYB Evidence Desk", repo: "https://github.com/nathanielc3d/kyb-evidence-desk", built_by: "an AI agent (Grok Bot) operated by Nathaniel" },
  };
  report.report_sha256 = await sha256Hex(canonical(report));
  return report;
}

/** Recompute both hashes of a report and say whether it was altered. */
export async function verifyReport(report) {
  if (!report || typeof report !== "object" || !report.attestation) return { ok: false, error: "not a kyb-evidence report" };
  const { report_sha256, ...rest } = report;
  const { subject_id, hash, ...core } = report.attestation;
  const reportHash = await sha256Hex(canonical(rest));
  const attHash = await sha256Hex(canonical(core));
  const subj = await sha256Hex("vat:" + core.subject_vat);
  return {
    ok: reportHash === report_sha256 && attHash === hash && subj === subject_id,
    report_hash: { claimed: report_sha256, recomputed: reportHash, match: reportHash === report_sha256 },
    attestation_hash: { claimed: hash, recomputed: attHash, match: attHash === hash },
    subject_id: { claimed: subject_id, recomputed: subj, match: subj === subject_id },
  };
}
