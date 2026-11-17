import type { AuthSession } from "../../../../shared/auth";
import type { ReactNode } from "react";
import { HelpDialog } from "../../components/HelpDialog";
import { Sidebar } from "../../components/SideBar";
import { Topbar } from "../../components/Topbar";
import { useResearchWorkspace } from "../../hooks/useResearchWorkspace";
import "../../research.css";
import { HistoryPage } from "../history/HistoryPage";
import { HomePage } from "../home/HomePage";
import { ResearchPage } from "../research/ResearchPage";
import { TemplatesPage } from "../templates/TemplatesPage";
export const WorkspacePage = ({
  accountControls,
  user,
  onSignOut,
  onChangePassword,
  ...props
}: {
  accountControls?: ReactNode;
  user?: AuthSession["user"];
  onSignOut: () => void;
  onChangePassword: () => void;
  userId?: string;
  onLogin: () => void;
}) => {
  const view = useResearchWorkspace(props);
  const {
    menu,
    setMenu,
    page,
    projects,
    navigate,
    newResearch,
    setHelp,
    selectedId,
    error,
    setReload,
    help,
  } = view;
  const Page = selectedId
    ? ResearchPage
    : page === "Templates"
      ? TemplatesPage
      : page === "My research"
        ? HistoryPage
        : HomePage;
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <Sidebar
        menu={menu}
        page={page}
        count={projects.length}
        navigate={navigate}
        newResearch={newResearch}
        onHelp={() => setHelp(true)}
        user={user}
        onSignOut={onSignOut}
        onChangePassword={onChangePassword}
        onLogin={props.onLogin}
      />
      <div className="main-shell">
        <Topbar
          setMenu={setMenu}
          selectedId={selectedId}
          page={page}
          accountControls={accountControls}
        />
        <main>
          {error && (
            <div className="research-alert" role="alert">
              {error}
              <button onClick={() => setReload((v) => v + 1)}>
                Retry connection
              </button>
            </div>
          )}
          <Page {...view} />
        </main>
      </div>
      {help && <HelpDialog {...view} />}
    </div>
  );
};
