import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
  position: number;
};

export type SchemaTable = {
  name: string;
  rls_enabled: boolean;
  columns: SchemaColumn[];
};

export type SchemaForeignKey = {
  table: string;
  column: string;
  ref_table: string;
  ref_column: string;
  constraint: string;
};

export type SchemaPolicy = {
  table: string;
  name: string;
  command: string;
  roles: string[];
  permissive: string;
  using: string | null;
  with_check: string | null;
};

export type SchemaEnum = {
  name: string;
  values: string[];
};

export type SchemaSnapshot = {
  tables: SchemaTable[];
  foreign_keys: SchemaForeignKey[];
  policies: SchemaPolicy[];
  enums: SchemaEnum[];
  generated_at: string;
};

export const getSchemaSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SchemaSnapshot> => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("get_public_schema_snapshot" as never);
    if (error) throw new Error(error.message);
    return data as unknown as SchemaSnapshot;
  });