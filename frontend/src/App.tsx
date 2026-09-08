import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  FileText,
  FlaskConical,
  FolderOpen,
  Globe2,
  Layers3,
  Menu,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";

type Brief = {
  id: string;
  title: string;
  category: string;
  date: string;
  prompt: string;
  depth: string;
  scope: string;
  example?: boolean;
};
const examples: Brief[] = [
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
const templates = [
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
function readBriefs(): Brief[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("fieldwork-briefs") || "[]",
    );
    return Array.isArray(data)
      ? data.filter(
          (b): b is Brief =>
            !!b &&
            typeof b === "object" &&
            [
              "id",
              "title",
              "category",
              "date",
              "prompt",
              "depth",
              "scope",
            ].every((k) => typeof b[k] === "string"),
        )
      : [];
  } catch {
    return [];
  }
}
function App({ accountControls }: { accountControls?: ReactNode }) {
  const [page, setPage] = useState("Overview");
  const [prompt, setPrompt] = useState("");
  const [depth, setDepth] = useState("Deep research");
  const [scope, setScope] = useState("Web & academic");
  const [briefs, setBriefs] = useState<Brief[]>(readBriefs);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Brief | null>(null);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    if (!selected && !help) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setHelp(false);
      }
      if (event.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(".dialog button, .dialog a"),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [selected, help]);
  function navigate(next: string) {
    setPage(next);
    setQuery("");
    setMenu(false);
  }
  function newResearch(value = "") {
    navigate("Overview");
    setPrompt(value);
    setTimeout(() => textarea.current?.focus(), 0);
  }
  function saveBrief() {
    if (!prompt.trim()) return;
    const brief: Brief = {
      id: crypto.randomUUID(),
      title: prompt.trim().split("\n")[0].slice(0, 85),
      prompt: prompt.trim(),
      category: "Research draft",
      date: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      depth,
      scope,
    };
    const next = [brief, ...briefs];
    setBriefs(next);
    setPrompt("");
    setSelected(brief);
    try {
      localStorage.setItem("fieldwork-briefs", JSON.stringify(next));
      setNotice("Research brief saved to this browser.");
    } catch {
      setNotice(
        "Brief created. Browser storage is unavailable; this draft will not persist.",
      );
    }
  }
  function download(brief: Brief) {
    const text = `# ${brief.title}\n\n${brief.example ? "Example brief" : "Research draft"}\n\n## Research question\n${brief.prompt}\n\n## Configuration\n- Depth: ${brief.depth}\n- Sources: ${brief.scope}\n\nResearch has not been run. Connect a research engine to generate findings and citations.\n`;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "research-brief.md";
    a.click();
    URL.revokeObjectURL(url);
  }
  const visible = [...briefs, ...examples].filter((b) =>
    `${b.title} ${b.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-mark">
            <FlaskConical size={21} />
          </span>
          fieldwork<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            Personal workspace<small>Your space for discovery</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <button className="new-button" onClick={() => newResearch()}>
          <Plus size={17} /> New research <span>↗</span>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            { title: "Overview", icon: Compass },
            { title: "My research", icon: FolderOpen },
            { title: "Source library", icon: BookOpen },
            { title: "Templates", icon: Layers3 },
          ].map(({ title, icon: Icon }) => (
            <button
              key={title}
              className={page === title ? "nav-item active" : "nav-item"}
              onClick={() => navigate(title)}
            >
              <Icon size={18} />
              {title}
              {title === "My research" && (
                <span className="count">{briefs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label recent-label">RECENT RESEARCH</div>
        <div className="sidebar-recents">
          {[...briefs, ...examples].slice(0, 3).map((b) => (
            <button key={b.id} onClick={() => setSelected(b)}>
              <span className="tiny-dot" />
              {b.title}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <span className="small-spark">
              <Sparkles size={17} />
            </span>
            <strong>A little curiosity goes a long way.</strong>
            <p>Turn your next question into a clearer perspective.</p>
            <button onClick={() => navigate("Templates")}>
              Explore templates <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} /> Help & getting started{" "}
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">Y</span>
            <div>
              Your workspace<small>Personal account</small>
            </div>
            <span className="local-label">LOCAL</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={13} />
            <span>{page}</span>
          </div>
          {accountControls ?? (
            <div className="topbar-right">
              <span className="preview-dot" />
              Frontend preview
              <span className="header-divider" />
              <span className="small-avatar">Y</span>
            </div>
          )}
        </header>
        <main>
          <div className="page-heading">
            <div className="eyebrow">YOUR RESEARCH, REIMAGINED</div>
            <h1>
              {page === "Overview" ? "Good questions. Clearer answers." : page}
            </h1>
            <p>
              {page === "Overview"
                ? "Go from a spark of curiosity to a well-informed perspective."
                : page === "My research"
                  ? "A home for your questions, ideas, and research briefs."
                  : page === "Templates"
                    ? "Start with a thoughtful question. Make it your own."
                    : "Keep the evidence behind your thinking in one place."}
            </p>
          </div>
          {page === "Overview" && (
            <>
              <section className="composer" aria-label="Create research brief">
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
                    <span className="option-divider" />
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
                    disabled={!prompt.trim()}
                    onClick={saveBrief}
                  >
                    Create brief <ArrowRight size={16} />
                  </button>
                </div>
              </section>
              <div className="composer-note">
                <span>
                  <Bookmark size={13} /> A clear question is the start of great
                  research.
                </span>
                <span>Drafts saved on this device</span>
              </div>
              <section className="starter-section">
                <div className="section-heading">
                  <h2>A starting point for your curiosity</h2>
                  <button onClick={() => navigate("Templates")}>
                    All templates <ArrowRight size={14} />
                  </button>
                </div>
                <div className="template-grid">
                  {templates.map(
                    ({ icon: Icon, title, description, prompt: value }) => (
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
                    ),
                  )}
                </div>
              </section>
            </>
          )}
          {(page === "Overview" || page === "My research") && (
            <section className="research-section">
              <div className="section-heading">
                <div className="heading-inline">
                  <h2>
                    {page === "Overview"
                      ? "Recent research"
                      : "Research briefs"}
                  </h2>
                  <span className="number-pill">
                    {briefs.length + examples.length}
                  </span>
                </div>
                {page === "Overview" ? (
                  <button onClick={() => navigate("My research")}>
                    View all research <ArrowRight size={14} />
                  </button>
                ) : (
                  <button onClick={() => newResearch()}>
                    <Plus size={15} /> New brief
                  </button>
                )}
              </div>
              <div className="research-table">
                <div className="table-toolbar">
                  <span>
                    All research{" "}
                    <span className="toolbar-count">{visible.length}</span>
                  </span>
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="Search research"
                      placeholder="Search research…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="table-head">
                  <span>RESEARCH BRIEF</span>
                  <span>STATUS</span>
                  <span>UPDATED</span>
                  <span />
                </div>
                {visible.length ? (
                  visible
                    .slice(0, page === "Overview" ? 4 : undefined)
                    .map((b, i) => (
                      <button
                        className="research-row"
                        key={b.id}
                        onClick={() => setSelected(b)}
                      >
                        <span className="research-title-cell">
                          <span className={`document-icon tone-${i % 3}`}>
                            <FileText size={19} />
                          </span>
                          <span>
                            <strong>{b.title}</strong>
                            <small>
                              {b.category} <span>·</span> {b.scope}
                            </small>
                          </span>
                        </span>
                        <span
                          className={`status-pill ${b.example ? "example" : ""}`}
                        >
                          <span />
                          {b.example ? "Example" : "Draft"}
                        </span>
                        <span className="date-cell">{b.date}</span>
                        <ChevronRight size={16} />
                      </button>
                    ))
                ) : (
                  <div className="empty-search">
                    No briefs match “{query}”. Try a different search.
                  </div>
                )}
              </div>
              <p className="example-note">
                Example briefs show how your workspace can be organized. They do
                not contain generated research.
              </p>
            </section>
          )}
          {page === "Templates" && (
            <div className="template-grid full-templates">
              {templates.map(
                ({ icon: Icon, title, description, prompt: value }) => (
                  <button
                    className="template-card"
                    key={title}
                    onClick={() => newResearch(value)}
                  >
                    <span className="template-icon">
                      <Icon size={23} />
                    </span>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <p className="template-prompt">{value}</p>
                    <span className="template-link">
                      Use template <ArrowRight size={15} />
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
          {page === "Source library" && (
            <section className="empty-library">
              <span className="library-icon">
                <BookOpen size={30} />
              </span>
              <h2>Every insight starts with a source.</h2>
              <p>
                Your research sources will live here, ready to revisit.
                <br />
                Create a brief to start defining what you want to explore.
              </p>
              <button className="primary-button" onClick={() => newResearch()}>
                Create a research brief <ArrowRight size={16} />
              </button>
              <small>
                Source collection will be available when the research engine is
                connected.
              </small>
            </section>
          )}
          <footer className="main-footer">
            <span className="footer-brand">
              <FlaskConical size={14} /> Built for curious minds.
            </span>
            <span>A little more context. A lot more clarity.</span>
          </footer>
        </main>
      </div>
      {(selected || help) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setSelected(null);
            setHelp(false);
          }}
        >
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={closeButton}
              className="dialog-close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setSelected(null);
                setHelp(false);
              }}
            >
              <X size={20} />
            </button>
            {selected ? (
              <>
                <span className="eyebrow">
                  {selected.example
                    ? "EXAMPLE RESEARCH BRIEF"
                    : "SAVED RESEARCH DRAFT"}
                </span>
                <h2 id="dialog-title">{selected.title}</h2>
                <div className="brief-settings">
                  <span>{selected.depth}</span>
                  <span>{selected.scope}</span>
                </div>
                <h3>Research question</h3>
                <p className="brief-prompt">{selected.prompt}</p>
                <div className="engine-note">
                  <FlaskConical size={20} />
                  <div>
                    <strong>Ready for the next step</strong>
                    <p>
                      This is a research brief. Connect a research engine to
                      gather sources and generate a cited report.
                    </p>
                  </div>
                </div>
                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    onClick={() => download(selected)}
                  >
                    <ArrowDownToLine size={16} /> Export brief
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => {
                      newResearch(selected.prompt);
                      setDepth(selected.depth);
                      setScope(selected.scope);
                      setSelected(null);
                    }}
                  >
                    Use this question <ArrowRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">WELCOME TO FIELDWORK</span>
                <h2 id="dialog-title">Make room for better questions.</h2>
                <p>
                  Write a research question or choose a template, select your
                  research depth and source scope, then create a brief.
                </p>
                <div className="engine-note">
                  <BookOpen size={22} />
                  <p>
                    Briefs are saved in this browser and can be exported as
                    Markdown. This frontend preview does not yet run AI
                    research, collect sources, or sync across devices.
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => {
                    setHelp(false);
                    newResearch();
                  }}
                >
                  Start a brief <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
export default App;
