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
} from "lucide-react";
type SidebarProps = {
  menu: boolean;
  page: string;
  count: number;
  navigate: (page: string) => void;
  newResearch: () => void;
  onHelp: () => void;
  signedIn: boolean;
};
const navigation = [
  { title: "Overview", icon: Compass },
  { title: "My research", icon: FolderOpen },
  { title: "Source library", icon: BookOpen },
  { title: "Templates", icon: Layers3 },
];
export const Sidebar = ({
  menu,
  page,
  count,
  navigate,
  newResearch,
  onHelp,
  signedIn,
}: SidebarProps) => (
  <aside className={`sidebar ${menu ? "open" : ""}`}>
    <a
      className="brand"
      href="/"
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
    <button className="new-button" onClick={newResearch}>
      <Plus size={17} />
      New research<span>↗</span>
    </button>
    <div className="nav-label">WORKSPACE</div>
    <nav aria-label="Workspace">
      {navigation.map(({ title, icon: Icon }) => (
        <button
          key={title}
          aria-current={page === title ? "page" : undefined}
          className={page === title ? "nav-item active" : "nav-item"}
          onClick={() => navigate(title)}
        >
          <Icon size={18} />
          {title}
          {title === "My research" && <span className="count">{count}</span>}
        </button>
      ))}
    </nav>
    <div className="sidebar-bottom">
      <button className="help-button" onClick={onHelp}>
        <CircleHelp size={17} />
        Help &amp; getting started
        <ArrowUpRight size={14} />
      </button>
      <div className="profile">
        <span className="profile-avatar">Y</span>
        <div>
          Your workspace
          <small>{signedIn ? "Personal account" : "Preview workspace"}</small>
        </div>
      </div>
    </div>
  </aside>
);
