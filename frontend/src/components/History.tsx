import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  Search,
} from "lucide-react";
import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
import { labels } from "../lib/researchPresentation";
export const History = ({
  page,
  projects,
  userId,
  onLogin,
  query,
  setQuery,
  loading,
  visible,
  open,
}: Pick<
  WorkspaceViewProps,
  | "page"
  | "projects"
  | "userId"
  | "onLogin"
  | "query"
  | "setQuery"
  | "loading"
  | "visible"
  | "open"
>) => (
  <section className="research-section">
    <div className="section-heading">
      <h2>{page === "Source library" ? "Browse evidence by research" : ""}</h2>
      <span className="number-pill">{projects.length}</span>
    </div>
    {!userId ? (
      <div className="empty-library">
        <BookOpen size={28} />
        <h2>Your next discovery starts here.</h2>
        <p>
          Log in to run research and keep your sources and reports together.
        </p>
        <button className="primary-button" onClick={onLogin}>
          Log in <ArrowRight size={15} />
        </button>
      </div>
    ) : (
      <div className="research-table">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Search research"
              placeholder="Search research…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {loading ? (
          <p className="empty-search" role="status">
            Loading your research…
          </p>
        ) : !visible.length ? (
          <p className="empty-search">
            {query
              ? "No research matches your search."
              : "No research yet. Start with a question above."}
          </p>
        ) : (
          visible.map((p) => (
            <button
              className="research-row"
              key={p.id}
              onClick={() => open(p.id)}
            >
              <span className="research-title-cell">
                <span className="document-icon">
                  <FileText size={18} />
                </span>
                <span>
                  <strong>{p.question}</strong>
                  <small>
                    {p.depth} · {p.scope}
                  </small>
                </span>
              </span>
              <span className="status-pill">{labels[p.status]}</span>
              <span className="date-cell">
                {new Date(p.createdAt).toLocaleDateString()}
              </span>
              <ChevronRight size={15} />
            </button>
          ))
        )}
      </div>
    )}
  </section>
);
