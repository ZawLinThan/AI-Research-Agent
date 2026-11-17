import { aliasesFor } from "../services/planner.service.js";
import type { EvidenceRecord } from "../types/research.js";

const banks = ["JPMorgan Chase", "Bank of America", "Wells Fargo"];

const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function namedBanks(text: string) {
  const value = ` ${normalized(text)} `;

  return banks.filter((bank) =>
    aliasesFor(bank).some((alias) => value.includes(` ${normalized(alias)} `)),
  );
}

export function canonicalEntity(entity: string) {
  const identified = namedBanks(entity);

  if (identified.length === 1) {
    return identified[0]!;
  }

  return aliasesFor(entity)[1] ?? entity.trim();
}

export function sourceOwner(url: string, title: string): string | undefined {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();

  for (const [domain, owner] of [
    ["jpmorganchase.com", banks[0]],
    ["jpmorgan.com", banks[0]],
    ["bankofamerica.com", banks[1]],
    ["wellsfargo.com", banks[2]],
  ]) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return owner;
    }
  }

  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    const cik = parsed.pathname.match(/\/Archives\/edgar\/data\/(\d+)/i)?.[1];
    const secOwners: Record<string, string> = {
      "19617": banks[0]!,
      "70858": banks[1]!,
      "72971": banks[2]!,
    };

    if (cik && secOwners[cik]) {
      return secOwners[cik];
    }
  }

  const names = namedBanks(title);

  return names.length === 1 ? names[0] : undefined;
}

export function attributionIssue(
  record: EvidenceRecord,
  requireExplicit = false,
): string | undefined {
  if (!record.entity) {
    return undefined;
  }

  const entity = canonicalEntity(record.entity);
  const quoted = namedBanks(record.quote);
  const claimed = namedBanks(record.claim);

  if (banks.includes(entity) && claimed.length && !claimed.includes(entity)) {
    return "Claim entity differs from its evidence metadata.";
  }

  if (
    banks.includes(entity) &&
    quoted.length === 1 &&
    !quoted.includes(entity)
  ) {
    return "Quoted evidence explicitly names a different bank.";
  }

  const owner = sourceOwner(record.sourceUrl, record.sourceTitle);

  if (
    owner &&
    banks.includes(entity) &&
    owner !== entity &&
    !quoted.includes(entity)
  ) {
    return "Source belongs to a different bank and the quote does not identify the claimed bank.";
  }

  if (
    requireExplicit &&
    banks.includes(entity) &&
    !quoted.includes(entity) &&
    owner !== entity
  ) {
    return "The source and quote do not establish the bank's identity.";
  }

  return undefined;
}

export function metricKey(metric: string) {
  const value = normalized(metric);
  const aliases: Record<string, string> = {
    nii: "net interest income",
    eps: "diluted eps",
    "diluted earnings per share": "diluted eps",
    "total revenue": "revenue",
    "total net revenue": "revenue",
    "net revenue": "revenue",
    nim: "net interest margin",
    "net income attributable to common shareholders":
      "net income attributable to common shareholders",
  };

  return aliases[value] ?? value;
}

export function periodKey(period: string) {
  const spelledQuarter = period.match(
    /\b(first|second|third|fourth|1st|2nd|3rd|4th)[-\s]+quarter(?:\s+of)?[-\s]+(20\d{2})\b/i,
  );

  if (spelledQuarter) {
    const number: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      "1st": 1,
      "2nd": 2,
      "3rd": 3,
      "4th": 4,
    };

    return `Q${number[spelledQuarter[1]!.toLowerCase()]} ${spelledQuarter[2]}`;
  }

  const comparison = period.match(
    /^(?:FY\s*)?(20\d{2})\s*(?:vs\.?|versus|compared (?:to|with))\s*(?:FY\s*)?20\d{2}$/i,
  );

  if (comparison) {
    return `FY ${comparison[1]}`;
  }

  const quarter = period.match(
    /(?:Q([1-4])\s*(20\d{2}|\d{2})|([1-4])Q\s*(20\d{2}|\d{2}))/i,
  );

  if (quarter) {
    const year = quarter[2] ?? quarter[4]!;

    return `Q${quarter[1] ?? quarter[3]} ${year.length === 2 ? `20${year}` : year}`;
  }

  const year = period.match(/(?:FY\s*)?(20\d{2})/i);

  if (
    year &&
    /^(?:FY\s*)?20\d{2}$|full year|fiscal year|annual|year ended/i.test(
      period.trim(),
    )
  ) {
    return `FY ${year[1]}`;
  }

  return normalized(period);
}

export function basisKey(basis: string) {
  const value = normalized(basis);

  if (!value || value === "basis unspecified" || value === "unspecified") {
    return "Basis unspecified";
  }

  if (/\b(?:non gaap|adjusted)\b/.test(value)) {
    return "adjusted / non-GAAP";
  }

  if (/\b(?:fte|taxable equivalent)\b/.test(value)) {
    return "taxable-equivalent";
  }

  if (/\bsegment\b/.test(value)) {
    return value;
  }

  if (
    /\b(?:gaap|consolidated|full year|year ended|quarterly trends|in millions|in billions|financial highlights)\b/.test(
      value,
    )
  ) {
    return "reported consolidated";
  }

  return value;
}

export function evidenceGroups(records: EvidenceRecord[]) {
  const groups = new Map<string, EvidenceRecord[]>();

  for (const record of records) {
    const key = [
      metricKey(record.metric ?? "unspecified"),
      periodKey(record.period ?? "unspecified"),
      basisKey(record.basis ?? "unspecified"),
    ].join(" | ");
    const group = groups.get(key) ?? [];
    const duplicate = group.some(
      (e) =>
        canonicalEntity(e.entity ?? "") ===
          canonicalEntity(record.entity ?? "") &&
        normalized(e.value ?? e.claim) ===
          normalized(record.value ?? record.claim),
    );

    if (!duplicate) {
      group.push(record);
    }

    groups.set(key, group);
  }

  return groups;
}

export function growthConsistencyIssue(claim: string): string | undefined {
  const match = claim.match(
    /\$([\d,.]+)\s*(billion|million)\b.{0,50}?\b(up|down)\s*([\d.]+)%\s*(?:YoY|year.over.year)?\s*from\s*\$([\d,.]+)\s*(billion|million)\b/i,
  );

  if (!match || match[2]!.toLowerCase() !== match[6]!.toLowerCase()) {
    return undefined;
  }

  const current = Number(match[1]!.replace(/,/g, "")),
    prior = Number(match[5]!.replace(/,/g, ""));

  if (!prior) {
    return undefined;
  }

  const stated =
    Number(match[4]) * (match[3]!.toLowerCase() === "down" ? -1 : 1);
  const calculated = (current / prior - 1) * 100;

  // Allow rounded published values. Large discrepancies require corrected evidence.
  return Math.abs(stated - calculated) > 2
    ? "Stated growth rate does not match the quoted current and prior values."
    : undefined;
}
