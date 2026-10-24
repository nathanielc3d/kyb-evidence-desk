# KYB Evidence Desk

**Explainable, auditable EU counterparty due diligence for compliance teams and AI agents, with a Chainlink CRE workflow that anchors each verdict on-chain.**

Live demo: https://kyb-evidence-desk.moneymachine.workers.dev  
Built for the [BLI Legal Tech Hackathon 2](https://dorahacks.io/hackathon/1904) (LegalTech & RegTech track, Chainlink "Best workflow with CRE" bounty).

## Problem

Before paying a supplier, onboarding a client or signing a contract, EU businesses must check who they deal with (AML customer due diligence, intra-EU VAT rules, Verification of Payee since October 2025). Today that check is a screenshot of a registry page, or a black-box "OK" from a vendor. When an auditor, a court or a regulator asks *"what exactly did you check, when, against which source, and why did you decide that?"*, nobody can answer with proof. AI agents that pay invoices make this worse: their decisions are fast and invisible.

## What it does

Give it an EU VAT number, optionally an IBAN and the name the counterparty claims. It returns an **evidence report**:

| Part | Content |
|---|---|
| Checks | Live EU VIES VAT lookup (registered name and address), IBAN structure (ISO 13616 mod 97 + registry length), IBAN country vs VAT country, claimed name vs registered name |
| Sources | For each check: source name, exact URL, retrieval time, SHA-256 of the raw registry response |
| Verdict | `pass` / `review` / `fail`, each reason with a stable code (`VAT_INVALID`, `IBAN_COUNTRY_MISMATCH`, `NAME_MISMATCH`...) and plain-English text |
| Legal basis | Each check mapped to its legal reference: AMLD art. 13 / AMLR, VAT Directive art. 138 + Reg. 904/2010 art. 31 (VIES), Instant Payments Reg. 2024/886 (Verification of Payee), GDPR art. 5(1)(c), 6, 22 |
| Human review | `human_review_required` flag + note: anything but `pass` must be escalated; even a pass needs a human sign-off for decisions with legal effect (GDPR art. 22) |
| Integrity | `report_sha256` over the canonical report, and an `attestation` hash over the stable facts. `POST /api/verify` recomputes both and detects any tampering |
| Privacy | The IBAN is masked in the report and only its SHA-256 enters the attestation. Nothing is stored. Only hashes go on-chain |

Fail-safe by design: when VIES is down or busy (frequent for France), the check is marked `unavailable` and the verdict is `review`, never a false `invalid`.

## Chainlink CRE workflow (`cre/kyb-attest`)

```
HTTP trigger {vat, iban?, name?}
  -> each DON node: GET /api/attestation (live VIES + IBAN + name rules)
  -> consensus: every field must be identical across nodes (ConsensusAggregationByFields + identical)
  -> DON-signed report: abi.encode(bytes32 subjectId, bytes32 attestationHash, uint8 decision, uint32 yyyymmdd)
  -> EVMClient.writeReport -> KybAttestationRegistry.onReport (Ethereum Sepolia)
```

The attestation core deliberately excludes per-request timestamps (it keeps the UTC day), so independent nodes checking the same counterparty on the same day reach byte-identical bytes. If nodes see different registry answers (e.g. VIES busy for some of them), consensus fails and nothing is written: the workflow fails closed.

`contracts/KybAttestationRegistry.sol` accepts reports only from the CRE forwarder, keeps a per-subject history, emits `KybAttested`, and offers `wasAttested(subjectId, hash)` so an auditor can prove that a given report existed on a given day without the report being public.

## Architecture

```
browser / AI agent ──> Cloudflare Worker (src/worker.js)
                         ├─ src/evidence.js  checks, verdict, canonical JSON, hashes, verify
                         ├─ src/legal.js     legal references per check
                         ├─ src/iban.js      ISO 13616 validation (offline)
                         └─ EU VIES REST API (live)
Chainlink CRE DON ──> /api/attestation ──> consensus ──> KybAttestationRegistry (Sepolia)
```

API:

- `GET /api/report?vat=FR39356000000&iban=...&name=...` full evidence report
- `GET /api/attestation?vat=...` compact attestation used by the CRE workflow
- `POST /api/verify` (body = report JSON) recompute and compare hashes
- `GET /api/legal-basis` legal reference table

Examples from the live demo are in `examples/` (pass, review, fail, and a VIES-busy case).

## Run it

```bash
# Worker + rules (Node 20+)
npm test                     # 14 tests, offline (VIES mocked)
npx wrangler dev             # local demo on http://localhost:8787

# CRE workflow (Bun)
cd cre/kyb-attest && bun install
bun test                     # 6 tests: helpers + full workflow with mocked HTTP/EVM capabilities
npx tsc --noEmit             # typecheck
bun node_modules/@chainlink/cre-sdk/bin/cre-compile.ts main.ts /tmp/kyb-attest.wasm   # compiles to WASM

# Simulation with the CRE CLI (needs a free CRE account: `cre login`)
cd cre && cre workflow simulate kyb-attest --target staging-settings \
  --non-interactive --trigger-index 0 --http-payload @kyb-attest/http_trigger_payload.json
```

To write for real: deploy `KybAttestationRegistry` on Sepolia with the forwarder address listed by `cre workflow supported-chains`, put its address in `cre/kyb-attest/config.staging.json`, and add `--broadcast`.

## Limits (honest)

- No beneficial-owner, sanctions or PEP screening yet: a `pass` means "registered and consistent", not "safe".
- Name matching is token overlap, not a bank Verification of Payee response.
- VIES does not publish names for some member states (e.g. DE); the name check is then skipped and said so.
- Not legal advice. Legal references are summaries for reviewers.

## Disclosure

Built by an AI agent (Grok Bot) operated by Nathaniel, as part of a public challenge. Code, tests and docs were written by the agent; the operator reviews and submits.

## License

MIT
