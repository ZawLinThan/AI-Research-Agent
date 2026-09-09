// import "dotenv/config";
// import Exa from "exa-js";
// import { z } from "zod";

// const querySchema = z.string().trim().min(1).max(5000);
// const resultCountSchema = z.number().int().min(1).max(10);
// const urlsSchema = z
//   .array(
//     z
//       .string()
//       .url()
//       .refine((value) => {
//         const url = new URL(value);
//         return (
//           ["https:", "http:"].includes(url.protocol) &&
//           !url.username &&
//           !url.password
//         );
//       }, "Use an HTTP(S) URL without credentials"),
//   )
//   .min(1)
//   .max(10);

// function getClient() {
//   const key = process.env.EXA_API_KEY?.trim();
//   if (!key || key === "YOUR_API_KEY") {
//     throw new Error(
//       "EXA_API_KEY is required for web search. Configure it in the server environment.",
//     );
//   }
//   return new Exa(key);
// }

// /** Retrieve source URLs and excerpts for the agent; this does not synthesize a report. */
// export async function searchWeb(query: string, numResults = 10) {
//   const validatedQuery = querySchema.parse(query);
//   const validatedCount = resultCountSchema.parse(numResults);
//   return getClient().search(validatedQuery, {
//     type: "auto",
//     numResults: validatedCount,
//     contents: { highlights: true },
//   });
// }

// /** Extract highlights for known URLs. Inspect response.statuses for per-URL failures. */
// export async function extractWeb(urls: string[]) {
//   const validatedUrls = urlsSchema.parse(urls);
//   return getClient().getContents([...new Set(validatedUrls)], {
//     highlights: true,
//   });
// }

import Exa from "exa-js";
import { ResearchPlan } from "../types";

export const searchWeb = async (
  projectId: string,
  researchPlan: ResearchPlan,
) => {
  const exa = new Exa(process.env.EXA_API_KEY);

  if (!Array.isArray(researchPlan)) {
    throw new Error("researchPlan must be an array.");
  }

  const result = await Promise.all(
    researchPlan.map((query) =>
      exa.search(query, {
        numResults: 10,
        type: "auto",
        contents: {
          highlights: true,
        },
      }),
    ),
  );

  // Search results: [
  //   {
  //     requestId: '08818d5894959c40f97ef6ca00a464da',
  //     resolvedSearchType: '',
  //     results: [
  //       [Object], [Object],
  //       [Object], [Object],
  //       [Object], [Object],
  //       [Object], [Object],
  //       [Object], [Object]
  //     ],
  //     searchTime: 1028.7,
  //     costDollars: { total: 0.007, search: [Object] }
  //   },

  console.log("Search results:", result);
};
