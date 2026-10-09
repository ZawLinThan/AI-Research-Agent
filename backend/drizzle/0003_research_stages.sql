CREATE TABLE research_stages (
 project_id uuid NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
 stage text NOT NULL,
 payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (project_id, stage)
);
--> statement-breakpoint
ALTER TABLE research_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY research_stage_owner_read ON research_stages FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM research_projects p WHERE p.id = research_stages.project_id AND p.owner_id = (select auth.uid())));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON research_stages FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE research_sources ADD COLUMN query_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE research_sources ADD COLUMN published_at text;
--> statement-breakpoint
ALTER TABLE research_sources ADD COLUMN source_domain text;
