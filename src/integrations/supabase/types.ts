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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          agent_id: string
          conversation_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          latency_ms: number | null
          output: Json | null
          parent_run_id: string | null
          started_at: string | null
          status: string
          tokens_input: number | null
          tokens_output: number | null
          user_id: string
        }
        Insert: {
          agent_id: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          latency_ms?: number | null
          output?: Json | null
          parent_run_id?: string | null
          started_at?: string | null
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id: string
        }
        Update: {
          agent_id?: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          latency_ms?: number | null
          output?: Json | null
          parent_run_id?: string | null
          started_at?: string | null
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          agent_id: string
          created_at: string
          permissions: Json
          tool_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          permissions?: Json
          tool_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          permissions?: Json
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          capabilities: Json
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          model: string | null
          name: string
          owner_id: string
          role: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          model?: string | null
          name: string
          owner_id: string
          role?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          model?: string | null
          name?: string
          owner_id?: string
          role?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          metadata: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      device_commands: {
        Row: {
          command: string
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          device_id: string
          direction: string
          id: string
          payload: Json
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          command: string
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id: string
          direction: string
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          command?: string
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id?: string
          direction?: string
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          last_seen_at: string | null
          metadata: Json
          name: string
          pairing_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          last_seen_at?: string | null
          metadata?: Json
          name: string
          pairing_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          last_seen_at?: string | null
          metadata?: Json
          name?: string
          pairing_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      event_log: {
        Row: {
          created_at: string
          id: string
          level: string
          message: string
          metadata: Json
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          message: string
          metadata?: Json
          source: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          message?: string
          metadata?: Json
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      memories: {
        Row: {
          agent_id: string | null
          created_at: string
          embedding: Json | null
          id: string
          importance: number
          key: string | null
          kind: string
          source: string | null
          tags: string[]
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          embedding?: Json | null
          id?: string
          importance?: number
          key?: string | null
          kind?: string
          source?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          embedding?: Json | null
          id?: string
          importance?: number
          key?: string | null
          kind?: string
          source?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "memories_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          role: string
          run_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
          run_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
          run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          id: string
          owner_id: string
          source: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          owner_id: string
          source?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          owner_id?: string
          source?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_events: {
        Row: {
          created_at: string
          id: string
          level: string
          message: string
          meta: Json
          owner_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          message: string
          meta?: Json
          owner_id: string
          source: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          message?: string
          meta?: Json
          owner_id?: string
          source?: string
        }
        Relationships: []
      }
      tools: {
        Row: {
          created_at: string
          description: string | null
          handler_kind: string
          id: string
          input_schema: Json
          is_enabled: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          handler_kind?: string
          id?: string
          input_schema?: Json
          is_enabled?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          handler_kind?: string
          id?: string
          input_schema?: Json
          is_enabled?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["app_role"]
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
      user_secrets: {
        Row: {
          created_at: string
          gemini_api_key: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gemini_api_key?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gemini_api_key?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          chat_routing: string
          created_at: string
          default_model: string
          owner_id: string
          updated_at: string
          voice_language: string
          wake_word_enabled: boolean
        }
        Insert: {
          chat_routing?: string
          created_at?: string
          default_model?: string
          owner_id: string
          updated_at?: string
          voice_language?: string
          wake_word_enabled?: boolean
        }
        Update: {
          chat_routing?: string
          created_at?: string
          default_model?: string
          owner_id?: string
          updated_at?: string
          voice_language?: string
          wake_word_enabled?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
