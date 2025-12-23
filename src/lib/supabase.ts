import { createClient, SupabaseClient, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// Environment variables for Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

// Validate required environment variables
const validateSupabaseConfig = () => {
    if (!supabaseUrl) {
        console.warn('⚠️  SUPABASE_URL is not set. Supabase features will be disabled.');
        return false;
    }
    if (!supabaseAnonKey && !supabaseServiceKey) {
        console.warn('⚠️  Neither SUPABASE_ANON_KEY nor SUPABASE_SERVICE_KEY is set.');
        return false;
    }
    return true;
};

// Public client (respects RLS policies)
// Use this for user-context operations where you want Row Level Security
let supabase: SupabaseClient | null = null;

// Admin client (bypasses RLS)
// Use this for server-side operations that need full access
let supabaseAdmin: SupabaseClient | null = null;

/**
 * Get the public Supabase client (respects RLS)
 * Best for: User-authenticated operations where you want row-level security
 */
export const getSupabase = (): SupabaseClient | null => {
    if (!supabase && validateSupabaseConfig() && supabaseAnonKey) {
        supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        console.log('✅ Supabase client initialized');
    }
    return supabase;
};

/**
 * Get the admin Supabase client (bypasses RLS)
 * Best for: Server-side operations, background jobs, admin tasks
 */
export const getSupabaseAdmin = (): SupabaseClient | null => {
    if (!supabaseAdmin && validateSupabaseConfig() && supabaseServiceKey) {
        supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        console.log('✅ Supabase Admin client initialized');
    }
    return supabaseAdmin;
};

/**
 * Create a Supabase client with a user's JWT token
 * This allows operations to be performed on behalf of a specific user
 */
export const getSupabaseWithToken = (accessToken: string): SupabaseClient | null => {
    if (!validateSupabaseConfig() || !supabaseAnonKey) return null;

    return createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
};

// ==========================================
// Supabase Storage Helpers
// ==========================================

export interface UploadOptions {
    bucket: string;
    path: string;
    file: Buffer | Blob | File;
    contentType?: string;
    upsert?: boolean;
}

export interface DownloadOptions {
    bucket: string;
    path: string;
}

/**
 * Upload a file to Supabase Storage
 */
export const uploadFile = async (options: UploadOptions) => {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error('Supabase Admin client not initialized');

    const { bucket, path, file, contentType, upsert = false } = options;

    const { data, error } = await admin.storage
        .from(bucket)
        .upload(path, file, {
            contentType,
            upsert,
        });

    if (error) throw error;
    return data;
};

/**
 * Get a signed URL for private file access
 */
export const getSignedUrl = async (
    bucket: string,
    path: string,
    expiresIn: number = 3600 // 1 hour default
) => {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error('Supabase Admin client not initialized');

    const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

    if (error) throw error;
    return data.signedUrl;
};

/**
 * Get public URL for a file (if bucket is public)
 */
export const getPublicUrl = (bucket: string, path: string) => {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client not initialized');

    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
};

/**
 * Delete a file from Supabase Storage
 */
export const deleteFile = async (bucket: string, paths: string[]) => {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error('Supabase Admin client not initialized');

    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
};

// ==========================================
// Supabase Realtime Helpers
// ==========================================

/**
 * Subscribe to realtime changes on a table
 * Returns an unsubscribe function
 */
export const subscribeToTable = (
    table: string,
    callback: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*' = '*'
) => {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client not initialized');

    const channel = client
        .channel(`table-changes-${table}`)
        .on<Record<string, unknown>>(
            'postgres_changes' as any,
            { event, schema: 'public', table },
            callback
        )
        .subscribe();

    return () => {
        client.removeChannel(channel);
    };
};

// ==========================================
// Supabase Database Helpers
// ==========================================

/**
 * Execute a query on a Supabase table
 * Note: For complex queries, use Prisma instead
 */
export const queryTable = async <T = any>(
    table: string,
    options?: {
        select?: string;
        filter?: Record<string, any>;
        limit?: number;
        order?: { column: string; ascending?: boolean };
    }
): Promise<T[]> => {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client not initialized');

    let query = client.from(table).select(options?.select || '*');

    if (options?.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
            query = query.eq(key, value);
        });
    }

    if (options?.order) {
        query = query.order(options.order.column, {
            ascending: options.order.ascending ?? true,
        });
    }

    if (options?.limit) {
        query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as T[];
};

// ==========================================
// Supabase Edge Functions Helper
// ==========================================

/**
 * Invoke a Supabase Edge Function
 */
export const invokeFunction = async <T = any>(
    functionName: string,
    payload?: any,
    options?: { headers?: Record<string, string> }
): Promise<T> => {
    const client = getSupabase();
    if (!client) throw new Error('Supabase client not initialized');

    const { data, error } = await client.functions.invoke(functionName, {
        body: payload,
        headers: options?.headers,
    });

    if (error) throw error;
    return data as T;
};

// Export types
export type { SupabaseClient };
