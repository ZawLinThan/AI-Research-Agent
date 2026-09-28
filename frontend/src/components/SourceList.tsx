import { readableEvidence } from "../../../shared/readableEvidence";
import { SourceLogo } from "./SourceLogo";
import { ArrowUpRight } from "lucide-react";
import type { Source } from "../../../shared/research";
export const SourceList = ({ sources }: { sources: Source[] }) => {
  return (
    <section className="source-panel">
      <div className="section-heading">
        <h2>Sources & evidence</h2>
        <span className="number-pill">{sources.length}</span>
      </div>
      {!sources.length ? (
        <p className="empty-search">
          Sources will appear as research progresses.
        </p>
      ) : (
        sources.map((s) => (
          <article className="source-item" id={`source-${s.id}`} key={s.id}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              <SourceLogo source={s} />
              {readableEvidence(s.title)}
              <ArrowUpRight size={14} />
            </a>
            <small>{new URL(s.url).hostname}</small>
          </article>
        ))
      )}
    </section>
  );
};
