import { History } from "../components/History";
import { PageHeading } from "../components/PageHeading";
import type { WorkspaceViewProps } from "../hooks/useResearchWorkspace";
export const SourcesPage = (props: WorkspaceViewProps) => (
  <>
    <PageHeading page={props.page} />
    <History {...props} />
  </>
);
