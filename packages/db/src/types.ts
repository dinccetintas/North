export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      actions: {
        Row: {
          agent_role: string;
          auto_rule_id: string | null;
          company_id: string;
          created_at: string;
          decision_card_id: string | null;
          description: string;
          external_ref: string | null;
          id: string;
          kind: string;
          payload: NonNullable<Json>;
          sandbox: boolean;
          status: string;
          supersedes: string | null;
          task_id: string | null;
          tier: string;
        };
        ComputedFields: never;
        Insert: {
          agent_role: string;
          auto_rule_id?: string | null;
          company_id: string;
          created_at?: string;
          decision_card_id?: string | null;
          description: string;
          external_ref?: string | null;
          id?: string;
          kind: string;
          payload?: NonNullable<Json>;
          sandbox?: boolean;
          status: string;
          supersedes?: string | null;
          task_id?: string | null;
          tier: string;
        };
        Update: {
          agent_role?: string;
          auto_rule_id?: string | null;
          company_id?: string;
          created_at?: string;
          decision_card_id?: string | null;
          description?: string;
          external_ref?: string | null;
          id?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          sandbox?: boolean;
          status?: string;
          supersedes?: string | null;
          task_id?: string | null;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "actions_auto_rule_id_fkey";
            columns: ["auto_rule_id"];
            isOneToOne: false;
            referencedRelation: "auto_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_decision_card_id_fkey";
            columns: ["decision_card_id"];
            isOneToOne: false;
            referencedRelation: "decision_cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_supersedes_fkey";
            columns: ["supersedes"];
            isOneToOne: false;
            referencedRelation: "actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          company_id: string;
          cost_usd: number;
          created_at: string;
          duration_ms: number;
          error: string | null;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          role: string;
          runtime: string;
          session_id: string | null;
          status: string;
          task_id: string | null;
          trace_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          model: string;
          output_tokens?: number;
          role: string;
          runtime: string;
          session_id?: string | null;
          status: string;
          task_id?: string | null;
          trace_id?: string | null;
        };
        Update: {
          company_id?: string;
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          role?: string;
          runtime?: string;
          session_id?: string | null;
          status?: string;
          task_id?: string | null;
          trace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      agents: {
        Row: {
          company_id: string;
          config_ref: string;
          enabled: boolean;
          id: string;
          max_action_tier: string;
          role: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          config_ref: string;
          enabled?: boolean;
          id?: string;
          max_action_tier: string;
          role: string;
        };
        Update: {
          company_id?: string;
          config_ref?: string;
          enabled?: boolean;
          id?: string;
          max_action_tier?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      artifacts: {
        Row: {
          company_id: string;
          created_at: string;
          created_by_role: string;
          id: string;
          kind: string;
          storage_path: string;
          title: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          created_by_role: string;
          id?: string;
          kind: string;
          storage_path: string;
          title: string;
          version?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by_role?: string;
          id?: string;
          kind?: string;
          storage_path?: string;
          title?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "artifacts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_tool_calls: {
        Row: {
          agent_run_id: string | null;
          company_id: string;
          created_at: string;
          decision: string;
          id: string;
          input: NonNullable<Json>;
          task_id: string | null;
          tool_name: string;
        };
        ComputedFields: never;
        Insert: {
          agent_run_id?: string | null;
          company_id: string;
          created_at?: string;
          decision: string;
          id?: string;
          input?: NonNullable<Json>;
          task_id?: string | null;
          tool_name: string;
        };
        Update: {
          agent_run_id?: string | null;
          company_id?: string;
          created_at?: string;
          decision?: string;
          id?: string;
          input?: NonNullable<Json>;
          task_id?: string | null;
          tool_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_tool_calls_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_tool_calls_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_tool_calls_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      auto_rules: {
        Row: {
          active: boolean;
          category: string | null;
          company_id: string;
          created_at: string;
          created_from_card_id: string | null;
          id: string;
          kind: string;
          max_amount_usd: number | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          category?: string | null;
          company_id: string;
          created_at?: string;
          created_from_card_id?: string | null;
          id?: string;
          kind: string;
          max_amount_usd?: number | null;
        };
        Update: {
          active?: boolean;
          category?: string | null;
          company_id?: string;
          created_at?: string;
          created_from_card_id?: string | null;
          id?: string;
          kind?: string;
          max_amount_usd?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "auto_rules_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auto_rules_created_from_card_id_fkey";
            columns: ["created_from_card_id"];
            isOneToOne: false;
            referencedRelation: "decision_cards";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          applied_at: string | null;
          event_id: string;
          id: string;
          payload: NonNullable<Json>;
          payload_sha256: string | null;
          received_at: string;
          type: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          applied_at?: string | null;
          event_id: string;
          id?: string;
          payload: NonNullable<Json>;
          payload_sha256?: string | null;
          received_at?: string;
          type: string;
          user_id?: string | null;
        };
        Update: {
          applied_at?: string | null;
          event_id?: string;
          id?: string;
          payload?: NonNullable<Json>;
          payload_sha256?: string | null;
          received_at?: string;
          type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_sessions: {
        Row: {
          completed_at: string | null;
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          pack_id: string | null;
          plan_id: string | null;
          provider_ref: string | null;
          status: string;
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: string;
          pack_id?: string | null;
          plan_id?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          pack_id?: string | null;
          plan_id?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      briefs: {
        Row: {
          brief_date: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at: string;
          id: string;
          word_count: number;
        };
        ComputedFields: never;
        Insert: {
          brief_date: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at?: string;
          id?: string;
          word_count?: number;
        };
        Update: {
          brief_date?: string;
          company_id?: string;
          content?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "briefs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      budgets: {
        Row: {
          category: string;
          company_id: string;
          currency: string;
          daily_extra_date: string;
          daily_extra_usd: number;
          daily_limit_usd: number;
          id: string;
          spent_today_date: string;
          spent_today_usd: number;
          spent_total_usd: number;
          total_limit_usd: number;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          company_id: string;
          currency?: string;
          daily_extra_date?: string;
          daily_extra_usd?: number;
          daily_limit_usd: number;
          id?: string;
          spent_today_date?: string;
          spent_today_usd?: number;
          spent_total_usd?: number;
          total_limit_usd: number;
        };
        Update: {
          category?: string;
          company_id?: string;
          currency?: string;
          daily_extra_date?: string;
          daily_extra_usd?: number;
          daily_limit_usd?: number;
          id?: string;
          spent_today_date?: string;
          spent_today_usd?: number;
          spent_total_usd?: number;
          total_limit_usd?: number;
        };
        Relationships: [
          {
            foreignKeyName: "budgets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          action_id: string;
          channel: string;
          clicks: number;
          company_id: string;
          conversions: number;
          created_at: string;
          daily_budget_usd: number;
          id: string;
          impressions: number;
          landing_url: string;
          last_collected_at: string | null;
          last_error: string | null;
          metric_key: string;
          name: string;
          paused_day: string | null;
          provider: string;
          provider_campaign_id: string;
          sandbox: boolean;
          spent_today_usd: number;
          spent_total_usd: number;
          status: string;
          task_id: string | null;
          total_budget_usd: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action_id: string;
          channel: string;
          clicks?: number;
          company_id: string;
          conversions?: number;
          created_at?: string;
          daily_budget_usd: number;
          id?: string;
          impressions?: number;
          landing_url?: string;
          last_collected_at?: string | null;
          last_error?: string | null;
          metric_key: string;
          name: string;
          paused_day?: string | null;
          provider: string;
          provider_campaign_id: string;
          sandbox?: boolean;
          spent_today_usd?: number;
          spent_total_usd?: number;
          status?: string;
          task_id?: string | null;
          total_budget_usd: number;
          updated_at?: string;
        };
        Update: {
          action_id?: string;
          channel?: string;
          clicks?: number;
          company_id?: string;
          conversions?: number;
          created_at?: string;
          daily_budget_usd?: number;
          id?: string;
          impressions?: number;
          landing_url?: string;
          last_collected_at?: string | null;
          last_error?: string | null;
          metric_key?: string;
          name?: string;
          paused_day?: string | null;
          provider?: string;
          provider_campaign_id?: string;
          sandbox?: boolean;
          spent_today_usd?: number;
          spent_total_usd?: number;
          status?: string;
          task_id?: string | null;
          total_budget_usd?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: true;
            referencedRelation: "actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          kill_switch_active: boolean;
          legal_name: string | null;
          name: string;
          onboarding_step: string;
          owner_id: string;
          paused_reason: string | null;
          postal_address: string | null;
          public_page_enabled: boolean;
          sentry_project_slug: string | null;
          slug: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          legal_name?: string | null;
          name: string;
          onboarding_step?: string;
          owner_id: string;
          paused_reason?: string | null;
          postal_address?: string | null;
          public_page_enabled?: boolean;
          sentry_project_slug?: string | null;
          slug: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          legal_name?: string | null;
          name?: string;
          onboarding_step?: string;
          owner_id?: string;
          paused_reason?: string | null;
          postal_address?: string | null;
          public_page_enabled?: boolean;
          sentry_project_slug?: string | null;
          slug?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      connection_secrets: {
        Row: {
          ciphertext: string;
          connection_id: string;
          created_at: string;
          iv: string;
          tag: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          ciphertext: string;
          connection_id: string;
          created_at?: string;
          iv: string;
          tag: string;
          updated_at?: string;
        };
        Update: {
          ciphertext?: string;
          connection_id?: string;
          created_at?: string;
          iv?: string;
          tag?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connection_secrets_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: true;
            referencedRelation: "connections";
            referencedColumns: ["id"];
          },
        ];
      };
      connections: {
        Row: {
          account_label: string;
          created_at: string;
          id: string;
          provider: string;
          scopes: string[];
          status: string;
          updated_at: string;
          user_id: string;
          vault_secret_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_label?: string;
          created_at?: string;
          id?: string;
          provider: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id: string;
          vault_secret_id?: string | null;
        };
        Update: {
          account_label?: string;
          created_at?: string;
          id?: string;
          provider?: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id?: string;
          vault_secret_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "connections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_entries: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          kind: string;
          note: string;
          ref: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          kind: string;
          note?: string;
          ref: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          note?: string;
          ref?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      decision_cards: {
        Row: {
          action_id: string | null;
          action_kind: string;
          answered_at: string | null;
          answered_by: string | null;
          answered_option_id: string | null;
          company_id: string;
          cost_usd: number;
          created_at: string;
          day: string;
          default_option_id: string | null;
          due_at: string;
          expected_impact: string | null;
          id: string;
          merge_key: string;
          opened_at: string;
          options: NonNullable<Json>;
          question: string;
          rationale: string;
          recommended_option_id: string;
          seq: number;
          task_id: string | null;
          tier: string;
        };
        ComputedFields: never;
        Insert: {
          action_id?: string | null;
          action_kind: string;
          answered_at?: string | null;
          answered_by?: string | null;
          answered_option_id?: string | null;
          company_id: string;
          cost_usd?: number;
          created_at?: string;
          day?: string;
          default_option_id?: string | null;
          due_at: string;
          expected_impact?: string | null;
          id?: string;
          merge_key?: string;
          opened_at?: string;
          options: NonNullable<Json>;
          question: string;
          rationale: string;
          recommended_option_id: string;
          seq?: number;
          task_id?: string | null;
          tier: string;
        };
        Update: {
          action_id?: string | null;
          action_kind?: string;
          answered_at?: string | null;
          answered_by?: string | null;
          answered_option_id?: string | null;
          company_id?: string;
          cost_usd?: number;
          created_at?: string;
          day?: string;
          default_option_id?: string | null;
          due_at?: string;
          expected_impact?: string | null;
          id?: string;
          merge_key?: string;
          opened_at?: string;
          options?: NonNullable<Json>;
          question?: string;
          rationale?: string;
          recommended_option_id?: string;
          seq?: number;
          task_id?: string | null;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "decision_cards_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: false;
            referencedRelation: "actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decision_cards_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decision_cards_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      entitlements: {
        Row: {
          cancel_at: string | null;
          company_limit: number;
          created_at: string;
          ended_at: string | null;
          last_event_created: number | null;
          monthly_credits: number;
          period_end: string;
          period_start: string;
          plan_id: string;
          price_usd: number;
          purge_due: boolean;
          purge_started_at: string | null;
          retention_until: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          cancel_at?: string | null;
          company_limit: number;
          created_at?: string;
          ended_at?: string | null;
          last_event_created?: number | null;
          monthly_credits: number;
          period_end: string;
          period_start: string;
          plan_id: string;
          price_usd?: number;
          purge_due?: boolean;
          purge_started_at?: string | null;
          retention_until?: string | null;
          status: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at?: string | null;
          company_limit?: number;
          created_at?: string;
          ended_at?: string | null;
          last_event_created?: number | null;
          monthly_credits?: number;
          period_end?: string;
          period_start?: string;
          plan_id?: string;
          price_usd?: number;
          purge_due?: boolean;
          purge_started_at?: string | null;
          retention_until?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entitlements_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      exports: {
        Row: {
          bytes: number | null;
          company_id: string | null;
          created_at: string;
          error: string | null;
          expires_at: string | null;
          id: string;
          include_archived: boolean;
          kind: string;
          manifest: Json | null;
          status: string;
          storage_path: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bytes?: number | null;
          company_id?: string | null;
          created_at?: string;
          error?: string | null;
          expires_at?: string | null;
          id?: string;
          include_archived?: boolean;
          kind: string;
          manifest?: Json | null;
          status?: string;
          storage_path?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bytes?: number | null;
          company_id?: string | null;
          created_at?: string;
          error?: string | null;
          expires_at?: string | null;
          id?: string;
          include_archived?: boolean;
          kind?: string;
          manifest?: Json | null;
          status?: string;
          storage_path?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exports_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exports_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          company_id: string;
          created_at: string;
          due_date: string;
          id: string;
          metric_key: string;
          status: string;
          target_value: number;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          due_date: string;
          id?: string;
          metric_key: string;
          status?: string;
          target_value: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          due_date?: string;
          id?: string;
          metric_key?: string;
          status?: string;
          target_value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "goals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          batch_id: string | null;
          company_id: string;
          company_name: string;
          contact_action_id: string | null;
          created_at: string;
          email: string;
          id: string;
          message_id: string | null;
          name: string;
          source: string;
          status: string;
          updated_at: string;
          why: string;
        };
        ComputedFields: never;
        Insert: {
          batch_id?: string | null;
          company_id: string;
          company_name?: string;
          contact_action_id?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          message_id?: string | null;
          name: string;
          source: string;
          status?: string;
          updated_at?: string;
          why?: string;
        };
        Update: {
          batch_id?: string | null;
          company_id?: string;
          company_name?: string;
          contact_action_id?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          message_id?: string | null;
          name?: string;
          source?: string;
          status?: string;
          updated_at?: string;
          why?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          action_id: string | null;
          after_value: number;
          attribution_note: string;
          before_value: number;
          campaign_id: string | null;
          channel: string;
          company_id: string;
          cost_usd: number;
          created_at: string;
          id: string;
          metric_key: string;
          provenance: Json | null;
          task_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action_id?: string | null;
          after_value: number;
          attribution_note?: string;
          before_value: number;
          campaign_id?: string | null;
          channel: string;
          company_id: string;
          cost_usd?: number;
          created_at?: string;
          id?: string;
          metric_key: string;
          provenance?: Json | null;
          task_id?: string | null;
        };
        Update: {
          action_id?: string | null;
          after_value?: number;
          attribution_note?: string;
          before_value?: number;
          campaign_id?: string | null;
          channel?: string;
          company_id?: string;
          cost_usd?: number;
          created_at?: string;
          id?: string;
          metric_key?: string;
          provenance?: Json | null;
          task_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: false;
            referencedRelation: "actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      memory_items: {
        Row: {
          company_id: string;
          content: string;
          created_at: string;
          created_by_role: string;
          embedding: string | null;
          id: string;
          kind: string;
          search: unknown;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          content: string;
          created_at?: string;
          created_by_role?: string;
          embedding?: string | null;
          id?: string;
          kind: string;
          search?: never;
          title: string;
        };
        Update: {
          company_id?: string;
          content?: string;
          created_at?: string;
          created_by_role?: string;
          embedding?: string | null;
          id?: string;
          kind?: string;
          search?: never;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memory_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      metrics: {
        Row: {
          company_id: string;
          id: string;
          measured_at: string;
          metric_key: string;
          provenance: Json | null;
          provenance_key: string | null;
          scope: string;
          source: string;
          value: number;
          window_end: string | null;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          id?: string;
          measured_at?: string;
          metric_key: string;
          provenance?: Json | null;
          provenance_key?: string | null;
          scope?: string;
          source: string;
          value: number;
          window_end?: string | null;
        };
        Update: {
          company_id?: string;
          id?: string;
          measured_at?: string;
          metric_key?: string;
          provenance?: Json | null;
          provenance_key?: string | null;
          scope?: string;
          source?: string;
          value?: number;
          window_end?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "metrics_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          card_id: string | null;
          channel: string;
          company_id: string;
          created_at: string;
          id: string;
          kind: string;
          payload: NonNullable<Json>;
          status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          card_id?: string | null;
          channel: string;
          company_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          payload?: NonNullable<Json>;
          status: string;
          user_id: string;
        };
        Update: {
          card_id?: string | null;
          channel?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "decision_cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          company_id: string;
          created_at: string;
          goal_id: string | null;
          id: string;
          rationale: string;
          revisions: NonNullable<Json>;
          status: string;
          summary: string;
          week_start: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          goal_id?: string | null;
          id?: string;
          rationale?: string;
          revisions?: NonNullable<Json>;
          status?: string;
          summary: string;
          week_start: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          goal_id?: string | null;
          id?: string;
          rationale?: string;
          revisions?: NonNullable<Json>;
          status?: string;
          summary?: string;
          week_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plans_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plans_goal_id_fkey";
            columns: ["goal_id"];
            isOneToOne: false;
            referencedRelation: "goals";
            referencedColumns: ["id"];
          },
        ];
      };
      public_pages: {
        Row: {
          blurb: string;
          company_id: string;
          created_at: string;
          headline: string;
          listed: boolean;
          metric_keys: string[];
          show_goal: boolean;
          show_site_link: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          blurb?: string;
          company_id: string;
          created_at?: string;
          headline?: string;
          listed?: boolean;
          metric_keys?: string[];
          show_goal?: boolean;
          show_site_link?: boolean;
          updated_at?: string;
        };
        Update: {
          blurb?: string;
          company_id?: string;
          created_at?: string;
          headline?: string;
          listed?: boolean;
          metric_keys?: string[];
          show_goal?: boolean;
          show_site_link?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "public_pages_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      purge_log: {
        Row: {
          counts: NonNullable<Json>;
          id: string;
          purged_at: string;
          reason: string;
          user_hash: string;
        };
        ComputedFields: never;
        Insert: {
          counts: NonNullable<Json>;
          id?: string;
          purged_at?: string;
          reason: string;
          user_hash: string;
        };
        Update: {
          counts?: NonNullable<Json>;
          id?: string;
          purged_at?: string;
          reason?: string;
          user_hash?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      signals: {
        Row: {
          card_week: string | null;
          company_id: string;
          converted_card_id: string | null;
          converted_task_id: string | null;
          created_at: string;
          evidence_urls: NonNullable<Json>;
          excerpt: string;
          id: string;
          kind: string;
          observed_at: string;
          payload: NonNullable<Json>;
          rationale: string;
          score: number;
          scored_at: string | null;
          source: string;
          source_ref: string;
          status: string;
          summary: string;
          title: string;
          updated_at: string;
          url: string | null;
        };
        ComputedFields: never;
        Insert: {
          card_week?: string | null;
          company_id: string;
          converted_card_id?: string | null;
          converted_task_id?: string | null;
          created_at?: string;
          evidence_urls?: NonNullable<Json>;
          excerpt?: string;
          id?: string;
          kind?: string;
          observed_at?: string;
          payload?: NonNullable<Json>;
          rationale?: string;
          score?: number;
          scored_at?: string | null;
          source: string;
          source_ref: string;
          status?: string;
          summary?: string;
          title?: string;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          card_week?: string | null;
          company_id?: string;
          converted_card_id?: string | null;
          converted_task_id?: string | null;
          created_at?: string;
          evidence_urls?: NonNullable<Json>;
          excerpt?: string;
          id?: string;
          kind?: string;
          observed_at?: string;
          payload?: NonNullable<Json>;
          rationale?: string;
          score?: number;
          scored_at?: string | null;
          source?: string;
          source_ref?: string;
          status?: string;
          summary?: string;
          title?: string;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signals_converted_card_id_fkey";
            columns: ["converted_card_id"];
            isOneToOne: false;
            referencedRelation: "decision_cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signals_converted_task_id_fkey";
            columns: ["converted_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      suppressions: {
        Row: {
          company_id: string;
          created_at: string;
          domain: string | null;
          email: string;
          id: string;
          reason: string;
          source_action_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          domain?: never;
          email: string;
          id?: string;
          reason: string;
          source_action_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          domain?: never;
          email?: string;
          id?: string;
          reason?: string;
          source_action_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "suppressions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "suppressions_source_action_id_fkey";
            columns: ["source_action_id"];
            isOneToOne: false;
            referencedRelation: "actions";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          agent_id: string | null;
          attempts: number;
          company_id: string;
          cost_usd: number;
          created_at: string;
          evidence: Json | null;
          expected_delta: number | null;
          id: string;
          input: NonNullable<Json>;
          last_error: string | null;
          metric_key: string | null;
          output_summary: string | null;
          plan_id: string | null;
          result: NonNullable<Json>;
          role: string;
          status: string;
          task_type: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          agent_id?: string | null;
          attempts?: number;
          company_id: string;
          cost_usd?: number;
          created_at?: string;
          evidence?: Json | null;
          expected_delta?: number | null;
          id?: string;
          input?: NonNullable<Json>;
          last_error?: string | null;
          metric_key?: string | null;
          output_summary?: string | null;
          plan_id?: string | null;
          result?: NonNullable<Json>;
          role: string;
          status?: string;
          task_type?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          agent_id?: string | null;
          attempts?: number;
          company_id?: string;
          cost_usd?: number;
          created_at?: string;
          evidence?: Json | null;
          expected_delta?: number | null;
          id?: string;
          input?: NonNullable<Json>;
          last_error?: string | null;
          metric_key?: string | null;
          output_summary?: string | null;
          plan_id?: string | null;
          result?: NonNullable<Json>;
          role?: string;
          status?: string;
          task_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      theses: {
        Row: {
          clarifications: NonNullable<Json>;
          company_id: string;
          created_at: string;
          id: string;
          target_customer: string;
          text: string;
          version: number;
          why_now: string;
        };
        ComputedFields: never;
        Insert: {
          clarifications?: NonNullable<Json>;
          company_id: string;
          created_at?: string;
          id?: string;
          target_customer?: string;
          text: string;
          version: number;
          why_now?: string;
        };
        Update: {
          clarifications?: NonNullable<Json>;
          company_id?: string;
          created_at?: string;
          id?: string;
          target_customer?: string;
          text?: string;
          version?: number;
          why_now?: string;
        };
        Relationships: [
          {
            foreignKeyName: "theses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      usage: {
        Row: {
          alerted_at: string | null;
          credits_used: number;
          id: string;
          llm_cost_usd: number;
          period: string;
          sandbox_minutes: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          alerted_at?: string | null;
          credits_used?: number;
          id?: string;
          llm_cost_usd?: number;
          period: string;
          sandbox_minutes?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          alerted_at?: string | null;
          credits_used?: number;
          id?: string;
          llm_cost_usd?: number;
          period?: string;
          sandbox_minutes?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          brief_hour: number;
          created_at: string;
          daily_decision_quota: number;
          email: string;
          id: string;
          plan: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          brief_hour?: number;
          created_at?: string;
          daily_decision_quota?: number;
          email: string;
          id: string;
          plan?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          brief_hour?: number;
          created_at?: string;
          daily_decision_quota?: number;
          email?: string;
          id?: string;
          plan?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_budget_spend: {
        Args: {
          p_amount: number;
          p_category: string;
          p_company_id: string;
          p_day?: string;
        };
        Returns: Json;
      };
      billing_events_sweep_unknown: {
        Args: { p_before: string };
        Returns: number;
      };
      budget_apply: {
        Args: {
          p_category: string;
          p_company_id: string;
          p_day: string;
          p_extra: number;
          p_spend: number;
          p_total: number;
        };
        Returns: Json;
      };
      credit_balance: { Args: { p_user_id: string }; Returns: number };
      credit_reserve: {
        Args: { p_ref: string; p_user_id: string };
        Returns: string;
      };
      first_contact_addresses: { Args: { p_payload: Json }; Returns: string[] };
      grant_trial_entitlement: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      held_outreach_addresses: {
        Args: { p_company: string };
        Returns: string[];
      };
      is_company_owner: {
        Args: { target_company_id: string };
        Returns: boolean;
      };
      lock_outreach_held: {
        Args: { p_addresses: string[]; p_company: string };
        Returns: string;
      };
      open_first_contact_card: {
        Args: { p_action: Json; p_card: Json };
        Returns: Json;
      };
      owner_local_date: { Args: { p_company_id: string }; Returns: string };
      public_page_view: { Args: { p_slug: string }; Returns: Json };
      purge_begin: { Args: { p_user_id: string }; Returns: string };
      purge_owner: {
        Args: { p_reason: string; p_user_id: string };
        Returns: Json;
      };
      raise_daily_cap: {
        Args: {
          p_amount: number;
          p_category: string;
          p_company_id: string;
          p_day?: string;
        };
        Returns: Json;
      };
      raise_total_cap: {
        Args: { p_amount: number; p_category: string; p_company_id: string };
        Returns: Json;
      };
      record_attribution: { Args: { payload: Json }; Returns: Json };
      record_auto_first_contact: { Args: { p_action: Json }; Returns: Json };
      search_memory: {
        Args: { p_company_id: string; p_limit?: number; p_query: string };
        Returns: {
          content: string;
          id: string;
          kind: string;
          rank: number;
          title: string;
        }[];
      };
      usage_apply: {
        Args: {
          p_cost_usd: number;
          p_credits: number;
          p_period: string;
          p_sandbox_minutes: number;
          p_user_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
