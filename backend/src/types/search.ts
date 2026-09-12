export type QuerySearchSummary = {
  query: string;
  resultCount: number;

  topResults: {
    title: string;
    url: string;
    highlights: string[];
  }[];
};
