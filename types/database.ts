// Tipos de la base de Rebucret (esquema public). ARCHIVO GENERADO: no editar a mano.
// Generado el 02/10/2026 desde la base con scripts/generar-tipos.mjs (ver supabase/migrations/README.md).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
          plant_id: string | null
          reference: string | null
          user_name: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          plant_id?: string | null
          reference?: string | null
          user_name: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          plant_id?: string | null
          reference?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          active: boolean | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          role: string
          ve_funciones_nuevas: boolean
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          role?: string
          ve_funciones_nuevas?: boolean
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          role?: string
          ve_funciones_nuevas?: boolean
        }
        Relationships: []
      }
      carriers: {
        Row: {
          created_at: string | null
          driver_name: string | null
          id: string
          name: string
          phone: string | null
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          driver_name?: string | null
          id?: string
          name: string
          phone?: string | null
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          driver_name?: string | null
          id?: string
          name?: string
          phone?: string | null
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carriers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      choferes: {
        Row: {
          activo: boolean
          created_at: string
          dni: string | null
          id: string
          nombre: string
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          dni?: string | null
          id?: string
          nombre: string
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          dni?: string | null
          id?: string
          nombre?: string
          telefono?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          active: boolean | null
          cond_iva: string | null
          cond_pago: string | null
          contact: string | null
          cp: string | null
          created_at: string | null
          cuit: string | null
          direccion_fiscal: string | null
          email: string | null
          id: string
          localidad_cliente: string | null
          name: string
          phone: string | null
          plant_id: string | null
          provincia: string | null
          razon_social: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          cond_iva?: string | null
          cond_pago?: string | null
          contact?: string | null
          cp?: string | null
          created_at?: string | null
          cuit?: string | null
          direccion_fiscal?: string | null
          email?: string | null
          id?: string
          localidad_cliente?: string | null
          name: string
          phone?: string | null
          plant_id?: string | null
          provincia?: string | null
          razon_social?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          cond_iva?: string | null
          cond_pago?: string | null
          contact?: string | null
          cp?: string | null
          created_at?: string | null
          cuit?: string | null
          direccion_fiscal?: string | null
          email?: string | null
          id?: string
          localidad_cliente?: string | null
          name?: string
          phone?: string | null
          plant_id?: string | null
          provincia?: string | null
          razon_social?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_sites: {
        Row: {
          address: string | null
          client_id: string
          created_at: string | null
          gps_lat: number | null
          gps_lng: number | null
          gps_source: string | null
          gps_updated_at: string | null
          id: string
          localidad: string | null
          name: string
          observations: string | null
          reception_hours_end: string | null
          reception_hours_start: string | null
          requires_pump: boolean | null
          site_contact: string | null
          site_phone: string | null
          status: string | null
          travel_distance_km: number | null
          travel_time_minutes: number | null
          unload_time_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          client_id: string
          created_at?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          gps_source?: string | null
          gps_updated_at?: string | null
          id?: string
          localidad?: string | null
          name: string
          observations?: string | null
          reception_hours_end?: string | null
          reception_hours_start?: string | null
          requires_pump?: boolean | null
          site_contact?: string | null
          site_phone?: string | null
          status?: string | null
          travel_distance_km?: number | null
          travel_time_minutes?: number | null
          unload_time_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          client_id?: string
          created_at?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          gps_source?: string | null
          gps_updated_at?: string | null
          id?: string
          localidad?: string | null
          name?: string
          observations?: string | null
          reception_hours_end?: string | null
          reception_hours_start?: string | null
          requires_pump?: boolean | null
          site_contact?: string | null
          site_phone?: string | null
          status?: string | null
          travel_distance_km?: number | null
          travel_time_minutes?: number | null
          unload_time_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stockpile_humidity: {
        Row: {
          created_at: string | null
          dry_weight_grams: number | null
          humidity_percent: number
          id: string
          material_id: string
          plant_id: string
          reading_date: string
          recorded_by: string | null
          wet_weight_grams: number | null
        }
        Insert: {
          created_at?: string | null
          dry_weight_grams?: number | null
          humidity_percent: number
          id?: string
          material_id: string
          plant_id: string
          reading_date?: string
          recorded_by?: string | null
          wet_weight_grams?: number | null
        }
        Update: {
          created_at?: string | null
          dry_weight_grams?: number | null
          humidity_percent?: number
          id?: string
          material_id?: string
          plant_id?: string
          reading_date?: string
          recorded_by?: string | null
          wet_weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_stockpile_humidity_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_stockpile_humidity_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_materials: {
        Row: {
          created_at: string | null
          dispatch_id: string
          dry_quantity: number | null
          humidity_at_dispatch: number | null
          id: string
          material_id: string
          quantity: number
          wet_quantity: number | null
        }
        Insert: {
          created_at?: string | null
          dispatch_id: string
          dry_quantity?: number | null
          humidity_at_dispatch?: number | null
          id?: string
          material_id: string
          quantity: number
          wet_quantity?: number | null
        }
        Update: {
          created_at?: string | null
          dispatch_id?: string
          dry_quantity?: number | null
          humidity_at_dispatch?: number | null
          id?: string
          material_id?: string
          quantity?: number
          wet_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_materials_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_status_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          id: string
          new_status: string
          notes: string | null
          previous_status: string | null
          scheduled_dispatch_id: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_status: string
          notes?: string | null
          previous_status?: string | null
          scheduled_dispatch_id: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_status?: string
          notes?: string | null
          previous_status?: string | null
          scheduled_dispatch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_status_log_scheduled_dispatch_id_fkey"
            columns: ["scheduled_dispatch_id"]
            isOneToOne: false
            referencedRelation: "scheduled_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatches: {
        Row: {
          actual_slump_cm: number | null
          chofer_id: string | null
          client: string | null
          client_id: string | null
          construction_site_id: string | null
          created_at: string | null
          created_by: string | null
          dispatch_date: string | null
          extra_water_liters: number | null
          formula_id: string
          id: string
          is_test_dispatch: boolean | null
          mixer_id: string | null
          notes: string | null
          obra: string | null
          plant_id: string | null
          quantity_m3: number
          remito: string | null
          sample_number: string | null
          sample_taken: boolean | null
          sand_stockpile_humidity: number | null
          scheduled_dispatch_id: string | null
        }
        Insert: {
          actual_slump_cm?: number | null
          chofer_id?: string | null
          client?: string | null
          client_id?: string | null
          construction_site_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dispatch_date?: string | null
          extra_water_liters?: number | null
          formula_id: string
          id?: string
          is_test_dispatch?: boolean | null
          mixer_id?: string | null
          notes?: string | null
          obra?: string | null
          plant_id?: string | null
          quantity_m3: number
          remito?: string | null
          sample_number?: string | null
          sample_taken?: boolean | null
          sand_stockpile_humidity?: number | null
          scheduled_dispatch_id?: string | null
        }
        Update: {
          actual_slump_cm?: number | null
          chofer_id?: string | null
          client?: string | null
          client_id?: string | null
          construction_site_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dispatch_date?: string | null
          extra_water_liters?: number | null
          formula_id?: string
          id?: string
          is_test_dispatch?: boolean | null
          mixer_id?: string | null
          notes?: string | null
          obra?: string | null
          plant_id?: string | null
          quantity_m3?: number
          remito?: string | null
          sample_number?: string | null
          sample_taken?: boolean | null
          sand_stockpile_humidity?: number | null
          scheduled_dispatch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatches_chofer_id_fkey"
            columns: ["chofer_id"]
            isOneToOne: false
            referencedRelation: "choferes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_construction_site_id_fkey"
            columns: ["construction_site_id"]
            isOneToOne: false
            referencedRelation: "construction_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_formula_id_fkey"
            columns: ["formula_id"]
            isOneToOne: false
            referencedRelation: "formulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_mixer_id_fkey"
            columns: ["mixer_id"]
            isOneToOne: false
            referencedRelation: "mixers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_scheduled_dispatch_id_fkey"
            columns: ["scheduled_dispatch_id"]
            isOneToOne: false
            referencedRelation: "scheduled_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas_bombeo: {
        Row: {
          activo: boolean
          contacto: string | null
          created_at: string
          id: string
          nombre: string
          observaciones: string | null
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          contacto?: string | null
          created_at?: string
          id?: string
          nombre: string
          observaciones?: string | null
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          contacto?: string | null
          created_at?: string
          id?: string
          nombre?: string
          observaciones?: string | null
          telefono?: string | null
        }
        Relationships: []
      }
      formula_materials: {
        Row: {
          created_at: string | null
          formula_id: string
          id: string
          material_id: string
          quantity: number
        }
        Insert: {
          created_at?: string | null
          formula_id: string
          id?: string
          material_id: string
          quantity: number
        }
        Update: {
          created_at?: string | null
          formula_id?: string
          id?: string
          material_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "formula_materials_formula_id_fkey"
            columns: ["formula_id"]
            isOneToOne: false
            referencedRelation: "formulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formula_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      formulas: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          name: string
          plant_id: string | null
          updated_at: string | null
          updated_by: string | null
          useful_life_minutes: number | null
          yield_m3: number
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          plant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          useful_life_minutes?: number | null
          yield_m3?: number
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          plant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          useful_life_minutes?: number | null
          yield_m3?: number
        }
        Relationships: [
          {
            foreignKeyName: "formulas_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      granulometria_sieve_results: {
        Row: {
          created_at: string | null
          id: string
          percent_passing: number
          percent_retained: number
          percent_retained_cumulative: number
          retained_cumulative_grams: number
          retained_grams: number
          sieve_size: string
          test_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          percent_passing: number
          percent_retained: number
          percent_retained_cumulative: number
          retained_cumulative_grams: number
          retained_grams: number
          sieve_size: string
          test_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          percent_passing?: number
          percent_retained?: number
          percent_retained_cumulative?: number
          retained_cumulative_grams?: number
          retained_grams?: number
          sieve_size?: string
          test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "granulometria_sieve_results_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "granulometria_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      granulometria_tests: {
        Row: {
          aggregate_type: string
          comments: string | null
          created_at: string | null
          dry_weight_grams: number | null
          extraction_date: string
          fineness_modulus: number | null
          id: string
          material_id: string | null
          moisture_percent: number | null
          plant_id: string | null
          provider: string
          remito: string | null
          sample_weight_grams: number
          stock_entry_id: string | null
          supplier_id: string | null
          test_date: string | null
          updated_at: string | null
        }
        Insert: {
          aggregate_type: string
          comments?: string | null
          created_at?: string | null
          dry_weight_grams?: number | null
          extraction_date: string
          fineness_modulus?: number | null
          id?: string
          material_id?: string | null
          moisture_percent?: number | null
          plant_id?: string | null
          provider: string
          remito?: string | null
          sample_weight_grams: number
          stock_entry_id?: string | null
          supplier_id?: string | null
          test_date?: string | null
          updated_at?: string | null
        }
        Update: {
          aggregate_type?: string
          comments?: string | null
          created_at?: string | null
          dry_weight_grams?: number | null
          extraction_date?: string
          fineness_modulus?: number | null
          id?: string
          material_id?: string | null
          moisture_percent?: number | null
          plant_id?: string | null
          provider?: string
          remito?: string | null
          sample_weight_grams?: number
          stock_entry_id?: string | null
          supplier_id?: string | null
          test_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "granulometria_tests_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granulometria_tests_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granulometria_tests_stock_entry_id_fkey"
            columns: ["stock_entry_id"]
            isOneToOne: false
            referencedRelation: "stock_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granulometria_tests_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      humidity_excess_log: {
        Row: {
          created_at: string | null
          credit_note_number: string | null
          credited: boolean | null
          credited_at: string | null
          entry_date: string
          excess_humidity_percentage: number
          excess_quantity_kg: number
          excess_quantity_tn: number
          humidity_percentage: number
          id: string
          material_id: string
          original_quantity_kg: number
          plant_id: string | null
          remito: string | null
          stock_entry_id: string
          supplier_id: string
          tolerance_percentage: number | null
        }
        Insert: {
          created_at?: string | null
          credit_note_number?: string | null
          credited?: boolean | null
          credited_at?: string | null
          entry_date: string
          excess_humidity_percentage: number
          excess_quantity_kg: number
          excess_quantity_tn: number
          humidity_percentage: number
          id?: string
          material_id: string
          original_quantity_kg: number
          plant_id?: string | null
          remito?: string | null
          stock_entry_id: string
          supplier_id: string
          tolerance_percentage?: number | null
        }
        Update: {
          created_at?: string | null
          credit_note_number?: string | null
          credited?: boolean | null
          credited_at?: string | null
          entry_date?: string
          excess_humidity_percentage?: number
          excess_quantity_kg?: number
          excess_quantity_tn?: number
          humidity_percentage?: number
          id?: string
          material_id?: string
          original_quantity_kg?: number
          plant_id?: string | null
          remito?: string | null
          stock_entry_id?: string
          supplier_id?: string
          tolerance_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "humidity_excess_log_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humidity_excess_log_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humidity_excess_log_stock_entry_id_fkey"
            columns: ["stock_entry_id"]
            isOneToOne: false
            referencedRelation: "stock_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "humidity_excess_log_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      integraciones: {
        Row: {
          actualizado: string | null
          clave: string
          conectado_por: string | null
          usuario: string | null
          valor: string
        }
        Insert: {
          actualizado?: string | null
          clave: string
          conectado_por?: string | null
          usuario?: string | null
          valor: string
        }
        Update: {
          actualizado?: string | null
          clave?: string
          conectado_por?: string | null
          usuario?: string | null
          valor?: string
        }
        Relationships: []
      }
      maint_equipment: {
        Row: {
          activo: boolean
          created_at: string | null
          fabricante: string | null
          id: string
          modelo: string | null
          nombre: string
          plant_id: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string | null
          fabricante?: string | null
          id?: string
          modelo?: string | null
          nombre: string
          plant_id?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string | null
          fabricante?: string | null
          id?: string
          modelo?: string | null
          nombre?: string
          plant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maint_equipment_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_executions: {
        Row: {
          created_at: string | null
          fecha: string
          id: string
          m3_acumulado: number | null
          observaciones: string | null
          pasos: Json | null
          realizado_por: string | null
          task_id: string | null
        }
        Insert: {
          created_at?: string | null
          fecha?: string
          id?: string
          m3_acumulado?: number | null
          observaciones?: string | null
          pasos?: Json | null
          realizado_por?: string | null
          task_id?: string | null
        }
        Update: {
          created_at?: string | null
          fecha?: string
          id?: string
          m3_acumulado?: number | null
          observaciones?: string | null
          pasos?: Json | null
          realizado_por?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maint_executions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "maint_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_task_images: {
        Row: {
          epigrafe: string | null
          id: string
          orden: number | null
          task_id: string | null
          url: string
        }
        Insert: {
          epigrafe?: string | null
          id?: string
          orden?: number | null
          task_id?: string | null
          url: string
        }
        Update: {
          epigrafe?: string | null
          id?: string
          orden?: number | null
          task_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "maint_task_images_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "maint_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_task_items: {
        Row: {
          cantidad: number | null
          codigo_repuesto: string | null
          id: string
          item: string
          task_id: string | null
          tipo: string
          unidad: string | null
        }
        Insert: {
          cantidad?: number | null
          codigo_repuesto?: string | null
          id?: string
          item: string
          task_id?: string | null
          tipo?: string
          unidad?: string | null
        }
        Update: {
          cantidad?: number | null
          codigo_repuesto?: string | null
          id?: string
          item?: string
          task_id?: string | null
          tipo?: string
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maint_task_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "maint_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_task_steps: {
        Row: {
          id: string
          orden: number | null
          task_id: string | null
          texto: string
        }
        Insert: {
          id?: string
          orden?: number | null
          task_id?: string | null
          texto: string
        }
        Update: {
          id?: string
          orden?: number | null
          task_id?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "maint_task_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "maint_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_tasks: {
        Row: {
          activo: boolean
          asignado_default: string | null
          codigo: string | null
          componente: string | null
          detalle: string | null
          duracion_min: number | null
          equipment_id: string | null
          frecuencia_dias: number | null
          frecuencia_m3: number | null
          id: string
          orden: number | null
          referencia_manual: string | null
          titulo: string
        }
        Insert: {
          activo?: boolean
          asignado_default?: string | null
          codigo?: string | null
          componente?: string | null
          detalle?: string | null
          duracion_min?: number | null
          equipment_id?: string | null
          frecuencia_dias?: number | null
          frecuencia_m3?: number | null
          id?: string
          orden?: number | null
          referencia_manual?: string | null
          titulo: string
        }
        Update: {
          activo?: boolean
          asignado_default?: string | null
          codigo?: string | null
          componente?: string | null
          detalle?: string | null
          duracion_min?: number | null
          equipment_id?: string | null
          frecuencia_dias?: number | null
          frecuencia_m3?: number | null
          id?: string
          orden?: number | null
          referencia_manual?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maint_tasks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "maint_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_work_order_photos: {
        Row: {
          comentario: string | null
          created_at: string | null
          id: string
          subida_por: string | null
          url: string
          work_order_id: string | null
        }
        Insert: {
          comentario?: string | null
          created_at?: string | null
          id?: string
          subida_por?: string | null
          url: string
          work_order_id?: string | null
        }
        Update: {
          comentario?: string | null
          created_at?: string | null
          id?: string
          subida_por?: string | null
          url?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maint_work_order_photos_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "maint_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maint_work_orders: {
        Row: {
          asignado_a: string | null
          completado_por: string | null
          componente: string | null
          creado_por: string | null
          created_at: string | null
          descripcion: string | null
          equipment_id: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          fecha_programada: string
          id: string
          m3_acumulado: number | null
          numero: number
          observaciones: string | null
          pasos: Json | null
          prioridad: string
          task_id: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          asignado_a?: string | null
          completado_por?: string | null
          componente?: string | null
          creado_por?: string | null
          created_at?: string | null
          descripcion?: string | null
          equipment_id?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fecha_programada?: string
          id?: string
          m3_acumulado?: number | null
          numero?: number
          observaciones?: string | null
          pasos?: Json | null
          prioridad?: string
          task_id?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          asignado_a?: string | null
          completado_por?: string | null
          componente?: string | null
          creado_por?: string | null
          created_at?: string | null
          descripcion?: string | null
          equipment_id?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fecha_programada?: string
          id?: string
          m3_acumulado?: number | null
          numero?: number
          observaciones?: string | null
          pasos?: Json | null
          prioridad?: string
          task_id?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "maint_work_orders_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "maint_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maint_work_orders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "maint_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_material_withdrawals: {
        Row: {
          created_at: string | null
          id: string
          observations: string
          plant_id: string | null
          updated_at: string | null
          withdrawal_date: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          observations: string
          plant_id?: string | null
          updated_at?: string | null
          withdrawal_date: string
        }
        Update: {
          created_at?: string | null
          id?: string
          observations?: string
          plant_id?: string | null
          updated_at?: string | null
          withdrawal_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_material_withdrawals_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_withdrawal_items: {
        Row: {
          created_at: string | null
          id: string
          material_id: string | null
          quantity_kg: number
          withdrawal_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          material_id?: string | null
          quantity_kg: number
          withdrawal_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          material_id?: string | null
          quantity_kg?: number
          withdrawal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_withdrawal_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_withdrawal_items_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "manual_material_withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      material_suppliers: {
        Row: {
          created_at: string | null
          id: string
          material_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          material_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          material_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_suppliers_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          bulk_density: number | null
          bulking_factor_k: number | null
          corrige_humedad: boolean
          created_at: string | null
          current_stock: number
          descuenta_stock: boolean
          dry_stock: number | null
          id: string
          min_stock: number | null
          name: string
          plant_id: string | null
          requires_humidity_control: boolean | null
          stockpile_humidity: number | null
          tipo: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          bulk_density?: number | null
          bulking_factor_k?: number | null
          corrige_humedad?: boolean
          created_at?: string | null
          current_stock?: number
          descuenta_stock?: boolean
          dry_stock?: number | null
          id?: string
          min_stock?: number | null
          name: string
          plant_id?: string | null
          requires_humidity_control?: boolean | null
          stockpile_humidity?: number | null
          tipo: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          bulk_density?: number | null
          bulking_factor_k?: number | null
          corrige_humedad?: boolean
          created_at?: string | null
          current_stock?: number
          descuenta_stock?: boolean
          dry_stock?: number | null
          id?: string
          min_stock?: number | null
          name?: string
          plant_id?: string | null
          requires_humidity_control?: boolean | null
          stockpile_humidity?: number | null
          tipo?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      mixers: {
        Row: {
          active: boolean | null
          brand: string | null
          capacity_m3: number | null
          created_at: string | null
          gps_unit_id: number | null
          id: string
          license_plate: string
          model: string | null
          plant_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          brand?: string | null
          capacity_m3?: number | null
          created_at?: string | null
          gps_unit_id?: number | null
          id?: string
          license_plate: string
          model?: string | null
          plant_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          brand?: string | null
          capacity_m3?: number | null
          created_at?: string | null
          gps_unit_id?: number | null
          id?: string
          license_plate?: string
          model?: string | null
          plant_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mixers_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      plants: {
        Row: {
          bocas_carga: number
          code: string
          created_at: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          jornada_fin: string
          jornada_inicio: string
          name: string
          t_carga_min: number
          t_descarga_bomba_min: number
          t_descarga_directa_min: number
          t_lavado_min: number
          tolerancia_puntualidad_min: number
          updated_at: string | null
        }
        Insert: {
          bocas_carga?: number
          code: string
          created_at?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          jornada_fin?: string
          jornada_inicio?: string
          name: string
          t_carga_min?: number
          t_descarga_bomba_min?: number
          t_descarga_directa_min?: number
          t_lavado_min?: number
          tolerancia_puntualidad_min?: number
          updated_at?: string | null
        }
        Update: {
          bocas_carga?: number
          code?: string
          created_at?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          jornada_fin?: string
          jornada_inicio?: string
          name?: string
          t_carga_min?: number
          t_descarga_bomba_min?: number
          t_descarga_directa_min?: number
          t_lavado_min?: number
          tolerancia_puntualidad_min?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      press_calibrations: {
        Row: {
          calibrated_by: string | null
          calibration_date: string
          certificate_number: string | null
          constant_a: number
          constant_b: number
          constant_c: number
          constant_d: number
          created_at: string | null
          cylinder_diameter_cm: number
          force_unit: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          plant_id: string | null
          updated_at: string | null
        }
        Insert: {
          calibrated_by?: string | null
          calibration_date: string
          certificate_number?: string | null
          constant_a?: number
          constant_b?: number
          constant_c?: number
          constant_d?: number
          created_at?: string | null
          cylinder_diameter_cm?: number
          force_unit?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          plant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          calibrated_by?: string | null
          calibration_date?: string
          certificate_number?: string | null
          constant_a?: number
          constant_b?: number
          constant_c?: number
          constant_d?: number
          created_at?: string | null
          cylinder_diameter_cm?: number
          force_unit?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          plant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "press_calibrations_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_dispatches: {
        Row: {
          actual_arrival_time: string | null
          actual_departure_time: string | null
          actual_load_start_time: string | null
          bomba_empresa_id: string | null
          bomba_hora: string | null
          bomba_la_pone: string | null
          cancelled_reason: string | null
          client_id: string
          confirmado_at: string | null
          confirmado_por: string | null
          construction_site_id: string
          created_at: string | null
          created_by: string | null
          dispatch_id: string | null
          dispatched_m3: number | null
          espaciado_min: number | null
          extra_water_liters: number | null
          fiber_kg_per_m3: number | null
          finalidad: string | null
          formula_id: string
          id: string
          is_urgent: boolean | null
          m3_por_viaje: number
          metodo_descarga: string | null
          mixer_id: string | null
          observations: string | null
          plant_id: string
          quantity_m3: number
          remito: string | null
          scheduled_arrival_time: string
          scheduled_departure_time: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          actual_arrival_time?: string | null
          actual_departure_time?: string | null
          actual_load_start_time?: string | null
          bomba_empresa_id?: string | null
          bomba_hora?: string | null
          bomba_la_pone?: string | null
          cancelled_reason?: string | null
          client_id: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          construction_site_id: string
          created_at?: string | null
          created_by?: string | null
          dispatch_id?: string | null
          dispatched_m3?: number | null
          espaciado_min?: number | null
          extra_water_liters?: number | null
          fiber_kg_per_m3?: number | null
          finalidad?: string | null
          formula_id: string
          id?: string
          is_urgent?: boolean | null
          m3_por_viaje?: number
          metodo_descarga?: string | null
          mixer_id?: string | null
          observations?: string | null
          plant_id: string
          quantity_m3: number
          remito?: string | null
          scheduled_arrival_time: string
          scheduled_departure_time: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_arrival_time?: string | null
          actual_departure_time?: string | null
          actual_load_start_time?: string | null
          bomba_empresa_id?: string | null
          bomba_hora?: string | null
          bomba_la_pone?: string | null
          cancelled_reason?: string | null
          client_id?: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          construction_site_id?: string
          created_at?: string | null
          created_by?: string | null
          dispatch_id?: string | null
          dispatched_m3?: number | null
          espaciado_min?: number | null
          extra_water_liters?: number | null
          fiber_kg_per_m3?: number | null
          finalidad?: string | null
          formula_id?: string
          id?: string
          is_urgent?: boolean | null
          m3_por_viaje?: number
          metodo_descarga?: string | null
          mixer_id?: string | null
          observations?: string | null
          plant_id?: string
          quantity_m3?: number
          remito?: string | null
          scheduled_arrival_time?: string
          scheduled_departure_time?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_dispatches_bomba_empresa_id_fkey"
            columns: ["bomba_empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas_bombeo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_construction_site_id_fkey"
            columns: ["construction_site_id"]
            isOneToOne: false
            referencedRelation: "construction_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_formula_id_fkey"
            columns: ["formula_id"]
            isOneToOne: false
            referencedRelation: "formulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_mixer_id_fkey"
            columns: ["mixer_id"]
            isOneToOne: false
            referencedRelation: "mixers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_dispatches_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entries: {
        Row: {
          carrier_id: string | null
          created_at: string | null
          created_by: string | null
          dry_quantity: number | null
          entry_date: string | null
          granulometry_test_id: string | null
          humidity_percentage: number | null
          id: string
          material_id: string
          notes: string | null
          original_quantity: number | null
          quantity: number
          remito: string | null
          sample_taken_granulometry: boolean | null
          supplier: string | null
          supplier_id: string | null
        }
        Insert: {
          carrier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dry_quantity?: number | null
          entry_date?: string | null
          granulometry_test_id?: string | null
          humidity_percentage?: number | null
          id?: string
          material_id: string
          notes?: string | null
          original_quantity?: number | null
          quantity: number
          remito?: string | null
          sample_taken_granulometry?: boolean | null
          supplier?: string | null
          supplier_id?: string | null
        }
        Update: {
          carrier_id?: string | null
          created_at?: string | null
          created_by?: string | null
          dry_quantity?: number | null
          entry_date?: string | null
          granulometry_test_id?: string | null
          humidity_percentage?: number | null
          id?: string
          material_id?: string
          notes?: string | null
          original_quantity?: number | null
          quantity?: number
          remito?: string | null
          sample_taken_granulometry?: boolean | null
          supplier?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_entries_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_entries_granulometry_test_id_fkey"
            columns: ["granulometry_test_id"]
            isOneToOne: false
            referencedRelation: "granulometria_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_entries_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string | null
          id: string
          material_id: string
          movement_date: string
          movement_type: string
          notes: string | null
          quantity_kg: number
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          material_id: string
          movement_date?: string
          movement_type: string
          notes?: string | null
          quantity_kg: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          material_id?: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          quantity_kg?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      stockpile_cubications: {
        Row: {
          approved: boolean | null
          approved_at: string | null
          approved_by: string | null
          calculated_dry_stock_kg: number
          created_at: string | null
          cubication_date: string
          deviation_kg: number
          deviation_percent: number
          humidity_percent: number
          id: string
          material_id: string
          notes: string | null
          plant_id: string | null
          system_dry_stock_kg: number
          volume_m3: number
        }
        Insert: {
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          calculated_dry_stock_kg: number
          created_at?: string | null
          cubication_date?: string
          deviation_kg: number
          deviation_percent: number
          humidity_percent: number
          id?: string
          material_id: string
          notes?: string | null
          plant_id?: string | null
          system_dry_stock_kg: number
          volume_m3: number
        }
        Update: {
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          calculated_dry_stock_kg?: number
          created_at?: string | null
          cubication_date?: string
          deviation_kg?: number
          deviation_percent?: number
          humidity_percent?: number
          id?: string
          material_id?: string
          notes?: string | null
          plant_id?: string | null
          system_dry_stock_kg?: number
          volume_m3?: number
        }
        Relationships: [
          {
            foreignKeyName: "stockpile_cubications_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stockpile_cubications_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact: string | null
          created_at: string | null
          id: string
          name: string
          phone: string | null
          plant_id: string | null
          updated_at: string | null
        }
        Insert: {
          contact?: string | null
          created_at?: string | null
          id?: string
          name: string
          phone?: string | null
          plant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          contact?: string | null
          created_at?: string | null
          id?: string
          name?: string
          phone?: string | null
          plant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      test_cylinders: {
        Row: {
          actual_test_date: string | null
          comments: string | null
          created_at: string | null
          cylinder_number: number
          dial_reading: number | null
          discard_reason: string | null
          discarded: boolean | null
          dispatch_id: string | null
          id: string
          scheduled_test_date: string
          strength_mpa: number | null
          test_age_days: number
          updated_at: string | null
          weight_grams: number | null
        }
        Insert: {
          actual_test_date?: string | null
          comments?: string | null
          created_at?: string | null
          cylinder_number: number
          dial_reading?: number | null
          discard_reason?: string | null
          discarded?: boolean | null
          dispatch_id?: string | null
          id?: string
          scheduled_test_date: string
          strength_mpa?: number | null
          test_age_days: number
          updated_at?: string | null
          weight_grams?: number | null
        }
        Update: {
          actual_test_date?: string | null
          comments?: string | null
          created_at?: string | null
          cylinder_number?: number
          dial_reading?: number | null
          discard_reason?: string | null
          discarded?: boolean | null
          dispatch_id?: string | null
          id?: string
          scheduled_test_date?: string
          strength_mpa?: number | null
          test_age_days?: number
          updated_at?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "test_cylinders_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      viajes: {
        Row: {
          actualizado_por: string | null
          created_at: string
          dispatch_id: string | null
          estado: string
          hora_carga: string
          hora_fin_descarga: string
          hora_llegada: string
          hora_salida: string
          hora_vuelta: string
          id: string
          m3: number
          m3_planificado: number | null
          mixer_id: string | null
          n: number
          origen: string
          pedido_id: string
          plant_id: string | null
          updated_at: string
        }
        Insert: {
          actualizado_por?: string | null
          created_at?: string
          dispatch_id?: string | null
          estado?: string
          hora_carga: string
          hora_fin_descarga: string
          hora_llegada: string
          hora_salida: string
          hora_vuelta: string
          id?: string
          m3: number
          m3_planificado?: number | null
          mixer_id?: string | null
          n: number
          origen?: string
          pedido_id: string
          plant_id?: string | null
          updated_at?: string
        }
        Update: {
          actualizado_por?: string | null
          created_at?: string
          dispatch_id?: string | null
          estado?: string
          hora_carga?: string
          hora_fin_descarga?: string
          hora_llegada?: string
          hora_salida?: string
          hora_vuelta?: string
          id?: string
          m3?: number
          m3_planificado?: number | null
          mixer_id?: string | null
          n?: number
          origen?: string
          pedido_id?: string
          plant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "viajes_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viajes_mixer_id_fkey"
            columns: ["mixer_id"]
            isOneToOne: false
            referencedRelation: "mixers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viajes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "scheduled_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viajes_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _ajustar_pedido: { Args: { p_pedido_id: string; p_delta_m3: number; p_usuario: string; p_nota: string }; Returns: undefined }
      _ancla_stock: { Args: { p_material_id: string; p_desde: string }; Returns: string }
      _aplicar_neto: { Args: { p_dispatch_id: string; p_desde: string; p_neto: Json; p_nota: string }; Returns: Json }
      _consumo_formula: { Args: { p_formula_id: string; p_plant_id: string; p_m3: number }; Returns: ({ mat_id: string; mat_nombre: string; mat_tipo: string; descuenta: boolean; kg_m3: number; kg_seco: number; humedad_pct: number; kg_humedo: number })[] }
      _material_en_planta: { Args: { p_material_id: string; p_plant_id: string; p_contexto?: string }; Returns: Database["public"]["Tables"]["materials"]["Row"] }
      _mover_stock: { Args: { p_mapa: Json }; Returns: undefined }
      _sumar_kg: { Args: { p_mapa: Json; p_material_id: string; p_kg: number }; Returns: Json }
      ajustar_material_despacho: { Args: { p_dispatch_id: string; p_material: string; p_cantidad: number; p_usuario?: string; p_nota?: string }; Returns: Json }
      anular_despacho: { Args: { p_id: string; p_usuario?: string; p_motivo?: string }; Returns: Json }
      clasificar_material: { Args: { p_nombre: string }; Returns: ({ tipo: string; descuenta_stock: boolean; corrige_humedad: boolean })[] }
      editar_despacho: { Args: { p_id: string; p: Json }; Returns: Json }
      guardar_viajes_pedido: { Args: { p_pedido_id: string; p_viajes: Json; p_usuario?: string; p_origen?: string }; Returns: Json }
      registrar_despacho: { Args: { p: Json }; Returns: Json }
      update_material_stock: { Args: { p_material_id: string; p_quantity_change: number }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type Esquema = Database["public"]

/** Fila de una tabla, p. ej. `Tables<"materials">`. */
export type Tables<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Row"]
/** Objeto para insertar en una tabla (las columnas con default son opcionales). */
export type TablesInsert<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Insert"]
/** Objeto para actualizar una tabla (todo opcional). */
export type TablesUpdate<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Update"]
/** Argumentos y resultado de una función de la base llamada con supabase.rpc(). */
export type FunctionArgs<F extends keyof Esquema["Functions"]> = Esquema["Functions"][F]["Args"]
export type FunctionReturns<F extends keyof Esquema["Functions"]> = Esquema["Functions"][F]["Returns"]
