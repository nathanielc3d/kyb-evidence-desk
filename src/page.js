export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KYB Evidence Desk: explainable EU counterparty checks</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1b1f24}h1{margin-bottom:.2rem}
form{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.5rem;margin:1rem 0}input,button{padding:.5rem;font:inherit}button{cursor:pointer}
.badge{display:inline-block;padding:.15rem .6rem;border-radius:1rem;color:#fff;font-weight:600}.pass{background:#1a7f37}.review{background:#bf8700}.fail{background:#cf222e}.unavailable,.not_applicable{background:#57606a}
table{border-collapse:collapse;width:100%;margin:.5rem 0}td,th{border:1px solid #d0d7de;padding:.35rem .5rem;text-align:left;vertical-align:top;font-size:14px}code{font-size:12px;word-break:break-all}
.muted{color:#57606a;font-size:13px}pre{background:#f6f8fa;padding:.75rem;overflow:auto;font-size:12px;max-height:300px}.ex a{margin-right:.8rem}</style></head><body>
<h1>KYB Evidence Desk</h1>
<p>Explainable EU counterparty due diligence for compliance teams and AI agents: every check is <b>sourced</b>, <b>timestamped</b>, <b>tied to its legal basis</b>, flagged for <b>human review</b>, and sealed with a hash that a Chainlink CRE workflow can anchor on-chain.</p>
<p class="ex">Try: <a href="#" data-q="vat=FR39356000000&name=La%20Poste">La Poste (pass)</a><a href="#" data-q="vat=IE6388047V&iban=DE89370400440532013000&name=Google%20Ireland">IBAN country mismatch (review)</a><a href="#" data-q="vat=FR39356000000&iban=FR7630006000011234567890188&name=La%20Poste">Bad IBAN (fail)</a></p>
<form id="f"><input name="vat" placeholder="EU VAT number, e.g. FR39356000000" required><input name="iban" placeholder="IBAN (optional)"><input name="name" placeholder="Claimed company name (optional)"><button>Check</button></form>
<div id="out"></div>
<h3>Verify a report</h3><p class="muted">Paste a downloaded report JSON: the server recomputes the report and attestation hashes and tells you whether anything was altered.</p>
<textarea id="vr" rows="5" style="width:100%"></textarea><button id="vb">Verify</button><pre id="vo"></pre>
<p class="muted">Decision support from official public data (EU VIES, ISO 13616). Not legal advice. Nothing is stored. Open source (MIT): <a href="https://github.com/nathanielc3d/kyb-evidence-desk">github.com/nathanielc3d/kyb-evidence-desk</a>. Built by an AI agent (Grok Bot) operated by Nathaniel.</p>
<script>
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const out=document.getElementById("out");
async function run(q){out.innerHTML="Checking live registries...";const r=await fetch("/api/report?"+q);const d=await r.json();if(!r.ok){out.innerHTML="<p>"+esc(d.error)+"</p>";return}
let h='<h2>Verdict: <span class="badge '+d.verdict.decision+'">'+d.verdict.decision.toUpperCase()+'</span></h2>';
h+='<p><b>Human review required:</b> '+(d.verdict.human_review_required?"YES":"recommended sign-off")+' <span class="muted">'+esc(d.verdict.human_review_note)+'</span></p><ul>'+d.verdict.reasons.map(x=>'<li><span class="badge '+x.severity+'">'+x.code+'</span> '+esc(x.text)+'</li>').join("")+'</ul>';
h+='<h3>Evidence</h3><table><tr><th>Check</th><th>Status</th><th>Result</th><th>Source and time</th><th>Legal basis</th></tr>'+d.checks.map(c=>'<tr><td>'+c.id+'</td><td><span class="badge '+c.status+'">'+c.status+'</span></td><td><code>'+esc(JSON.stringify(c.result||c.error||c.note))+'</code></td><td>'+(c.source?esc(c.source.name)+'<br><span class="muted">'+esc(c.source.retrieved_at)+'</span>'+(c.source.response_sha256?'<br><code>sha256 '+c.source.response_sha256.slice(0,18)+'...</code>':''):'')+'</td><td>'+(c.legal_basis||[]).join(", ")+'</td></tr>').join("")+'</table>';
h+='<h3>Legal basis</h3><table>'+d.legal_basis.map(l=>'<tr><td><b>'+l.key+'</b><br>'+esc(l.title)+'</td><td><a href="'+l.url+'">'+esc(l.ref)+'</a><br><span class="muted">'+esc(l.summary)+'</span></td></tr>').join("")+'</table>';
h+='<h3>Attestation</h3><p>subject_id <code>'+d.attestation.subject_id+'</code><br>attestation hash <code>'+d.attestation.hash+'</code><br>report sha256 <code>'+d.report_sha256+'</code></p>';
const blob=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}));h+='<p><a download="kyb-report-'+d.subject.vat+'.json" href="'+blob+'">Download report JSON</a></p><details><summary>Raw JSON</summary><pre>'+esc(JSON.stringify(d,null,2))+'</pre></details>';out.innerHTML=h;document.getElementById("vr").value=JSON.stringify(d)}
document.getElementById("f").onsubmit=e=>{e.preventDefault();run(new URLSearchParams([...new FormData(e.target)].filter(([k,v])=>v)).toString())};
document.querySelectorAll("[data-q]").forEach(a=>a.onclick=e=>{e.preventDefault();run(a.dataset.q)});
document.getElementById("vb").onclick=async()=>{const r=await fetch("/api/verify",{method:"POST",body:document.getElementById("vr").value});document.getElementById("vo").textContent=JSON.stringify(await r.json(),null,2)};
</script></body></html>`;
