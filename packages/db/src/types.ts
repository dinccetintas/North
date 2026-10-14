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
      briefs: {
        Row: {
          brief_date: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          brief_date: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at?: string;
          id?: string;
        };
        Update: {
          brief_date?: string;
          company_id?: string;
          content?: NonNullable<Json>;
          created_at?: string;
          id?: string;
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
      companies: {
        Row: {
          created_at: string;
          id: string;
          kill_switch_active: boolean;
          name: string;
          onboarding_step: string;
          owner_id: string;
          public_page_enabled: boolean;
          slug: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          name: string;
          onboarding_step?: string;
          owner_id: string;
          public_page_enabled?: boolean;
          slug: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          name?: string;
          onboarding_step?: string;
          owner_id?: string;
          public_page_enabled?: boolean;
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
      connections: {
        Row: {
          created_at: string;
          id: string;
          provider: string;
          scopes: string[];
          status: string;
          user_id: string;
          vault_secret_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          provider: string;
          scopes?: string[];
          status?: string;
          user_id: string;
          vault_secret_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          provider?: string;
          scopes?: string[];
          status?: string;
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
          options: NonNullable<Json>;
          question: string;
          rationale: string;
          recommended_option_id: string;
          seq: number;
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
      ledger_entries: {
        Row: {
          after_value: number;
          attribution_note: string;
          before_value: number;
          channel: string;
          company_id: string;
          cost_usd: number;
          created_at: string;
          id: string;
          metric_key: string;
          task_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          after_value: number;
          attribution_note?: string;
          before_value: number;
          channel: string;
          company_id: string;
          cost_usd?: number;
          created_at?: string;
          id?: string;
          metric_key: string;
          task_id?: string | null;
        };
        Update: {
          after_value?: number;
          attribution_note?: string;
          before_value?: number;
          channel?: string;
          company_id?: string;
          cost_usd?: number;
          created_at?: string;
          id?: string;
          metric_key?: string;
          task_id?: string | null;
        };
        Relationships: [
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
          source: string;
          value: number;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          id?: string;
          measured_at?: string;
          metric_key: string;
          source: string;
          value: number;
        };
        Update: {
          company_id?: string;
          id?: string;
          measured_at?: string;
          metric_key?: string;
          source?: string;
          value?: number;
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
          company_id: string;
          converted_card_id: string | null;
          created_at: string;
          evidence_urls: NonNullable<Json>;
          id: string;
          score: number;
          source: string;
          summary: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          converted_card_id?: string | null;
          created_at?: string;
          evidence_urls?: NonNullable<Json>;
          id?: string;
          score?: number;
          source: string;
          summary: string;
        };
        Update: {
          company_id?: string;
          converted_card_id?: string | null;
          created_at?: string;
          evidence_urls?: NonNullable<Json>;
          id?: string;
          score?: number;
          source?: string;
          summary?: string;
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
          credits_used: number;
          id: string;
          llm_cost_usd: number;
          period: string;
          sandbox_minutes: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          credits_used?: number;
          id?: string;
          llm_cost_usd?: number;
          period: string;
          sandbox_minutes?: number;
          user_id: string;
        };
        Update: {
          credits_used?: number;
          id?: string;
          llm_cost_usd?: number;
          period?: string;
          sandbox_minutes?: number;
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
          created_at?: string;
          daily_decision_quota?: number;
          email: string;
          id: string;
          plan?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
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
      is_company_owner: {
        Args: { target_company_id: string };
        Returns: boolean;
      };
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
