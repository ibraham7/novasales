export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      asg_assignments: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          offered_at: string
          offered_by: string | null
          offered_to: string
          opportunity_id: string
          organization_id: string
          reason: string | null
          responded_at: string | null
          sla_expires_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          offered_at?: string
          offered_by?: string | null
          offered_to: string
          opportunity_id: string
          organization_id: string
          reason?: string | null
          responded_at?: string | null
          sla_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          offered_at?: string
          offered_by?: string | null
          offered_to?: string
          opportunity_id?: string
          organization_id?: string
          reason?: string | null
          responded_at?: string | null
          sla_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asg_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asg_assignments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asg_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_rules: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          scope_department_id: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          scope_department_id?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          scope_department_id?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_rules_scope_department_id_fkey"
            columns: ["scope_department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_runs: {
        Row: {
          created_at: string
          error: string | null
          event_id: string | null
          id: string
          input: Json
          organization_id: string
          output: Json
          rule_id: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          id?: string
          input?: Json
          organization_id: string
          output?: Json
          rule_id: string
          status: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          id?: string
          input?: Json
          organization_id?: string
          output?: Json
          rule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "auto_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_features: {
        Row: {
          category: string
          created_at: string
          description: string | null
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      billing_invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_at: string | null
          id: string
          issued_at: string
          notes: string | null
          number: string
          organization_id: string
          paid_at: string | null
          pdf_url: string | null
          period_end: string | null
          period_start: string | null
          provider: string
          provider_invoice_id: string | null
          status: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          number: string
          organization_id: string
          paid_at?: string | null
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          provider?: string
          provider_invoice_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          number?: string
          organization_id?: string
          paid_at?: string | null
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          provider?: string
          provider_invoice_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "billing_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plan_features: {
        Row: {
          feature_key: string
          is_enabled: boolean
          plan_id: string
        }
        Insert: {
          feature_key: string
          is_enabled?: boolean
          plan_id: string
        }
        Update: {
          feature_key?: string
          is_enabled?: boolean
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_plan_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "billing_features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "billing_plan_features_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plan_limits: {
        Row: {
          limit_key: string
          limit_value: number
          plan_id: string
        }
        Insert: {
          limit_key: string
          limit_value: number
          plan_id: string
        }
        Update: {
          limit_key?: string
          limit_value?: number
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_plan_limits_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          is_public: boolean
          name: string
          price_monthly: number
          price_quarterly: number
          price_yearly: number
          sort_order: number
          status: string
          trial_days: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name: string
          price_monthly?: number
          price_quarterly?: number
          price_yearly?: number
          sort_order?: number
          status?: string
          trial_days?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name?: string
          price_monthly?: number
          price_quarterly?: number
          price_yearly?: number
          sort_order?: number
          status?: string
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      billing_subscription_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          feature_key: string | null
          id: string
          is_enabled: boolean | null
          limit_key: string | null
          limit_value: number | null
          organization_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          feature_key?: string | null
          id?: string
          is_enabled?: boolean | null
          limit_key?: string | null
          limit_value?: number | null
          organization_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          feature_key?: string | null
          id?: string
          is_enabled?: boolean | null
          limit_key?: string | null
          limit_value?: number | null
          organization_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscription_overrides_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "billing_features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "billing_subscription_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subscriptions: {
        Row: {
          billing_period: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string
          id: string
          organization_id: string
          plan_id: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_period?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          organization_id: string
          plan_id: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_period?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          organization_id?: string
          plan_id?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_usage_counters: {
        Row: {
          counter_key: string
          organization_id: string
          period: string
          updated_at: string
          value: number
        }
        Insert: {
          counter_key: string
          organization_id: string
          period: string
          updated_at?: string
          value?: number
        }
        Update: {
          counter_key?: string
          organization_id?: string
          period?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_usage_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cmp_campaigns: {
        Row: {
          audience_filter: Json
          channel_account_id: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          name: string
          organization_id: string
          scheduled_at: string | null
          started_at: string | null
          stats: Json
          status: string
          template_id: string
          template_version: number
          throttle_per_minute: number
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          channel_account_id: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          name: string
          organization_id: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          template_id: string
          template_version: number
          throttle_per_minute?: number
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          channel_account_id?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          template_id?: string
          template_version?: number
          throttle_per_minute?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cmp_campaigns_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cmp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cmp_recipients: {
        Row: {
          campaign_id: string
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          external_message_id: string | null
          failed_at: string | null
          id: string
          organization_id: string
          phone: string
          read_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
          variables: Json
          wf_run_id: string | null
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          organization_id: string
          phone: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          variables?: Json
          wf_run_id?: string | null
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          organization_id?: string
          phone?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          variables?: Json
          wf_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cmp_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "cmp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_recipients_wf_run_id_fkey"
            columns: ["wf_run_id"]
            isOneToOne: false
            referencedRelation: "wf_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cmp_template_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          media_url: string | null
          organization_id: string
          template_id: string
          variables: Json
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          organization_id: string
          template_id: string
          variables?: Json
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          organization_id?: string
          template_id?: string
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cmp_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmp_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cmp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cmp_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          media_url: string | null
          name: string
          organization_id: string
          updated_at: string
          variables: Json
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name: string
          organization_id: string
          updated_at?: string
          variables?: Json
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cmp_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          activity_type: string
          actor_type: string
          actor_user_id: string | null
          body: string | null
          channel: string | null
          created_at: string
          direction: string | null
          duration_seconds: number | null
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          activity_type: string
          actor_type?: string
          actor_user_id?: string | null
          body?: string | null
          channel?: string | null
          created_at?: string
          direction?: string | null
          duration_seconds?: number | null
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          activity_type?: string
          actor_type?: string
          actor_user_id?: string | null
          body?: string | null
          channel?: string | null
          created_at?: string
          direction?: string | null
          duration_seconds?: number | null
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          contact_id: string
          created_at: string
          event_type: string
          id: string
          opportunity_id: string | null
          organization_id: string
          payload: Json
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          opportunity_id?: string | null
          organization_id: string
          payload?: Json
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          opportunity_id?: string | null
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contact_points: {
        Row: {
          channel_type: string
          contact_id: string
          created_at: string
          id: string
          identifier: string
          is_primary: boolean
          organization_id: string
          verified: boolean
        }
        Insert: {
          channel_type: string
          contact_id: string
          created_at?: string
          id?: string
          identifier: string
          is_primary?: boolean
          organization_id: string
          verified?: boolean
        }
        Update: {
          channel_type?: string
          contact_id?: string
          created_at?: string
          id?: string
          identifier?: string
          is_primary?: boolean
          organization_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_points_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contact_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          display_name: string | null
          first_seen_at: string
          full_name: string | null
          id: string
          language: string | null
          last_activity_at: string | null
          lifecycle_stage: string
          notes: string | null
          organization_id: string
          primary_department_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          display_name?: string | null
          first_seen_at?: string
          full_name?: string | null
          id?: string
          language?: string | null
          last_activity_at?: string | null
          lifecycle_stage?: string
          notes?: string | null
          organization_id: string
          primary_department_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          display_name?: string | null
          first_seen_at?: string
          full_name?: string | null
          id?: string
          language?: string | null
          last_activity_at?: string | null
          lifecycle_stage?: string
          notes?: string | null
          organization_id?: string
          primary_department_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_primary_department_id_fkey"
            columns: ["primary_department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_field_defs: {
        Row: {
          created_at: string
          created_by: string | null
          default_value: Json | null
          entity_type: string
          field_group: string
          field_type: string
          id: string
          is_active: boolean
          is_filterable: boolean
          is_required: boolean
          is_searchable: boolean
          key: string
          label: string
          options: Json
          ord: number
          organization_id: string
          read_only: boolean
          system_field: boolean
          updated_at: string
          validation: Json
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_value?: Json | null
          entity_type: string
          field_group?: string
          field_type: string
          id?: string
          is_active?: boolean
          is_filterable?: boolean
          is_required?: boolean
          is_searchable?: boolean
          key: string
          label: string
          options?: Json
          ord?: number
          organization_id: string
          read_only?: boolean
          system_field?: boolean
          updated_at?: string
          validation?: Json
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_value?: Json | null
          entity_type?: string
          field_group?: string
          field_type?: string
          id?: string
          is_active?: boolean
          is_filterable?: boolean
          is_required?: boolean
          is_searchable?: boolean
          key?: string
          label?: string
          options?: Json
          ord?: number
          organization_id?: string
          read_only?: boolean
          system_field?: boolean
          updated_at?: string
          validation?: Json
          visibility?: string
        }
        Relationships: []
      }
      crm_files: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          id: string
          mime_type: string | null
          organization_id: string
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          id?: string
          mime_type?: string | null
          organization_id: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          organization_id?: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_assignments: {
        Row: {
          action: string
          assigned_at: string
          assigned_by: string | null
          created_at: string
          department_id: string | null
          from_user_id: string | null
          id: string
          lead_id: string
          opportunity_id: string | null
          organization_id: string
          reason: string | null
          strategy: string
          to_user_id: string | null
          welcome_sent_at: string | null
        }
        Insert: {
          action: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          department_id?: string | null
          from_user_id?: string | null
          id?: string
          lead_id: string
          opportunity_id?: string | null
          organization_id: string
          reason?: string | null
          strategy?: string
          to_user_id?: string | null
          welcome_sent_at?: string | null
        }
        Update: {
          action?: string
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          department_id?: string | null
          from_user_id?: string | null
          id?: string
          lead_id?: string
          opportunity_id?: string | null
          organization_id?: string
          reason?: string | null
          strategy?: string
          to_user_id?: string | null
          welcome_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_assignments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          contact_id: string
          converted_at: string | null
          created_at: string
          custom_fields: Json
          department_id: string | null
          id: string
          notes: string | null
          opened_at: string
          organization_id: string
          owner_user_id: string | null
          score: number | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          converted_at?: string | null
          created_at?: string
          custom_fields?: Json
          department_id?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          organization_id: string
          owner_user_id?: string | null
          score?: number | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          converted_at?: string | null
          created_at?: string
          custom_fields?: Json
          department_id?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          organization_id?: string
          owner_user_id?: string | null
          score?: number | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_opportunity_sessions: {
        Row: {
          channel: string
          created_at: string
          id: string
          opportunity_id: string
          organization_id: string
          session_ref: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          opportunity_id: string
          organization_id: string
          session_ref: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          opportunity_id?: string
          organization_id?: string
          session_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_opportunity_sessions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_opportunity_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          ord: number
          pipeline_id: string
          probability: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          ord?: number
          pipeline_id: string
          probability?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          ord?: number
          pipeline_id?: string
          probability?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tag_defs: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tag_defs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tag_links: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          organization_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tag_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tag_defs"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assignee_user_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          organization_id: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          organization_id: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          organization_id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_timeline: {
        Row: {
          actor_user_id: string | null
          created_at: string
          description: string | null
          entity_id: string
          entity_type: string
          event_kind: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          ref_id: string | null
          ref_type: string | null
          title: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          description?: string | null
          entity_id: string
          entity_type: string
          event_kind: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          ref_id?: string | null
          ref_type?: string | null
          title: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          description?: string | null
          entity_id?: string
          entity_type?: string
          event_kind?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          ref_id?: string | null
          ref_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_timeline_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          actor_user_id: string | null
          aggregate_id: string | null
          aggregate_type: string | null
          created_at: string
          event_type: string
          id: string
          organization_id: string | null
          payload: Json
        }
        Insert: {
          actor_user_id?: string | null
          aggregate_id?: string | null
          aggregate_type?: string | null
          created_at?: string
          event_type: string
          id?: string
          organization_id?: string | null
          payload?: Json
        }
        Update: {
          actor_user_id?: string | null
          aggregate_id?: string | null
          aggregate_type?: string | null
          created_at?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ic_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          mentions: string[]
          opportunity_id: string
          organization_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          mentions?: string[]
          opportunity_id: string
          organization_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          mentions?: string[]
          opportunity_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ic_messages_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ic_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      id_availability: {
        Row: {
          note: string | null
          since: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          note?: string | null
          since?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          note?: string | null
          since?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integ_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      integ_api_request_logs: {
        Row: {
          api_key_id: string | null
          created_at: string
          duration_ms: number | null
          id: string
          ip: string | null
          method: string
          oauth_auth_id: string | null
          organization_id: string
          path: string
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method: string
          oauth_auth_id?: string | null
          organization_id: string
          path: string
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method?: string
          oauth_auth_id?: string | null
          organization_id?: string
          path?: string
          status_code?: number
          user_agent?: string | null
        }
        Relationships: []
      }
      integ_marketplace_apps: {
        Row: {
          category: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          docs_url: string | null
          icon_url: string | null
          id: string
          install_type: string
          is_featured: boolean
          is_official: boolean
          name: string
          oauth_client_id: string | null
          screenshots: string[] | null
          slug: string
          sort_order: number
          status: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          docs_url?: string | null
          icon_url?: string | null
          id?: string
          install_type?: string
          is_featured?: boolean
          is_official?: boolean
          name: string
          oauth_client_id?: string | null
          screenshots?: string[] | null
          slug: string
          sort_order?: number
          status?: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          docs_url?: string | null
          icon_url?: string | null
          id?: string
          install_type?: string
          is_featured?: boolean
          is_official?: boolean
          name?: string
          oauth_client_id?: string | null
          screenshots?: string[] | null
          slug?: string
          sort_order?: number
          status?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integ_marketplace_apps_oauth_client_id_fkey"
            columns: ["oauth_client_id"]
            isOneToOne: false
            referencedRelation: "integ_oauth_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      integ_marketplace_installs: {
        Row: {
          app_id: string
          config: Json
          id: string
          installed_at: string
          installed_by: string | null
          is_active: boolean
          organization_id: string
        }
        Insert: {
          app_id: string
          config?: Json
          id?: string
          installed_at?: string
          installed_by?: string | null
          is_active?: boolean
          organization_id: string
        }
        Update: {
          app_id?: string
          config?: Json
          id?: string
          installed_at?: string
          installed_by?: string | null
          is_active?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integ_marketplace_installs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "integ_marketplace_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      integ_oauth_authorizations: {
        Row: {
          access_token_hash: string
          client_id: string
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          refresh_token_hash: string | null
          revoked_at: string | null
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_hash: string
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_hash?: string
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          refresh_token_hash?: string | null
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integ_oauth_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "integ_oauth_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      integ_oauth_clients: {
        Row: {
          client_id: string
          client_secret_hash: string
          created_at: string
          created_by: string | null
          description: string | null
          homepage_url: string | null
          id: string
          logo_url: string | null
          name: string
          organization_id: string | null
          redirect_uris: string[]
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret_hash: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          homepage_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
          organization_id?: string | null
          redirect_uris?: string[]
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret_hash?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          homepage_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          organization_id?: string | null
          redirect_uris?: string[]
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      integ_webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          last_error: string | null
          next_retry_at: string | null
          organization_id: string
          payload: Json
          response_body: string | null
          response_status: number | null
          status: string
          updated_at: string
          webhook_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          organization_id: string
          payload: Json
          response_body?: string | null
          response_status?: number | null
          status?: string
          updated_at?: string
          webhook_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          organization_id?: string
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          status?: string
          updated_at?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integ_webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "integ_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      integ_webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          events: string[]
          headers: Json
          id: string
          is_active: boolean
          name: string
          organization_id: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          headers?: Json
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          headers?: Json
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      msg_channel_account_departments: {
        Row: {
          account_id: string
          created_at: string
          department_id: string
          organization_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          department_id: string
          organization_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          department_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "msg_channel_account_departments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_channel_account_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_channel_account_departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      msg_channel_accounts: {
        Row: {
          channel_id: string
          created_at: string
          department_id: string | null
          display_name: string
          external_ref: string | null
          first_outbound_at: string | null
          first_outbound_kind: string | null
          first_outbound_source: string | null
          health_state: string
          id: string
          identifier: string | null
          last_connected_at: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          last_provider_error: string | null
          last_relinked_at: string | null
          last_restricted_at: string | null
          last_webhook_at: string | null
          linked_at: string | null
          meta: Json
          observation_hours: number
          observation_source: string
          observation_started_at: string | null
          organization_id: string
          owner_user_id: string | null
          provider_error_count: number
          provider_meta: Json
          restriction_count: number
          risk_score: number
          send_paused_at: string | null
          sensitivity: string
          status: string
          updated_at: string
          webhook_configured: boolean
        }
        Insert: {
          channel_id: string
          created_at?: string
          department_id?: string | null
          display_name: string
          external_ref?: string | null
          first_outbound_at?: string | null
          first_outbound_kind?: string | null
          first_outbound_source?: string | null
          health_state?: string
          id?: string
          identifier?: string | null
          last_connected_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_provider_error?: string | null
          last_relinked_at?: string | null
          last_restricted_at?: string | null
          last_webhook_at?: string | null
          linked_at?: string | null
          meta?: Json
          observation_hours?: number
          observation_source?: string
          observation_started_at?: string | null
          organization_id: string
          owner_user_id?: string | null
          provider_error_count?: number
          provider_meta?: Json
          restriction_count?: number
          risk_score?: number
          send_paused_at?: string | null
          sensitivity?: string
          status?: string
          updated_at?: string
          webhook_configured?: boolean
        }
        Update: {
          channel_id?: string
          created_at?: string
          department_id?: string | null
          display_name?: string
          external_ref?: string | null
          first_outbound_at?: string | null
          first_outbound_kind?: string | null
          first_outbound_source?: string | null
          health_state?: string
          id?: string
          identifier?: string | null
          last_connected_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          last_provider_error?: string | null
          last_relinked_at?: string | null
          last_restricted_at?: string | null
          last_webhook_at?: string | null
          linked_at?: string | null
          meta?: Json
          observation_hours?: number
          observation_source?: string
          observation_started_at?: string | null
          organization_id?: string
          owner_user_id?: string | null
          provider_error_count?: number
          provider_meta?: Json
          restriction_count?: number
          risk_score?: number
          send_paused_at?: string | null
          sensitivity?: string
          status?: string
          updated_at?: string
          webhook_configured?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "msg_channel_accounts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "msg_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_channel_accounts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_channel_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      msg_channels: {
        Row: {
          channel_type: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          channel_type: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          channel_type?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "msg_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      msg_messages: {
        Row: {
          content: string | null
          created_at: string
          direction: string
          edited_at: string | null
          external_id: string | null
          forwarded_from_message_id: string | null
          id: string
          is_internal: boolean
          media_meta: Json
          media_url: string | null
          message_type: string
          organization_id: string
          reactions: Json
          reply_to_message_id: string | null
          reply_to_snapshot: Json | null
          sent_by_user_id: string | null
          session_id: string
          status: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          direction: string
          edited_at?: string | null
          external_id?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          is_internal?: boolean
          media_meta?: Json
          media_url?: string | null
          message_type?: string
          organization_id: string
          reactions?: Json
          reply_to_message_id?: string | null
          reply_to_snapshot?: Json | null
          sent_by_user_id?: string | null
          session_id: string
          status?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          direction?: string
          edited_at?: string | null
          external_id?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          is_internal?: boolean
          media_meta?: Json
          media_url?: string | null
          message_type?: string
          organization_id?: string
          reactions?: Json
          reply_to_message_id?: string | null
          reply_to_snapshot?: Json | null
          sent_by_user_id?: string | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "msg_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "msg_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "msg_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      msg_sessions: {
        Row: {
          channel_account_id: string
          created_at: string
          external_thread_id: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          organization_id: string
          peer_identifier: string
          profile_pic_url: string | null
          push_name: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          channel_account_id: string
          created_at?: string
          external_thread_id: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          organization_id: string
          peer_identifier: string
          profile_pic_url?: string | null
          push_name?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          channel_account_id?: string
          created_at?: string
          external_thread_id?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          organization_id?: string
          peer_identifier?: string
          profile_pic_url?: string | null
          push_name?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "msg_sessions_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msg_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notif_events: {
        Row: {
          body: string | null
          created_at: string
          event_type: string
          id: string
          link: string | null
          organization_id: string
          payload: Json
          read_at: string | null
          recipient_user_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          event_type: string
          id?: string
          link?: string | null
          organization_id: string
          payload?: Json
          read_at?: string | null
          recipient_user_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          event_type?: string
          id?: string
          link?: string | null
          organization_id?: string
          payload?: Json
          read_at?: string | null
          recipient_user_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notif_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opp_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          opportunity_id: string
          organization_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          opportunity_id: string
          organization_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          opportunity_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opp_notes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opp_opportunities: {
        Row: {
          closed_at: string | null
          contact_id: string
          created_at: string
          currency: string | null
          custom_fields: Json
          deleted_at: string | null
          deleted_by: string | null
          department_id: string | null
          expected_close_date: string | null
          first_response_at: string | null
          id: string
          lead_id: string | null
          opened_at: string
          organization_id: string
          outcome: string | null
          owner_agent_id: string | null
          pipeline_id: string | null
          priority: number
          probability: number | null
          product_interest: string | null
          source: string | null
          stage: string
          stage_id: string | null
          title: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          closed_at?: string | null
          contact_id: string
          created_at?: string
          currency?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          expected_close_date?: string | null
          first_response_at?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string
          organization_id: string
          outcome?: string | null
          owner_agent_id?: string | null
          pipeline_id?: string | null
          priority?: number
          probability?: number | null
          product_interest?: string | null
          source?: string | null
          stage?: string
          stage_id?: string | null
          title?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          closed_at?: string | null
          contact_id?: string
          created_at?: string
          currency?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          deleted_by?: string | null
          department_id?: string | null
          expected_close_date?: string | null
          first_response_at?: string | null
          id?: string
          lead_id?: string | null
          opened_at?: string
          organization_id?: string
          outcome?: string | null
          owner_agent_id?: string | null
          pipeline_id?: string | null
          priority?: number
          probability?: number | null
          product_interest?: string | null
          source?: string | null
          stage?: string
          stage_id?: string | null
          title?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opp_opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_opportunities_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_opportunities_stage_fkey"
            columns: ["stage"]
            isOneToOne: false
            referencedRelation: "opp_stages"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "opp_opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      opp_stages: {
        Row: {
          is_terminal: boolean
          key: string
          name: string
          ord: number
          won: boolean
        }
        Insert: {
          is_terminal?: boolean
          key: string
          name: string
          ord: number
          won?: boolean
        }
        Update: {
          is_terminal?: boolean
          key?: string
          name?: string
          ord?: number
          won?: boolean
        }
        Relationships: []
      }
      opp_tags: {
        Row: {
          color: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opp_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opp_tags_map: {
        Row: {
          opportunity_id: string
          tag_id: string
        }
        Insert: {
          opportunity_id: string
          tag_id: string
        }
        Update: {
          opportunity_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opp_tags_map_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opp_tags_map_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "opp_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      org_department_members: {
        Row: {
          created_at: string
          default_channel_account_id: string | null
          department_id: string
          display_name: string | null
          id: string
          is_active: boolean
          is_supervisor: boolean
          organization_id: string
          updated_at: string
          user_id: string
          welcome_template_override: string | null
        }
        Insert: {
          created_at?: string
          default_channel_account_id?: string | null
          department_id: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_supervisor?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
          welcome_template_override?: string | null
        }
        Update: {
          created_at?: string
          default_channel_account_id?: string | null
          department_id?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          is_supervisor?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
          welcome_template_override?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_department_members_default_channel_account_id_fkey"
            columns: ["default_channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_department_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_departments: {
        Row: {
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          short_code: string | null
          sla_offer_minutes: number
          subtitle: string | null
          timezone: string
          updated_at: string
          welcome_template: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          short_code?: string | null
          sla_offer_minutes?: number
          subtitle?: string | null
          timezone?: string
          updated_at?: string
          welcome_template?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          short_code?: string | null
          sla_offer_minutes?: number
          subtitle?: string | null
          timezone?: string
          updated_at?: string
          welcome_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          department_id: string | null
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          role_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          department_id?: string | null
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          role_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          department_id?: string | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          role_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "rbac_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          joined_at: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json
          organization_id: string | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      platform_impersonation_sessions: {
        Row: {
          admin_user_id: string
          ended_at: string | null
          id: string
          organization_id: string | null
          reason: string | null
          started_at: string
          target_user_id: string
        }
        Insert: {
          admin_user_id: string
          ended_at?: string | null
          id?: string
          organization_id?: string | null
          reason?: string | null
          started_at?: string
          target_user_id: string
        }
        Update: {
          admin_user_id?: string
          ended_at?: string | null
          id?: string
          organization_id?: string | null
          reason?: string | null
          started_at?: string
          target_user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      plugin_registry: {
        Row: {
          id: string
          installed_at: string
          is_enabled: boolean
          is_system: boolean
          name: string
          provides: string[]
          updated_at: string
          version: string
        }
        Insert: {
          id: string
          installed_at?: string
          is_enabled?: boolean
          is_system?: boolean
          name: string
          provides?: string[]
          updated_at?: string
          version: string
        }
        Update: {
          id?: string
          installed_at?: string
          is_enabled?: boolean
          is_system?: boolean
          name?: string
          provides?: string[]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      plugin_settings: {
        Row: {
          key: string
          organization_id: string
          plugin_id: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          key: string
          organization_id: string
          plugin_id: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          key?: string
          organization_id?: string
          plugin_id?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "plugin_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plugin_settings_plugin_id_fkey"
            columns: ["plugin_id"]
            isOneToOne: false
            referencedRelation: "plugin_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      plugin_whatsapp_cloud_accounts: {
        Row: {
          access_token_cipher: string | null
          channel_account_id: string
          created_at: string
          display_phone_number: string | null
          id: string
          is_coexistence: boolean
          last_error: string | null
          organization_id: string
          phone_number_id: string
          quality_rating: string | null
          raw_state: Json
          status: string
          token_expires_at: string | null
          updated_at: string
          verified_name: string | null
          waba_id: string
        }
        Insert: {
          access_token_cipher?: string | null
          channel_account_id: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_coexistence?: boolean
          last_error?: string | null
          organization_id: string
          phone_number_id: string
          quality_rating?: string | null
          raw_state?: Json
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          verified_name?: string | null
          waba_id: string
        }
        Update: {
          access_token_cipher?: string | null
          channel_account_id?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_coexistence?: boolean
          last_error?: string | null
          organization_id?: string
          phone_number_id?: string
          quality_rating?: string | null
          raw_state?: Json
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          verified_name?: string | null
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plugin_whatsapp_cloud_accounts_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: true
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plugin_whatsapp_cloud_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plugin_whatsapp_evolution_instances: {
        Row: {
          channel_account_id: string
          created_at: string
          id: string
          instance_name: string
          organization_id: string
          phone_number: string | null
          qr_code: string | null
          raw_state: Json
          updated_at: string
        }
        Insert: {
          channel_account_id: string
          created_at?: string
          id?: string
          instance_name: string
          organization_id: string
          phone_number?: string | null
          qr_code?: string | null
          raw_state?: Json
          updated_at?: string
        }
        Update: {
          channel_account_id?: string
          created_at?: string
          id?: string
          instance_name?: string
          organization_id?: string
          phone_number?: string | null
          qr_code?: string | null
          raw_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plugin_whatsapp_evolution_instances_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: true
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plugin_whatsapp_evolution_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_organization_id: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          active_organization_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: []
      }
      q_queue_items: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          entered_at: string
          id: string
          opportunity_id: string
          organization_id: string
          priority: number
          queue_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          entered_at?: string
          id?: string
          opportunity_id: string
          organization_id: string
          priority?: number
          queue_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          entered_at?: string
          id?: string
          opportunity_id?: string
          organization_id?: string
          priority?: number
          queue_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "q_queue_items_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opp_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_queue_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_queue_items_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "q_queues"
            referencedColumns: ["id"]
          },
        ]
      }
      q_queues: {
        Row: {
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "q_queues_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "q_queues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rbac_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          hashed_key: string
          id: string
          last_used_at: string | null
          name: string
          organization_id: string
          prefix: string
          revoked_at: string | null
          role_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hashed_key: string
          id?: string
          last_used_at?: string | null
          name: string
          organization_id: string
          prefix: string
          revoked_at?: string | null
          role_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hashed_key?: string
          id?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          prefix?: string
          revoked_at?: string | null
          role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rbac_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rbac_api_keys_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "rbac_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      rbac_permissions: {
        Row: {
          created_at: string
          description: string
          key: string
        }
        Insert: {
          created_at?: string
          description: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string
          key?: string
        }
        Relationships: []
      }
      rbac_role_permissions: {
        Row: {
          permission_key: string
          role_id: string
        }
        Insert: {
          permission_key: string
          role_id: string
        }
        Update: {
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rbac_role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "rbac_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "rbac_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "rbac_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      rbac_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rbac_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rbac_user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role_id: string
          scope_department_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          scope_department_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          scope_department_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rbac_user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rbac_user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "rbac_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rbac_user_roles_scope_department_id_fkey"
            columns: ["scope_department_id"]
            isOneToOne: false
            referencedRelation: "org_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_number_health_events: {
        Row: {
          channel_account_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
          organization_id: string
        }
        Insert: {
          channel_account_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          organization_id: string
        }
        Update: {
          channel_account_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_number_health_events_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_number_restrictions: {
        Row: {
          channel_account_id: string
          created_at: string
          created_by: string | null
          detected_at: string
          detection_source: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          notes: string | null
          organization_id: string
          reason: string | null
          snapshot: Json
          updated_at: string
        }
        Insert: {
          channel_account_id: string
          created_at?: string
          created_by?: string | null
          detected_at?: string
          detection_source?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          reason?: string | null
          snapshot?: Json
          updated_at?: string
        }
        Update: {
          channel_account_id?: string
          created_at?: string
          created_by?: string | null
          detected_at?: string
          detection_source?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          reason?: string | null
          snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_number_restrictions_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_number_restrictions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_risk_rules: {
        Row: {
          created_at: string
          is_enabled: boolean
          key: string
          label: string
          sort_order: number
          threshold: number | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          is_enabled?: boolean
          key: string
          label: string
          sort_order?: number
          threshold?: number | null
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          is_enabled?: boolean
          key?: string
          label?: string
          sort_order?: number
          threshold?: number | null
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      wa_send_decisions: {
        Row: {
          allowed: boolean
          channel_account_id: string | null
          created_at: string
          failed_rules: string[]
          id: string
          organization_id: string
          passed_rules: string[]
          peer: string | null
          source: string
        }
        Insert: {
          allowed: boolean
          channel_account_id?: string | null
          created_at?: string
          failed_rules?: string[]
          id?: string
          organization_id: string
          passed_rules?: string[]
          peer?: string | null
          source: string
        }
        Update: {
          allowed?: boolean
          channel_account_id?: string | null
          created_at?: string
          failed_rules?: string[]
          id?: string
          organization_id?: string
          passed_rules?: string[]
          peer?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_send_decisions_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_send_quotas: {
        Row: {
          bucket: string
          bucket_key: string
          channel_account_id: string
          created_at: string
          id: string
          messages: number
          new_conversations: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          bucket: string
          bucket_key: string
          channel_account_id: string
          created_at?: string
          id?: string
          messages?: number
          new_conversations?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          bucket?: string
          bucket_key?: string
          channel_account_id?: string
          created_at?: string
          id?: string
          messages?: number
          new_conversations?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_send_quotas_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "msg_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_jobs: {
        Row: {
          claimed_at: string | null
          created_at: string
          id: string
          organization_id: string
          resume_at: string
          resume_step_id: string | null
          run_id: string
          status: string
          timeout_step_id: string | null
          updated_at: string
          wait_kind: string
          wait_match: Json
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          resume_at: string
          resume_step_id?: string | null
          run_id: string
          status?: string
          timeout_step_id?: string | null
          updated_at?: string
          wait_kind: string
          wait_match?: Json
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          resume_at?: string
          resume_step_id?: string | null
          run_id?: string
          status?: string
          timeout_step_id?: string | null
          updated_at?: string
          wait_kind?: string
          wait_match?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wf_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wf_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_run_steps: {
        Row: {
          action: string | null
          created_at: string
          error: string | null
          id: string
          input: Json
          organization_id: string
          output: Json
          run_id: string
          status: string
          step_id: string
          step_index: number
          step_type: string
        }
        Insert: {
          action?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          organization_id: string
          output?: Json
          run_id: string
          status: string
          step_id: string
          step_index: number
          step_type: string
        }
        Update: {
          action?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          organization_id?: string
          output?: Json
          run_id?: string
          status?: string
          step_id?: string
          step_index?: number
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_run_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wf_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_runs: {
        Row: {
          context: Json
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          next_step_id: string | null
          organization_id: string
          started_at: string
          status: string
          step_count: number
          trigger_event_id: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          next_step_id?: string | null
          organization_id: string
          started_at?: string
          status?: string
          step_count?: number
          trigger_event_id?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          next_step_id?: string | null
          organization_id?: string
          started_at?: string
          status?: string
          step_count?: number
          trigger_event_id?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "wf_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_workflows: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          organization_id: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      billing_get_effective_features: {
        Args: { _org_id: string }
        Returns: {
          feature_key: string
          is_enabled: boolean
        }[]
      }
      billing_get_effective_limits: {
        Args: { _org_id: string }
        Returns: {
          limit_key: string
          limit_value: number
        }[]
      }
      crm_apply_default_pipeline: {
        Args: { _org_id: string }
        Returns: undefined
      }
      get_pipeline_board_fast: {
        Args: {
          _department_ids?: string[]
          _limit?: number
          _organization_id: string
          _owner_agent_id?: string
        }
        Returns: {
          account_label: string
          account_name: string
          channel: string
          contact_avatar: string
          contact_id: string
          contact_name: string
          contact_phone: string
          currency: string
          department_id: string
          id: string
          last_message: string
          last_message_at: string
          lead_id: string
          opened_at: string
          outcome: string
          owner_agent_id: string
          owner_avatar: string
          owner_name: string
          pipeline_id: string
          priority: string
          probability: number
          sessions_count: number
          source: string
          stage: string
          stage_id: string
          unread_count: number
          value: number
        }[]
      }
      get_pipeline_meta_fast: {
        Args: { _organization_id: string }
        Returns: Json
      }
      get_workspace_access_fast: {
        Args: { _organization_id: string; _user_id: string }
        Returns: Json
      }
      has_permission: {
        Args: { _org_id: string; _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_session_unread: {
        Args: { _session_id: string }
        Returns: undefined
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      rbac_actor_rank: {
        Args: { _org_id: string; _user_id: string }
        Returns: number
      }
      rbac_role_rank: { Args: { _role_key: string }; Returns: number }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "supervisor"
        | "sales"
        | "owner"
        | "department_supervisor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "user",
        "supervisor",
        "sales",
        "owner",
        "department_supervisor",
      ],
    },
  },
} as const
