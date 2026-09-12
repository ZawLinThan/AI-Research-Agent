import { ArrowUpRight, Compass, Globe2, Layers3 } from "lucide-react";
import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
const templates = [
  {
    icon: Compass,
    title: "Explore a topic",
    description: "Get the full picture of something new.",
    prompt: "Explain the key developments, evidence, and open questions about ",
  },
  {
    icon: Layers3,
    title: "Compare options",
    description: "Find the differences that matter.",
    prompt: "Compare the benefits, limitations, and available evidence for ",
  },
  {
    icon: Globe2,
    title: "Map a market",
    description: "Understand players, trends, and gaps.",
    prompt:
      "Research the leading organizations, recent changes, and opportunities in ",
  },
];
export const Templates = ({
  newResearch,
}: Pick<WorkspaceViewProps, "newResearch">) => (
  <section className="starter-section">
    <div className="section-heading">
      <h2>A starting point for your curiosity</h2>
    </div>
    <div className="template-grid">
      {templates.map(({ icon: Icon, title, description, prompt: value }) => (
        <button
          className="template-card"
          key={title}
          onClick={() => newResearch(value)}
        >
          <span className="template-icon">
            <Icon size={20} />
          </span>
          <ArrowUpRight className="card-arrow" size={16} />
          <h3>{title}</h3>
          <p>{description}</p>
        </button>
      ))}
    </div>
  </section>
);
