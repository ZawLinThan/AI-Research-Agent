export const PageHeading = ({ page }: { page: string }) => (
  <div className="page-heading">
    <h1>{page === "Overview" ? "Good questions. Clearer answers." : page}</h1>
    <p>
      {page === "Overview"
        ? "Go from a spark of curiosity to a well-informed perspective."
        : page === "Source library"
          ? "Open a research project to explore its saved evidence."
          : ""}
    </p>
  </div>
);
