import { ChevronRight, Menu } from "lucide-react";
import type { ReactNode } from "react";
export const Topbar = ({
  setMenu,
  selectedId,
  page,
  accountControls,
}: {
  setMenu: (open: boolean) => void;
  selectedId: string | null;
  page: string;
  accountControls?: ReactNode;
}) => (
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
      <span>{selectedId ? "Research" : page}</span>
    </div>
    {accountControls}
  </header>
);
