// Cloudflare Worker: free demo of KYB Evidence Desk. Stateless: nothing is stored.
import { buildReport, verifyReport, validateInput, DECISIONS } from "./evidence.js";
import { LEGAL_BASIS } from "./legal.js";
import { PAGE } from "./page.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
const json = (d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });

function inputFrom(url) {
  const p = url.searchParams;
  return { vat: p.get("vat") || "", iban: p.get("iban") || undefined, name: p.get("name") || undefined, purpose: p.get("purpose") || undefined };
}

export async function handle(request, deps = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (url.pathname === "/" || url.pathname === "/index.html") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/health") return json({ ok: true, service: "kyb-evidence-desk" });
  if (url.pathname === "/api/legal-basis") return json(LEGAL_BASIS);
  if (url.pathname === "/api/report" || url.pathname === "/api/attestation") {
    const input = inputFrom(url);
    const err = validateInput(input);
    if (err) return json({ error: err }, 400);
    const report = await buildReport(input, deps);
    if (url.pathname === "/api/report") return json(report);
    // Compact, node-independent view for the Chainlink CRE workflow (identical across honest nodes on the same day).
    const a = report.attestation;
    return json({ schema: a.schema, subject_id: a.subject_id, attestation_hash: a.hash, decision: a.decision, decision_code: DECISIONS.indexOf(a.decision), day: a.day, rules_version: a.rules_version, vat_check_available: a.vat_valid !== null });
  }
  if (url.pathname === "/api/verify" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "body must be a JSON report" }, 400); }
    return json(await verifyReport(body));
  }
  return json({ error: "not found", routes: ["/", "/api/report?vat=&iban=&name=", "/api/attestation?vat=&iban=&name=", "POST /api/verify", "/api/legal-basis", "/health"] }, 404);
}

export default { fetch: (req) => handle(req) };
