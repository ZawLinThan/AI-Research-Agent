export const ResearchRowSkeleton = () => (
  <div className="research-row research-row-skeleton" aria-hidden="true">
    <span className="research-title-cell">
      <span className="document-icon skeleton-block" />
      <span className="skeleton-copy">
        <span className="skeleton-line skeleton-title" />
        <span className="skeleton-line skeleton-meta" />
      </span>
    </span>
    <span className="status-pill skeleton-block skeleton-status" />
    <span className="date-cell skeleton-line skeleton-date" />
    <span className="skeleton-line skeleton-chevron" />
  </div>
);
