CREATE TABLE "research_sources" (
	"id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"highlights" jsonb NOT NULL,
	"queries" jsonb NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "depth" text DEFAULT 'Deep research' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "scope" text DEFAULT 'Web & academic' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "run_token" uuid;--> statement-breakpoint
ALTER TABLE "research_projects" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_project_id_research_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_source_project_url_idx" ON "research_sources" USING btree ("project_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "research_source_project_id_idx" ON "research_sources" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "research_owner_created_idx" ON "research_projects" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_owner_request_idx" ON "research_projects" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "research_status_updated_idx" ON "research_projects" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "research_projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "research_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "research_owner_read" ON "research_projects" FOR SELECT TO authenticated USING (owner_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY "research_source_owner_read" ON "research_sources" FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.research_projects p WHERE p.id = research_sources.project_id AND p.owner_id = (select auth.uid())));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "research_projects", "research_sources" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "research_projects" ADD CONSTRAINT "research_progress_range" CHECK (progress BETWEEN 0 AND 100);
