// Legal references attached to each check. Plain-language summaries for reviewers; not legal advice.
export const LEGAL_BASIS = {
  AMLD_CDD: {
    title: "EU AML customer due diligence",
    ref: "Directive (EU) 2015/849 (AMLD4/5), art. 13(1)(a); Regulation (EU) 2024/1624 (AMLR, applicable from 10 July 2027), art. 20 and 22",
    summary: "Obliged entities must identify the customer and verify identity on the basis of documents, data or information from a reliable and independent source. Official registries such as VIES are such a source for the existence of a VAT-registered business; they are not sufficient on their own for beneficial-ownership checks.",
    url: "https://eur-lex.europa.eu/eli/dir/2015/849/oj",
  },
  VAT_VIES: {
    title: "Intra-EU VAT number confirmation",
    ref: "Council Directive 2006/112/EC, art. 138(1)(b); Council Regulation (EU) No 904/2010, art. 31",
    summary: "The VAT exemption for intra-EU supplies requires the customer to hold a valid VAT identification number in another member state; member states must let businesses confirm a number's validity electronically (VIES).",
    url: "https://eur-lex.europa.eu/eli/reg/2010/904/oj",
  },
  SEPA_VOP: {
    title: "Verification of Payee (payee name vs IBAN)",
    ref: "Regulation (EU) 2024/886 (Instant Payments Regulation), art. 5c of Regulation (EU) 260/2012",
    summary: "Since 9 October 2025, EU payment providers must check that the payee name matches the IBAN before a credit transfer. This tool's name and IBAN checks are an upstream, registry-based complement, not a bank VoP response.",
    url: "https://eur-lex.europa.eu/eli/reg/2024/886/oj",
  },
  GDPR_MINIMISATION: {
    title: "Data minimisation",
    ref: "Regulation (EU) 2016/679 (GDPR), art. 5(1)(c) and 25",
    summary: "The report masks the IBAN and only a SHA-256 digest of it enters the attestation. Nothing is stored server-side; nothing personal is written on-chain.",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  },
  GDPR_ART22: {
    title: "No solely automated decision with legal effect",
    ref: "Regulation (EU) 2016/679 (GDPR), art. 22",
    summary: "Where counterparties are natural persons (e.g. sole traders), a decision with legal or similarly significant effect must not rest solely on automated processing: the report always carries a human-review flag and note.",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  },
  GDPR_LAWFUL_BASIS: {
    title: "Lawful basis for the checks",
    ref: "Regulation (EU) 2016/679 (GDPR), art. 6(1)(c) legal obligation (AML) and 6(1)(f) legitimate interest (fraud prevention, recital 47)",
    summary: "Checking a business counterparty against public registries before paying it is covered by a legal obligation for obliged entities and by the legitimate interest in preventing fraud for others.",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  },
};
