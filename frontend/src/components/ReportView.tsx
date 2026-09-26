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
  console.log("ReportView known sources:", uniqueSources);

  const inline = (line: string) => {
    return line.split(/(\[S[a-f0-9]{12}\])/g).map((part, i) => {
      const id = part.slice(1, -1);

      return uniqueSources.some((source) => source.id === id) ? (
        <a
          className="citation-link"
          href={uniqueSources.find((source) => source.id === id)?.url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          key={i}
          title="View supporting source"
        >
          {part}
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
