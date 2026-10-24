import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, verifyReport, canonical, maskIban, validateInput } from "../src/evidence.js";
import { handle } from "../src/worker.js";

const NOW = new Date("2026-10-24T12:00:00Z");
const noSleep = async () => {};
const vies = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
const LA_POSTE = { isValid: true, requestDate: "2026-10-24T12:00:00.000Z", userError: "VALID", name: "SA LA POSTE", address: "9 RUE DU COLONEL PIERRE AVIA\n92130 ISSY LES MOULINEAUX" };
const GOOD_FR_IBAN = "FR7630006000011234567890189";
const deps = (fetchImpl) => ({ fetchImpl, now: NOW, sleep: noSleep });

test("canonical JSON sorts keys at every level", () => {
  assert.equal(canonical({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } }), '{"a":{"c":null,"d":[2,{"x":0,"y":1}]},"b":1}');
});

test("valid VAT + valid same-country IBAN + matching name = pass, sourced and legally annotated", async () => {
  const r = await buildReport({ vat: "fr 39356000000", iban: GOOD_FR_IBAN, name: "La Poste" }, deps(vies(LA_POSTE)));
  assert.equal(r.verdict.decision, "pass");
  assert.equal(r.verdict.human_review_required, false);
  assert.match(r.verdict.human_review_note, /art\. 22/);
  const v = r.checks.find((c) => c.id === "vat.vies");
  assert.equal(v.source.url, "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/FR/vat/39356000000");
  assert.equal(v.source.retrieved_at, NOW.toISOString());
  assert.match(v.source.response_sha256, /^0x[0-9a-f]{64}$/);
  assert.equal(v.result.address, "9 RUE DU COLONEL PIERRE AVIA, 92130 ISSY LES MOULINEAUX");
  const keys = r.legal_basis.map((l) => l.key);
  for (const k of ["AMLD_CDD", "VAT_VIES", "SEPA_VOP", "GDPR_ART22", "GDPR_MINIMISATION"]) assert.ok(keys.includes(k), k);
  assert.ok(r.legal_basis.every((l) => l.ref && l.url.startsWith("https://eur-lex.europa.eu/")));
});

test("the raw IBAN never appears in the report (masked + hashed only)", async () => {
  const r = await buildReport({ vat: "FR39356000000", iban: GOOD_FR_IBAN }, deps(vies(LA_POSTE)));
  assert.ok(!JSON.stringify(r).includes(GOOD_FR_IBAN));
  assert.equal(r.subject.iban_masked, "FR76" + "*".repeat(19) + "0189");
  assert.equal(maskIban("DE89 3704 0044 0532 0130 00"), "DE89**************3000");
});

test("invalid VAT in VIES = fail", async () => {
  const r = await buildReport({ vat: "FR00000000000" }, deps(vies({ isValid: false, userError: "INVALID" })));
  assert.equal(r.verdict.decision, "fail");
  assert.deepEqual(r.attestation.reason_codes, ["VAT_INVALID"]);
  assert.equal(r.verdict.human_review_required, true);
});

test("bad IBAN checksum = fail", async () => {
  const r = await buildReport({ vat: "FR39356000000", iban: "FR7630006000011234567890188" }, deps(vies(LA_POSTE)));
  assert.equal(r.verdict.decision, "fail");
  assert.ok(r.attestation.reason_codes.includes("IBAN_INVALID"));
});

test("IBAN country differs from VAT country = review (invoice-redirection signal)", async () => {
  const r = await buildReport({ vat: "IE6388047V", iban: "DE89370400440532013000", name: "Google Ireland" }, deps(vies({ isValid: true, userError: "VALID", name: "GOOGLE IRELAND LIMITED", address: "DUBLIN" })));
  assert.equal(r.verdict.decision, "review");
  assert.ok(r.attestation.reason_codes.includes("IBAN_COUNTRY_MISMATCH"));
});

test("poor name match = review", async () => {
  const r = await buildReport({ vat: "FR39356000000", name: "Totally Different Holding" }, deps(vies(LA_POSTE)));
  assert.equal(r.verdict.decision, "review");
  assert.ok(r.attestation.reason_codes.includes("NAME_MISMATCH"));
});

test("VIES busy twice = review, never a false 'invalid'", async () => {
  let calls = 0;
  const f = async () => { calls++; return new Response(JSON.stringify({ isValid: false, userError: "MS_MAX_CONCURRENT_REQ" })); };
  const r = await buildReport({ vat: "FR39356000000" }, deps(f));
  assert.equal(calls, 2);
  assert.equal(r.verdict.decision, "review");
  assert.equal(r.checks[0].status, "unavailable");
  assert.equal(r.attestation.vat_valid, null);
});

test("VIES busy then OK = uses the retry", async () => {
  let calls = 0;
  const f = async () => (++calls === 1 ? new Response(JSON.stringify({ userError: "MS_UNAVAILABLE" })) : new Response(JSON.stringify(LA_POSTE)));
  const r = await buildReport({ vat: "FR39356000000" }, deps(f));
  assert.equal(r.verdict.decision, "pass");
});

test("network error = review", async () => {
  const r = await buildReport({ vat: "FR39356000000" }, deps(async () => { throw new Error("ECONNRESET"); }));
  assert.equal(r.verdict.decision, "review");
});

test("attestation hash is deterministic across nodes and times within a day", async () => {
  const a = await buildReport({ vat: "FR39356000000", iban: GOOD_FR_IBAN, name: "La Poste" }, deps(vies(LA_POSTE)));
  const b = await buildReport({ vat: "FR39356000000", iban: GOOD_FR_IBAN, name: "La Poste" }, { ...deps(vies({ ...LA_POSTE, requestDate: "2026-10-24T18:00:00Z" })), now: new Date("2026-10-24T18:00:03Z") });
  assert.equal(a.attestation.hash, b.attestation.hash);
  assert.notEqual(a.report_sha256, b.report_sha256);
});

test("verifyReport accepts an intact report and detects tampering", async () => {
  const r = await buildReport({ vat: "FR39356000000", name: "La Poste" }, deps(vies(LA_POSTE)));
  assert.equal((await verifyReport(r)).ok, true);
  const t1 = structuredClone(r); t1.verdict.decision = "pass"; t1.checks[0].result.name = "EVIL CORP";
  assert.equal((await verifyReport(t1)).ok, false);
  const t2 = structuredClone(r); t2.attestation.decision = "fail";
  const v2 = await verifyReport(t2);
  assert.equal(v2.ok, false); assert.equal(v2.attestation_hash.match, false);
  assert.equal((await verifyReport({})).ok, false);
});

test("input validation", () => {
  assert.equal(validateInput({ vat: "FR39356000000" }), null);
  assert.match(validateInput({ vat: "nope" }), /vat/);
  assert.match(validateInput({ vat: "US123456789" }), /vat/);
  assert.match(validateInput({ vat: "FR39356000000", iban: "123" }), /iban/);
  assert.match(validateInput({ vat: "FR39356000000", name: "x" }), /name/);
});

test("worker routes: report, attestation, verify, 400, 404, page", async () => {
  const d = deps(vies(LA_POSTE));
  const r1 = await handle(new Request("https://x/api/report?vat=FR39356000000&name=La%20Poste"), d);
  assert.equal(r1.status, 200);
  const rep = await r1.json();
  const r2 = await handle(new Request("https://x/api/attestation?vat=FR39356000000&name=La%20Poste"), d);
  const att = await r2.json();
  assert.equal(att.attestation_hash, rep.attestation.hash);
  assert.equal(att.decision_code, 0);
  assert.equal(att.subject_id, rep.attestation.subject_id);
  const r3 = await handle(new Request("https://x/api/verify", { method: "POST", body: JSON.stringify(rep) }), d);
  assert.equal((await r3.json()).ok, true);
  assert.equal((await handle(new Request("https://x/api/report?vat=zz"), d)).status, 400);
  assert.equal((await handle(new Request("https://x/nope"), d)).status, 404);
  const page = await handle(new Request("https://x/"), d);
  assert.match(await page.text(), /KYB Evidence Desk/);
});
