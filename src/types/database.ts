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
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          email: string | null;
          role: "admin" | "user" | "viewer";
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          email?: string | null;
          role?: "admin" | "user" | "viewer";
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          email?: string | null;
          role?: "admin" | "user" | "viewer";
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      workplaces: {
        Row: {
          id: string;
          name: string;
          color: string | null;
          is_dayoff: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string | null;
          is_dayoff?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          color?: string | null;
          is_dayoff?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_status: {
        Row: {
          id: string;
          user_id: string;
          work_date: string;
          workplace_id: string;
          workplace_ids: string[] | null;
          note: string | null;
          overtime_enabled: boolean;
          overtime_hours: number;
          leave_hours: number;
          entered_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          work_date: string;
          workplace_id: string;
          workplace_ids?: string[] | null;
          note?: string | null;
          overtime_enabled?: boolean;
          overtime_hours?: number;
          leave_hours?: number;
          entered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          work_date?: string;
          workplace_id?: string;
          workplace_ids?: string[] | null;
          note?: string | null;
          overtime_enabled?: boolean;
          overtime_hours?: number;
          leave_hours?: number;
          entered_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_status_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_status_workplace_id_fkey";
            columns: ["workplace_id"];
            isOneToOne: false;
            referencedRelation: "workplaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ot_periods: {
        Row: {
          id: string;
          start_date: string;
          end_date: string;
          auto_calculate: boolean;
          auto_start_day: number | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          start_date: string;
          end_date: string;
          auto_calculate?: boolean;
          auto_start_day?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          start_date?: string;
          end_date?: string;
          auto_calculate?: boolean;
          auto_start_day?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      activity_logs: {
        Row: {
          id: string;
          user_id: string | null;
          event_type: "login" | "create" | "update" | "delete";
          target_table: string | null;
          target_id: string | null;
          detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          event_type: "login" | "create" | "update" | "delete";
          target_table?: string | null;
          target_id?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          event_type?: "login" | "create" | "update" | "delete";
          target_table?: string | null;
          target_id?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Workplace = Database["public"]["Tables"]["workplaces"]["Row"];
export type DailyStatus = Database["public"]["Tables"]["daily_status"]["Row"];
export type OtPeriod = Database["public"]["Tables"]["ot_periods"]["Row"];
export type ActivityLog = Database["public"]["Tables"]["activity_logs"]["Row"];

export type CalendarStatus = DailyStatus & {
  profile?: Profile;
  workplace?: Workplace;
  workplaces?: Workplace[];
};
