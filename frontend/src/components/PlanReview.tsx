import { useState } from "react";
import type { ResearchProject } from "../../../shared/research";
import { researchApi } from "../lib/researchApi";

type PlannedQuery = NonNullable<
  NonNullable<ResearchProject["researchPlan"]>["plannedQueries"]
>[number];

export const PlanReview = ({
  project,
  onApproved,
}: {
  project: ResearchProject;
  onApproved: () => void;
}) => {
  const plan = project.researchPlan;
  const structuredComparison =
    plan?.brief?.answerShape === "comparison" &&
    !!plan.plannedQueries?.length &&
    plan.plannedQueries.every(
      (query) => query.entities.length === 1 && !!query.metric,
    );
  const limit = structuredComparison
    ? project.depth === "Quick overview"
      ? 6
      : 12
    : project.depth === "Quick overview"
      ? 4
      : 6;
  const [rows, setRows] = useState<PlannedQuery[]>(plan?.plannedQueries ?? []);
  const [queries, setQueries] = useState(plan?.queries ?? []);
  const [newMetric, setNewMetric] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entities = plan?.brief?.entities ?? [];
  const metrics = [
    ...new Set(
      rows
        .map((row) => row.metric)
        .filter((metric): metric is string => !!metric),
    ),
  ];
  const activeQueries = structuredComparison
    ? rows.map((row) => row.query)
    : queries;
  const valid =
    activeQueries.length > 0 &&
    activeQueries.length <= limit &&
    activeQueries.every(
      (query) => query.trim().length >= 3 && query.length <= 300,
    );

  const updateRow = (index: number, query: string) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, query } : row)));
  };
  const addMetric = () => {
    const metric = newMetric.trim();
    if (
      !metric ||
      metrics.includes(metric) ||
      rows.length + entities.length > limit
    )
      return;
    const period =
      rows[0]?.targetPeriod ?? "latest released annual or interim results";
    setRows([
      ...rows,
      ...entities.map((entity, index) => ({
        id: `Q${rows.length + index + 1}`,
        query: `${entity} ${period} ${metric}`,
        informationNeed: `${entity} ${metric} for ${period}`,
        entities: [entity],
        targetPeriod: period,
        metric,
      })),
    ]);
    setNewMetric("");
  };
  const removeMetric = (metric: string) =>
    setRows(rows.filter((row) => row.metric !== metric));
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      await researchApi(`/${project.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          queries: activeQueries,
          ...(structuredComparison ? { plannedQueries: rows } : {}),
        }),
      });
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve plan.");
      setBusy(false);
    }
  };

  return (
    <section className="report-panel" aria-label="Review research plan">
      <h2>Review your search queries</h2>
      <p>Edit the queries, then approve the plan to start searching the web.</p>
      {plan?.warnings?.length ? (
        <div role="status">
          <strong>Review before approving</strong>
          <ul>
            {plan.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan?.brief?.entityResolutions?.map((entity) => (
        <p key={entity.requestedName}>
          <strong>{entity.requestedName}:</strong>{" "}
          {entity.status === "verified"
            ? `${entity.canonicalName}${entity.ticker ? ` (${entity.ticker})` : ""}. ${entity.note}`
            : `${entity.note} Check the queries before approving.`}{" "}
          {entity.sourceUrl && (
            <a href={entity.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </p>
      ))}
      {structuredComparison ? (
        <>
          {metrics.map((metric) => (
            <div key={metric}>
              <h3>{metric}</h3>
              <button
                disabled={busy || metrics.length === 1}
                onClick={() => removeMetric(metric)}
              >
                Remove metric
              </button>
              {rows.map(
                (row, index) =>
                  row.metric === metric && (
                    <div className="plan-query" key={row.id}>
                      <label htmlFor={`plan-query-${index}`}>
                        {row.entities[0]}
                      </label>
                      <textarea
                        id={`plan-query-${index}`}
                        value={row.query}
                        disabled={busy}
                        maxLength={300}
                        onChange={(event) =>
                          updateRow(index, event.target.value)
                        }
                      />
                    </div>
                  ),
              )}
            </div>
          ))}
          {rows.length + entities.length <= limit && (
            <div>
              <label htmlFor="new-metric">Add a metric for every entity</label>
              <input
                id="new-metric"
                value={newMetric}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setNewMetric(event.target.value)}
              />
              <button disabled={busy || !newMetric.trim()} onClick={addMetric}>
                Add metric
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {queries.map((query, index) => (
            <div className="plan-query" key={index}>
              <label htmlFor={`plan-query-${index}`}>Query {index + 1}</label>
              <textarea
                id={`plan-query-${index}`}
                value={query}
                disabled={busy}
                maxLength={300}
                onChange={(event) =>
                  setQueries(
                    queries.map((item, i) =>
                      i === index ? event.target.value : item,
                    ),
                  )
                }
              />
              <button
                disabled={busy}
                onClick={() =>
                  setQueries(queries.filter((_, i) => i !== index))
                }
              >
                Delete query {index + 1}
              </button>
            </div>
          ))}
          {!queries.length && (
            <p>Keep at least one query to start searching.</p>
          )}
          {queries.length < limit && (
            <button
              disabled={busy}
              onClick={() => setQueries([...queries, ""])}
            >
              Add query
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary-button"
        disabled={busy || !valid}
        onClick={approve}
      >
        {busy ? "Starting research…" : "Approve plan and search"}
      </button>
    </section>
  );
};
