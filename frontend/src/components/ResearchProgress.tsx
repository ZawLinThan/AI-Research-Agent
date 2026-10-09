import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
import { done, labels } from "../lib/researchPresentation";
export const ResearchProgress = ({
  detail,
  busy,
  cancel,
  newResearch,
}: Pick<WorkspaceViewProps, "detail" | "busy" | "cancel" | "newResearch">) =>
  detail && (
    <section className="run-progress" aria-label="Research progress">
      <div>
        <strong>{labels[detail.status]}</strong>
        <span>{detail.progress}%</span>
      </div>
      <progress max={100} value={detail.progress} />
      <p>
        {detail.status === "awaiting_approval" ? "Your plan is ready. Review the queries below before searching begins." : detail.status === "pending"
          ? detail.error
            ? "This run encountered a temporary problem and is waiting for an automatic retry."
            : "Your research is saved and queued for processing."
          : detail.status === "completed"
            ? "Your report and supporting sources are saved to your account."
            : detail.status === "cancelled"
              ? "This run was cancelled. Sources already collected remain available."
              : detail.error ||
                "Collecting and checking evidence. You can leave this page and return later."}
      </p>
      {!!detail.stages?.length && <details>
        <summary>Inspect research stages</summary>
        {detail.stages.map(stage => <details key={stage.stage}>
          <summary>{stage.stage.replace(/_/g, " ")}</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(stage.payload, null, 2)}</pre>
        </details>)}
      </details>}
      {!done(detail.status) && (
        <button className="secondary-button" disabled={busy} onClick={cancel}>
          Cancel research
        </button>
      )}
      {done(detail.status) && detail.status !== "completed" && (
        <button
          className="secondary-button"
          onClick={() => newResearch(detail.question)}
        >
          Edit question and start again
        </button>
      )}
    </section>
  );
