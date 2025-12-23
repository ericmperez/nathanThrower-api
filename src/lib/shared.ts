import { z } from 'zod';

// ==================== Auth ====================
export const RegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
});

export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

// ==================== User ====================
export interface User {
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin' | 'nathan';
    createdAt: Date;
    updatedAt: Date;
}

export interface AuthResponse {
    user: User;
    token: string;
}

// ==================== Video & Analysis ====================
export const PitchType = z.enum(['FB', 'CB', 'CH', 'SL']);
export const Handedness = z.enum(['R', 'L']);
export const Goal = z.enum(['velo', 'command', 'injury_prevention']);
export const AnalysisStatus = z.enum(['queued', 'processing', 'completed', 'failed']);

export const PresignRequestSchema = z.object({
    filename: z.string(),
    contentType: z.string(),
});

export const CreateAnalysisSchema = z.object({
    videoKey: z.string(),
    pitchType: PitchType,
    handedness: Handedness,
    goal: Goal,
    videoUrl: z.string().optional(),
});

export type PitchType = z.infer<typeof PitchType>;
export type Handedness = z.infer<typeof Handedness>;
export type Goal = z.infer<typeof Goal>;
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
export type CreateAnalysisInput = z.infer<typeof CreateAnalysisSchema>;

// ==================== Analysis Results ====================
export interface AnalysisMetrics {
    stride_length_pct: number;
    trunk_tilt_deg: number;
    shoulder_hip_separation_deg: number;
    arm_slot_deg: number;
    release_point_consistency: number;
    lead_leg_block_timing: number;
    head_stability: number;
    [key: string]: number;
}

export interface CoachingCue {
    title: string;
    why: string;
    how: string;
    drill_ids: string[];
}

export interface RoutineStep {
    name: string;
    sets: string;
    notes: string;
    video_url?: string;
}

export interface Routine {
    title: string;
    duration_min: number;
    steps: RoutineStep[];
}

export interface RiskFlag {
    name: string;
    confidence: 'low' | 'med' | 'high';
    note: string;
}

export interface CoachingReport {
    summary: string;
    top_cues: CoachingCue[];
    metrics: AnalysisMetrics;
    routine: Routine;
    risk_flags: RiskFlag[];
}

export interface Analysis {
    id: string;
    userId: string;
    videoKey: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    pitchType: PitchType;
    handedness: Handedness;
    goal: Goal;
    status: AnalysisStatus;
    report?: CoachingReport;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

// ==================== Courses ====================
export interface Lesson {
    id: string;
    courseId: string;
    title: string;
    description: string;
    videoUrl?: string;
    duration: number; // seconds
    order: number;
    isFree: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface Course {
    id: string;
    title: string;
    description: string;
    thumbnailUrl?: string;
    price: number; // cents
    isPublished: boolean;
    createdAt: Date;
    updatedAt: Date;
    lessons?: Lesson[];
}

export const CreateCourseSchema = z.object({
    title: z.string().min(3),
    description: z.string(),
    thumbnailUrl: z.string().url().optional(),
    price: z.number().int().min(0),
    isPublished: z.boolean().default(false),
});

export const UpdateCourseSchema = CreateCourseSchema.partial();

export const CreateLessonSchema = z.object({
    courseId: z.string(),
    title: z.string().min(3),
    description: z.string(),
    videoUrl: z.string().url().optional(),
    duration: z.number().int().min(0),
    order: z.number().int().min(0),
    isFree: z.boolean().default(false),
});

export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>;
export type CreateLessonInput = z.infer<typeof CreateLessonSchema>;

// ==================== Purchase ====================
export interface Purchase {
    id: string;
    userId: string;
    courseId: string;
    status: 'pending' | 'completed' | 'refunded';
    provider: 'stripe' | 'apple' | 'google' | 'mock';
    receiptRef?: string;
    createdAt: Date;
    updatedAt: Date;
}

// ==================== API Responses ====================
export interface ApiError {
    error: string;
    message?: string;
}

export interface PresignResponse {
    uploadUrl: string;
    videoKey: string;
    publicUrl: string;
}

export interface ListResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}
