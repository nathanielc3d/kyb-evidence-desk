// Counterparty check: combine a VIES VAT result and an IBAN check into one verdict. Pure rules.

const STOP = new Set(["SA", "SAS", "SASU", "SARL", "EURL", "GMBH", "AG", "KG", "BV", "NV", "SRL", "SPA", "SL", "LTD", "LIMITED", "PLC", "AB", "OY", "AS", "APS", "SE", "THE", "ET", "DE", "LA", "LE", "DU", "DES", "AND", "&", "CO", "COMPANY", "SOCIETE", "STE"]);

export function nameTokens(s) {
  return new Set(String(s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)));
}

/** Share of the claimed name's tokens found in the registered name (0 to 1). */
export function nameMatch(claimed, registered) {
  const a = nameTokens(claimed), b = nameTokens(registered);
  if (!a.size || !b.size) return null;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return Math.round((hit / a.size) * 100) / 100;
}

// VIES uses EL for Greece where IBANs use GR, and XI for Northern Ireland (GB IBANs).
const VAT_TO_IBAN_COUNTRY = { EL: "GR", XI: "GB" };

export function verdict({ vat, iban, name }) {
  const reasons = [];
  let level = 0; // 0 pass, 1 review, 2 fail
  const bump = (l, r) => { level = Math.max(level, l); reasons.push(r); };
  if (vat) {
    if (vat.error) bump(1, `VAT could not be checked right now (${vat.error}); retry later`);
    else if (!vat.valid) bump(2, `VAT ${vat.vat} is not valid in VIES (${vat.status || "INVALID"})`);
    else reasons.push(`VAT ${vat.vat} is valid in VIES`);
  }
  if (iban) {
    if (!iban.valid) bump(2, `IBAN is invalid: ${iban.errors.join("; ")}`);
    else {
      reasons.push(`IBAN checksum and length are valid (${iban.country})`);
      if (!iban.sepa) bump(1, `IBAN country ${iban.country} is outside SEPA`);
      if (vat && !vat.error) {
        const vc = VAT_TO_IBAN_COUNTRY[vat.country] || vat.country;
        if (vc !== iban.country) bump(1, `IBAN country ${iban.country} differs from VAT country ${vat.country}: common for groups, also a classic invoice fraud signal`);
      }
    }
  }
  let match = null;
  if (name && vat && vat.valid) {
    if (!vat.name) reasons.push("VIES does not publish the registered name for this country, so the name was not compared");
    else {
      match = nameMatch(name, vat.name);
      if (match === null) bump(1, "name could not be compared");
      else if (match < 0.5) bump(1, `claimed name matches the VIES name poorly (${match})`);
      else reasons.push(`claimed name matches the VIES name (${match})`);
    }
  }
  return { verdict: ["pass", "review", "fail"][level], reasons, name_match: match };
}
