import { Compass, Globe2, Layers3 } from "lucide-react";
import type { Brief } from "../types";
export { cn } from "cn";
export const examples: Brief[] = [
  {
    id: "example-1",
    title: "The next chapter of AI in healthcare",
    category: "Industry analysis",
    date: "Example brief",
    prompt:
      "Explore how AI is changing clinical workflows, the barriers to adoption, and opportunities for emerging companies.",
    depth: "Deep research",
    scope: "Web & academic",
    example: true,
  },
  {
    id: "example-2",
    title: "A landscape of sustainable packaging",
    category: "Market landscape",
    date: "Example brief",
    prompt:
      "Compare emerging sustainable packaging materials, their commercial readiness, and adoption challenges.",
    depth: "Deep research",
    scope: "Web & academic",
    example: true,
  },
  {
    id: "example-3",
    title: "Understanding the agentic workflow",
    category: "Technology",
    date: "Example brief",
    prompt:
      "Investigate the building blocks of AI agent workflows and compare approaches to orchestration and evaluation.",
    depth: "Quick overview",
    scope: "Web",
    example: true,
  },
];
export const templates = [
  {
    icon: Compass,
    title: "Explore a topic",
    description: "Get the full picture of something new.",
    prompt:
      "Give me a comprehensive overview of [topic], including key concepts, recent developments, and open questions.",
  },
  {
    icon: Layers3,
    title: "Compare options",
    description: "Find the differences that matter.",
    prompt:
      "Compare [option A] and [option B] across capabilities, trade-offs, pricing, and ideal use cases.",
  },
  {
    icon: Globe2,
    title: "Map a market",
    description: "Understand players, trends, and gaps.",
    prompt:
      "Map the market for [industry]. Identify leading companies, emerging trends, customer needs, and opportunities.",
  },
];
