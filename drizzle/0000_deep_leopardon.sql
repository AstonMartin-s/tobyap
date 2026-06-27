CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_account_id" text NOT NULL,
	"name" text,
	"account_status" bigint,
	"currency" text,
	"timezone_name" text,
	"owner" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ad_accounts_meta_account_id_unique" UNIQUE("meta_account_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"campaign_id" text,
	"campaign_name" text,
	"ref" text,
	"account_id" text,
	"account_name" text,
	"objective" text,
	"platform" text DEFAULT 'meta',
	"status" text,
	"daily_budget" text,
	"lifetime_budget" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_name" text,
	"account_cbu" text,
	"context" text,
	"message" text,
	"regular_message" text,
	"walink" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "client_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "kommo_webhook_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"body" jsonb,
	"received_at" timestamp with time zone DEFAULT now(),
	"processed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "landings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text,
	"type" text,
	"active" boolean DEFAULT true,
	"environments" jsonb DEFAULT '["production"]'::jsonb,
	"db" text,
	"vercel" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kommo_lead_id" bigint,
	"kommo_contact_id" bigint,
	"phone" text,
	"name" text,
	"campaign_id" text,
	"fbp" text,
	"fbc" text,
	"fbclid" text,
	"event_source_url" text,
	"status" text,
	"converted" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "leads_tenant_kommo_lead" UNIQUE("tenant_id","kommo_lead_id")
);
--> statement-breakpoint
CREATE TABLE "meta_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid,
	"event_name" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb,
	"response" jsonb,
	"status" text DEFAULT 'pending',
	"conversion_data" jsonb,
	"message_data" jsonb,
	"extracted_code" text,
	"campaign_id" text,
	"meta_campaign_id" text,
	"meta_campaign_name" text,
	"meta_ad_id" text,
	"meta_ad_name" text,
	"success" boolean,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "meta_events_tenant_event" UNIQUE("tenant_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"status" boolean DEFAULT true,
	"type" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule" text,
	"text" text,
	"crm" text DEFAULT 'kommo',
	"pipeline" text DEFAULT 'sales',
	"priority" bigint DEFAULT 1,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kommo_status_id" bigint,
	"name" text,
	"description" text,
	"color" text,
	"pipeline_id" bigint,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kommo_subdomain" text,
	"kommo_token" text,
	"kommo_email" text,
	"kommo_password" text,
	"kommo_pipeline_id" bigint,
	"panel_user" text,
	"panel_password_hash" text,
	"openai_api_key" text,
	"meta_pixel_id" text,
	"meta_capi_token" text,
	"event_suffix" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"role" text DEFAULT 'client',
	"platform" text DEFAULT 'meta',
	"api_url" text,
	"kommo_db" text,
	"project_id" text,
	"psp_active" boolean DEFAULT false,
	"psp_key" text,
	"external_api_key" text,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_settings" ADD CONSTRAINT "client_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landings" ADD CONSTRAINT "landings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_events" ADD CONSTRAINT "meta_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_events" ADD CONSTRAINT "meta_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbers" ADD CONSTRAINT "numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;