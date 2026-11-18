export const ResearchSkeletonPage = () => (
  <div role="status" aria-label="Loading research">
    <span className="sr-only">Loading research…</span>
    <div className="page-heading research-detail-skeleton" aria-hidden="true">
      <span className="skeleton-line skeleton-eyebrow" />
      <span className="skeleton-line skeleton-detail-title" />
      <span className="skeleton-line skeleton-detail-meta" />
    </div>
    <section className="run-progress research-progress-skeleton" aria-hidden="true">
      <div><span className="skeleton-line skeleton-progress-label" /><span className="skeleton-line skeleton-progress-value" /></div>
      <span className="skeleton-line skeleton-progress-bar" />
      <span className="skeleton-line skeleton-progress-copy" />
    </section>
  </div>
);
