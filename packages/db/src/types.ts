// Placeholder until `pnpm db:types` regenerates this file from the local stack.
// Only the tables used before generation are typed here.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          timezone: string;
          daily_decision_quota: number;
          plan: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          timezone?: string;
          daily_decision_quota?: number;
          plan?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          timezone?: string;
          daily_decision_quota?: number;
          plan?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          status: string;
          kill_switch_active: boolean;
          public_page_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          slug: string;
          status?: string;
          kill_switch_active?: boolean;
          public_page_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          slug?: string;
          status?: string;
          kill_switch_active?: boolean;
          public_page_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      theses: {
        Row: {
          id: string;
          company_id: string;
          version: number;
          text: string;
          target_customer: string;
          why_now: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          version: number;
          text: string;
          target_customer?: string;
          why_now?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          version?: number;
          text?: string;
          target_customer?: string;
          why_now?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
