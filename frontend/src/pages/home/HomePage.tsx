import { History } from "../../components/History";
import { PageHeading } from "../../components/PageHeading";
import { ResearchComposer } from "../../components/ResearchComposer";
import { Templates } from "../../components/Templates";
import type { WorkspaceViewProps } from "../../hooks/useResearchWorkspace";
export const HomePage = (props: WorkspaceViewProps) => (
  <>
    <PageHeading page={props.page} />
    <ResearchComposer {...props} />
    <Templates {...props} />
    <History {...props} />
  </>
);
