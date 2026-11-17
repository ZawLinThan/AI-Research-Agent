import type { AuthSession } from "../../../shared/auth";
import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  CircleHelp,
  ChevronUp,
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
  user?: AuthSession["user"];
  onSignOut: () => void;
  onChangePassword: () => void;
  onLogin: () => void;
};
const navigation = [
  { title: "Overview", icon: Compass },
  { title: "My research", icon: FolderOpen },
  { title: "Templates", icon: Layers3 },
];
export const Sidebar = ({
  menu,
  page,
  count,
  navigate,
  newResearch,
  onHelp,
  user,
  onSignOut,
  onChangePassword,
  onLogin,
}: SidebarProps) => {
  const fullName = user?.fullName?.trim() || user?.email || "Guest";
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !accountMenu.current?.contains(event.target)
      ) {
        if (accountMenu.current) accountMenu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const accountAction = (action: () => void) => {
    if (accountMenu.current) accountMenu.current.open = false;
    action();
  };
  return (
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
        <details
          ref={accountMenu}
          className="account-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary className="profile">
            <span className="profile-avatar">{fullName[0]?.toUpperCase()}</span>
            <span className="profile-name">
              {firstName ? `${firstName}'s workspace` : "Your workspace"}
              <small>{user ? fullName : "Preview workspace"}</small>
            </span>
            <ChevronUp
              className="account-chevron"
              size={16}
              aria-hidden="true"
            />
          </summary>
          <div className="account-actions">
            {user ? (
              <>
                <button onClick={() => accountAction(onChangePassword)}>
                  Change password
                </button>
                <button onClick={() => accountAction(onSignOut)}>
                  Sign out
                </button>
              </>
            ) : (
              <button onClick={() => accountAction(onLogin)}>Log in</button>
            )}
          </div>
        </details>
      </div>
    </aside>
  );
};
