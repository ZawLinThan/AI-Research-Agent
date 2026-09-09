import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Compass,
  FlaskConical,
  FolderOpen,
  Layers3,
  Plus,
  Sparkles,
} from "lucide-react";

const SideBar = () => {
  return (
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
  );
};

export default SideBar;
