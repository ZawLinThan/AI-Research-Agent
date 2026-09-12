import { PageHeading } from "../../components/PageHeading";
import { Templates } from "../../components/Templates";
import type { WorkspaceViewProps } from "../../hooks/useResearchWorkspace";
export const TemplatesPage = (props: WorkspaceViewProps) => (
  <>
    <PageHeading page={props.page} />
    <Templates {...props} />
  </>
);
