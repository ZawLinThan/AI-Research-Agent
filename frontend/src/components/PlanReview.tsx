import { useState } from "react";
import type { ResearchProject } from "../../../shared/research";
import { researchApi } from "../lib/researchApi";

export function PlanReview({ project, onApproved }: { project: ResearchProject; onApproved: () => void }) {
  const [queries, setQueries] = useState(project.researchPlan?.queries ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = queries.length > 0 && queries.every(q => q.trim().length >= 3 && q.trim().length <= 300);
  async function approve() {
    setBusy(true);
    setError("");
    try {
      await researchApi(`/${project.id}/approve`, { method: "POST", body: JSON.stringify({ queries }) });
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve plan.");
      setBusy(false);
    }
  }
  return <section className="report-panel" aria-label="Review research plan">
    <h2>Review your search queries</h2>
    <p>Edit or delete queries, then approve the plan to start searching the web.</p>
    {queries.map((query, index) => <div className="plan-query" key={index}>
      <label htmlFor={`plan-query-${index}`}>Query {index + 1}</label>
      {project.researchPlan?.plannedQueries?.find(q => q.query === query)?.informationNeed && <p>{project.researchPlan.plannedQueries.find(q => q.query === query)?.informationNeed}</p>}
      <textarea id={`plan-query-${index}`} value={query} disabled={busy} maxLength={300} onChange={e => setQueries(queries.map((q, i) => i === index ? e.target.value : q))} />
      <button disabled={busy} onClick={() => setQueries(queries.filter((_, i) => i !== index))}>Delete query {index + 1}</button>
    </div>)}
    {!queries.length && <p>Keep at least one query to start searching.</p>}
    {queries.length < 6 && <button disabled={busy} onClick={() => setQueries([...queries, ""])}>Add query</button>}
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" disabled={busy || !valid} onClick={approve}>{busy ? "Starting research…" : "Approve plan and search"}</button>
  </section>;
}
