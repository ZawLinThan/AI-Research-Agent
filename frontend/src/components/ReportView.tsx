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
          [{uniqueSources.indexOf(source) + 1}]
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
        if (
          lines.length >= 2 &&
          lines[0].startsWith("|") &&
          /^\|\s*:?-{3,}/.test(lines[1])
        ) {
          const cells = (line: string) =>
            line
              .replace(/^\|\s*|\s*\|$/g, "")
              .split(/(?<!\\)\|/)
              .map((cell) => cell.trim().replace(/\\\|/g, "|"));
          const headers = cells(lines[0]);
          return (
            <div className="comparison-table-scroll" key={i}>
              <table className="comparison-table">
                <thead>
                  <tr>
                    {headers.map((header, j) => (
                      <th key={j} scope="col">
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines
                    .slice(2)
                    .filter((line) => line.startsWith("|"))
                    .map((line, j) => (
                      <tr key={j}>
                        {cells(line).map((cell, k) =>
                          k === 0 ? (
                            <th key={k} scope="row">
                              {inline(cell)}
                            </th>
                          ) : (
                            <td key={k}>{inline(cell)}</td>
                          ),
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((line) => /^\s*- /.test(line))) {
          return (
            <ul key={i}>
              {lines.flatMap((line, j) => {
                if (line.startsWith("  ")) {
                  return [];
                }

                const children = [];
                for (
                  let k = j + 1;
                  k < lines.length && lines[k].startsWith("  ");
                  k++
                ) {
                  children.push(lines[k].trim().slice(2));
                }

                return [
                  <li key={j}>
                    {inline(line.slice(2))}
                    {children.length > 0 && (
                      <ul>
                        {children.map((child, k) => (
                          <li key={k}>{inline(child)}</li>
                        ))}
                      </ul>
                    )}
                  </li>,
                ];
              })}
            </ul>
          );
        }

        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
};
