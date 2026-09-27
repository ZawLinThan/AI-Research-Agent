const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function textList(value: unknown, limit: number): unknown {
  // Do not hide type errors or stringify arbitrary model output.
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return value;
  return [...new Set(value.map((item) => item.trim()))].slice(0, limit);
}

function gapText(value: unknown): unknown {
  if (!isObject(value)) return value;
  const fields = new Set([
    "gap",
    "question",
    "description",
    "limitation",
    "issue",
    "reason",
    "details",
    "explanation",
    "text",
    "missingEvidence",
  ]);
  const entries = Object.entries(value);
  if (
    !entries.length ||
    !entries.every(
      ([key, text]) =>
        fields.has(key) && typeof text === "string" && text.trim(),
    )
  )
    return value;
  // Preserve every recognized textual field, including qualifications.
  return [...new Set(entries.map(([, text]) => (text as string).trim()))].join(
    " ",
  );
}

export function normalizeEvidenceSelection(
  value: unknown,
  suppliedIds: Set<string>,
): unknown {
  if (!isObject(value)) return value;
  return {
    ...value,
    findings: Array.isArray(value.findings)
      ? value.findings.map((finding) => {
          if (!isObject(finding)) return finding;
          let ids = textList(finding.excerptIds, Number.MAX_SAFE_INTEGER);
          if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
            // Prefer IDs actually supplied in this batch; unsupported IDs are still
            // discarded by grounding, and the retained evidence is verified later.
            const known = ids.filter((id) => suppliedIds.has(id));
            ids = (known.length ? known : ids).slice(0, 2);
          }
          return { ...finding, excerptIds: ids };
        })
      : value.findings,
    gaps: Array.isArray(value.gaps) ? value.gaps.map(gapText) : value.gaps,
  };
}

export function normalizeSearchReview(value: unknown): unknown {
  if (!isObject(value)) return value;
  return { ...value, followUpQueries: textList(value.followUpQueries, 2) };
}
