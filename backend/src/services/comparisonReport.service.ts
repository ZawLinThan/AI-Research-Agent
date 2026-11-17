import { z } from "zod";
import { structured } from "../config/openRouterAI.js";
import { hasMultipleMetrics } from "./planner.service.js";
import {
  basisKey,
  canonicalEntity,
  metricKey,
  periodKey,
} from "../lib/evidenceIdentity.js";
import type { Analysis } from "../zodSchema/research.schema.js";
import type { Checkpoint, ReportLayout } from "../types/research.js";

export function comparisonRows(analysis: Analysis, state: Checkpoint) {
  const entities = [
    ...new Set(state.plan!.brief!.entities.map(canonicalEntity)),
  ];
  const records = new Map((state.evidenceRecords ?? []).map((e) => [e.id, e]));
  const groups = new Map<
    string,
    NonNullable<ReportLayout["comparison"]>["rows"][number]
  >();
  const seen = new Set<string>();

  analysis.findings.forEach((finding, index) => {
    if (hasMultipleMetrics(finding.claim)) {
      return;
    }

    const key = finding.claim.toLowerCase().replace(/\s+/g, " ").trim();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    const linked =
      state.reportClaims
        ?.find((c) => c.text === finding.claim)
        ?.evidenceIds.map((id) => records.get(id))
        .filter((e) => !!e) ?? [];

    if (!linked.length) {
      return;
    }

    const metrics = new Set(linked.map((e) => metricKey(e.metric ?? "")));
    const periods = new Set(linked.map((e) => periodKey(e.period ?? "")));
    const bases = new Set(
      linked.map((e) => basisKey(e.basis ?? "Basis unspecified")),
    );

    // A single row cannot compare different metrics, periods or accounting bases.
    if (metrics.size !== 1 || periods.size !== 1 || bases.size !== 1) {
      return;
    }

    const metric = [...metrics][0]!,
      period = [...periods][0]!,
      basis = [...bases][0]!;
    const groupKey = JSON.stringify([metric, period, basis]);
    const row = groups.get(groupKey) ?? {
      metric,
      period,
      basis,
      cells: entities.map((entity) => ({ entity, findingIndexes: [] })),
      sharedFindingIndexes: [],
    };
    const covered = [
      ...new Set(linked.map((e) => canonicalEntity(e.entity ?? ""))),
    ].filter((e) => entities.includes(e));

    if (covered.length === 1) {
      const cell = row.cells.find((c) => c.entity === covered[0])!;
      const values = linked
        .map((e) => e.value?.toLowerCase().replace(/[,$\s]/g, ""))
        .filter(Boolean)
        .sort()
        .join("|");
      const duplicate = values
        ? cell.findingIndexes.find((existing) => {
            const ids =
              state.reportClaims!.find(
                (c) => c.text === analysis.findings[existing]!.claim,
              )?.evidenceIds ?? [];

            return (
              ids
                .map((id) =>
                  records
                    .get(id)
                    ?.value?.toLowerCase()
                    .replace(/[,$\s]/g, ""),
                )
                .filter(Boolean)
                .sort()
                .join("|") === values
            );
          })
        : undefined;

      if (duplicate === undefined) {
        cell.findingIndexes.push(index);
      } else if (
        finding.claim.length > analysis.findings[duplicate]!.claim.length
      ) {
        cell.findingIndexes[cell.findingIndexes.indexOf(duplicate)] = index;
      }
    } else if (covered.length > 1) {
      row.sharedFindingIndexes.push(index);
    }

    // Coverage comes from retained claims, never unverified extraction records.
    row.coveredEntities = [
      ...new Set([...(row.coveredEntities ?? []), ...covered]),
    ];

    groups.set(groupKey, row);
  });

  const plannedMetrics = [
    ...new Set(
      state.plan!.plannedQueries?.flatMap((q) =>
        q.metric ? [metricKey(q.metric)] : [],
      ) ?? [],
    ),
  ];
  for (const metric of plannedMetrics) {
    if (![...groups.values()].some((row) => row.metric === metric)) {
      groups.set(metric, {
        metric,
        period: "Not established",
        basis: "Basis unspecified",
        cells: entities.map((entity) => ({ entity, findingIndexes: [] })),
        sharedFindingIndexes: [],
        coveredEntities: [],
      });
    }
  }

  const order = (period: string) =>
    Number(period.match(/20\d{2}/)?.[0] ?? 0) * 10 +
    (period.startsWith("Q") ? Number(period[1]) : 0);
  const rows = [...groups.values()].sort(
    (a, b) =>
      plannedMetrics.indexOf(a.metric) - plannedMetrics.indexOf(b.metric) ||
      order(b.period) - order(a.period) ||
      a.basis.localeCompare(b.basis),
  );
  return { entities, rows, currentDate: state.plan!.brief!.currentDate };
}

export async function createComparisonReportLayout(
  question: string,
  analysis: Analysis,
  state: Checkpoint,
  signal?: AbortSignal,
): Promise<ReportLayout> {
  const comparison = comparisonRows(analysis, state);
  const used = new Set(
    comparison.rows.flatMap((row) => [
      ...row.cells.flatMap((cell) => cell.findingIndexes),
      ...row.sharedFindingIndexes,
    ]),
  );
  const findings = [...used].map((index) => ({
    index,
    claim: analysis.findings[index]!.claim,
  }));
  const complete = comparison.rows.filter((row) =>
    comparison.entities.every((entity) =>
      row.coveredEntities?.includes(entity),
    ),
  );
  const incomplete = comparison.rows.filter(
    (row) =>
      !comparison.entities.every((entity) =>
        row.coveredEntities?.includes(entity),
      ),
  );
  const coverageSummary = complete.length
    ? `The retained evidence covers all requested entities for ${[...new Set(complete.map((row) => `${row.metric} (${row.period})`))].join(", ")}.${incomplete.length ? " Other metric-period comparisons have gaps, shown in the table." : ""}`
    : "The retained evidence supports individual findings, but no metric-period group covers every requested entity. The table shows available findings and the remaining gaps.";
  const limitations = incomplete.map(
    (row) =>
      `${row.metric} (${row.period}): no supported finding for ${comparison.entities.filter((entity) => !row.coveredEntities?.includes(entity)).join(", ")}.`,
  );

  if (
    comparison.rows.some(
      (row) =>
        row.basis === "Basis unspecified" &&
        (row.coveredEntities?.length ?? 0) > 1,
    )
  ) {
    limitations.push(
      "Some source excerpts do not establish a common accounting basis; their figures should not be treated as directly comparable.",
    );
  }

  const year = comparison.currentDate.slice(0, 4);

  if (
    !comparison.rows.some(
      (row) => row.period.startsWith("Q") && row.period.includes(year),
    ) &&
    !/\b20\d{2}\b/.test(question)
  ) {
    limitations.push(
      `No ${year} interim reporting period appears in the retained evidence. The latest available quarter as of ${comparison.currentDate} has not been established.`,
    );
  }

  const schema = z.object({
    summary: z.string().trim().min(1).max(1200),
    overview: z.array(z.number().int().nonnegative()).min(1).max(30),
  });
  let summary = coverageSummary,
    overview: number[] = [];
  let feedback: unknown;

  // One introduction repair at most. Coverage gaps are reported separately;
  // they cannot invalidate a supported, appropriately qualified introduction.
  for (let attempt = 0; findings.length && attempt < 2; attempt++) {
    const candidate = await structured(
      "Write a concise introduction to the comparison using ONLY supplied verified findings. Return summary and overview (supporting finding indexes). Discuss the main supported differences. Do not describe missing evidence, unavailable figures, or which entities lack coverage; a deterministic coverage statement will be appended separately. Do not rank entities or recommend investments unless a supplied finding directly supports it. Preserve metric definitions and periods. Every factual assertion must be supported by the listed indexes. Apply review feedback if present.",
      {
        question,
        currentDate: comparison.currentDate,
        findings,
        coverage: coverageSummary,
        limitations,
        feedback,
      },
      schema,
      signal,
      1000,
    );
    const indexes = [...new Set(candidate.overview)];

    if (!indexes.length || indexes.some((index) => !used.has(index))) {
      feedback = { reason: "Use only the supplied finding indexes." };
      continue;
    }

    if (
      /\b(?:no supported|not established|missing|unavailable|no evidence|lacks?|incomplete)\b/i.test(
        candidate.summary,
      )
    ) {
      feedback = {
        reason:
          "Describe supported findings only; coverage language is added separately.",
      };
      continue;
    }

    const validEvidenceIds = new Set(
      state.evidenceRecords?.map((record) => record.id) ?? [],
    );
    const validReferences =
      indexes.every((index) => used.has(index)) &&
      (state.reportClaims?.every(
        (claim) =>
          claim.evidenceIds.length > 0 &&
          claim.evidenceIds.every((id) => validEvidenceIds.has(id)),
      ) ??
        true);
    // A repaired introduction gets a reference check; this cannot establish prose grounding.
    const review =
      attempt > 0 && validReferences
        ? { valid: true, reason: "Valid references." }
        : await structured(
            "Check ONLY whether every assertion in this introduction is supported by its linked verified findings or supplied coverage metadata. Return valid and reason. Incomplete evidence is acceptable when clearly qualified; do not reject for failing to answer dimensions with no evidence. Reject unsupported comparisons, changed entities/numbers/periods, invented rankings, causal leaps and recommendations. Do not reject accurate wording merely because it resembles the verified claims.",
            {
              question,
              summary: candidate.summary,
              findings: indexes.map((index) => ({
                index,
                claim: analysis.findings[index]!.claim,
              })),
              coverage: coverageSummary,
              limitations,
            },
            z.object({ valid: z.boolean(), reason: z.string() }),
            signal,
            400,
          );
    if (review.valid) {
      summary = `${candidate.summary} ${coverageSummary}`;
      overview = indexes;
      break;
    }

    feedback = review;
  }

  console.info(
    JSON.stringify({
      event: "comparison_report_ready",
      rows: comparison.rows.length,
      completeRows: complete.length,
      introduction: overview.length ? "verified" : "coverage",
    }),
  );
  return {
    summary,
    overview,
    sections: [],
    comparison,
    limitations,
    reportVersion: 2,
  };
}
