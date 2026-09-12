import { ArrowRight, Globe2, Settings2, Sparkles } from "lucide-react";
import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
export const ResearchComposer = ({
  textarea,
  prompt,
  setPrompt,
  depth,
  setDepth,
  scope,
  setScope,
  busy,
  start,
  userId,
}: Pick<
  WorkspaceViewProps,
  | "textarea"
  | "prompt"
  | "setPrompt"
  | "depth"
  | "setDepth"
  | "scope"
  | "setScope"
  | "busy"
  | "start"
  | "userId"
>) => (
  <>
    <section className="composer" aria-label="Start research">
      <div className="composer-heading">
        <Sparkles size={19} />
        <span>What would you like to understand?</span>
        <span className="draft-tag">NEW RESEARCH</span>
      </div>
      <textarea
        ref={textarea}
        aria-label="Research question"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask a question, explore a topic, or investigate an idea…"
        maxLength={5000}
      />
      <div className="composer-footer">
        <div className="research-options">
          <label>
            <Settings2 size={15} />
            <select
              aria-label="Research depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            >
              <option>Deep research</option>
              <option>Quick overview</option>
            </select>
          </label>
          <label>
            <Globe2 size={15} />
            <select
              aria-label="Source scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option>Web & academic</option>
              <option>Web</option>
              <option>Academic</option>
            </select>
          </label>
        </div>
        <button
          className="primary-button"
          disabled={busy || !userId || !prompt.trim()}
          onClick={start}
        >
          {busy
            ? "Starting…"
            : userId
              ? "Start research"
              : "Log in to research"}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
    <div className="composer-note">
      <span>Source-backed findings. Saved to your account.</span>
      <span>Up to 10 sources · 1 follow-up round</span>
    </div>
  </>
);
