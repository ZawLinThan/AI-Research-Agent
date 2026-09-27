import { SourceLogo } from "./SourceLogo";
import type { Source } from "../../../shared/research";
export const ReportView = ({
  report,
  sources,
}: {
  report: string;
  sources: Source[];
}) => {
  const seen = new Set();

  const uniqueSources = sources.filter((obj) => {
    if (seen.has(obj.id)) {
      return false;
    }
    seen.add(obj.id);
    return true;
  });

  const inline = (line: string) => {
    return line.split(/(\[S[a-f0-9]{12}\])/g).map((part, i) => {
      const id = part.slice(1, -1);

      const source = uniqueSources.find((source) => source.id === id);
      return source ? (
        <a
          className="citation-link"
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          key={i}
          title={source.title}
          aria-label={`Source: ${source.title}`}
        >
          <SourceLogo source={source} />
        </a>
      ) : (
        part
      );
    });
  };

  return (
    <div className="report-content">
      {report.split("\n\n").map((block, i) => {
        if (block.startsWith("## ")) return <h3 key={i}>{block.slice(3)}</h3>;
        if (block.startsWith("# ")) return <h2 key={i}>{block.slice(2)}</h2>;
        const lines = block.split("\n");
        if (lines.every((line) => line.startsWith("- ")))
          return (
            <ul key={i}>
              {lines.map((line, j) => (
                <li key={j}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
};
