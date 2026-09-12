import { X } from "lucide-react";
import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
export const HelpDialog = ({
  setHelp,
}: Pick<WorkspaceViewProps, "setHelp">) => (
  <div className="modal-backdrop" onClick={() => setHelp(false)}>
    <section
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") setHelp(false);
        if (e.key === "Tab") e.preventDefault();
      }}
    >
      <button
        autoFocus
        className="dialog-close icon-button"
        aria-label="Close help"
        onClick={() => setHelp(false)}
      >
        <X size={20} />
      </button>
      <h2 id="help-title">From question to evidence.</h2>
      <p>
        Log in, enter a research question, and choose your depth. Fieldwork
        plans searches, gathers excerpts, checks claims, and saves a cited
        report. Progress and results stay available when you leave this page.
      </p>
      <p>
        Quick overview uses two searches. Deep research uses up to four initial
        searches and one follow-up. You can cancel an active run or export a
        completed report.
      </p>
    </section>
  </div>
);
