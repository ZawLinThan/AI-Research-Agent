import { PlanReview } from "../../components/PlanReview";
import { ArrowLeft, Download } from "lucide-react";
import { ReportView } from "../../components/ReportView";
import { ResearchProgress } from "../../components/ResearchProgress";
import { SourceList } from "../../components/SourceList";
import type { WorkspaceViewProps } from "../../hooks/useResearchWorkspace";
export const ResearchPage = (view: WorkspaceViewProps) => {
  const { open, userId, onLogin, detail, download } = view;
  return (
    <>
      <button className="back-link" onClick={() => open(null)}>
        <ArrowLeft size={15} />
        All research
      </button>
      {!userId ? (
        <section className="empty-library">
          <h2>Log in to view your research.</h2>
          <button className="primary-button" onClick={onLogin}>
            Log in
          </button>
        </section>
      ) : !detail ? (
        <p role="status">Loading research…</p>
      ) : (
        <>
          <div className="page-heading">
            <div className="eyebrow">{detail.depth.toUpperCase()}</div>
            <h1>{detail.question}</h1>
            <p>
              {detail.scope} · {new Date(detail.createdAt).toLocaleDateString()}
            </p>
          </div>
          <ResearchProgress {...view} />
          {detail.status === "awaiting_approval" && <PlanReview key={detail.id} project={detail} onApproved={() => view.setReload(v => v + 1)} />}
          {detail.report && (
            <section className="report-panel">
              <div className="section-heading">
                <h2>Research report</h2>
                <button onClick={download}>
                  <Download size={15} /> Export Markdown
                </button>
              </div>
              <ReportView
                report={detail.report}
                sources={detail.sources || []}
              />
            </section>
          )}
          <SourceList sources={detail.sources || []} />
        </>
      )}
    </>
  );
};
