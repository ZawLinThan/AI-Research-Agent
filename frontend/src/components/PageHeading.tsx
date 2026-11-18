export const PageHeading = ({ page }: { page: string }) => (
  <div className="page-heading">
    <span className="page-kicker">{page === "Overview" ? "YOUR RESEARCH WORKSPACE" : "FIELDWORK / WORKSPACE"}</span>
    <h1>{page === "Overview" ? "Make sense of what matters." : page}</h1>
    <p>
      {page === "Overview"
        ? "Ask a question. Explore the evidence. Build a clearer point of view."
        : page === "Source library"
          ? "Open a research project to explore its saved evidence."
          : ""}
    </p>
  </div>
);
