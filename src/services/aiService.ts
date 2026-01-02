import OpenAI from 'openai';
import { AnalysisMetrics, CoachingReport, Goal, PitchType, CoachingCue, RiskFlag } from '../lib/shared';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

export interface GeneratedCoachingData {
    summary: string;
    top_cues: CoachingCue[];
    risk_flags: RiskFlag[];
}

export const aiService = {
    /**
     * Generates a professional coaching report using OpenAI based on biomechanical metrics
     */
    generateCoachingReport: async (
        metrics: AnalysisMetrics,
        metadata: { pitchType: PitchType; handedness: string; goal: Goal }
    ): Promise<GeneratedCoachingData | null> => {
        if (!openai) {
            return null;
        }

        try {
            const prompt = `
        As an elite pitching coach (like Nathan Thrower), analyze the following biomechanical metrics for a ${metadata.handedness}-handed ${metadata.pitchType} pitch.
        The pitcher's primary training goal is: ${metadata.goal}.

        Metrics:
        - Stride Length: ${metrics.stride_length_pct.toFixed(1)}% of height (Optimal: 95-105%)
        - Trunk Tilt: ${metrics.trunk_tilt_deg.toFixed(1)}° (Optimal: 25-45°)
        - Hip-Shoulder Separation: ${metrics.shoulder_hip_separation_deg.toFixed(1)}° (Optimal: 45-60°)
        - Arm Slot: ${metrics.arm_slot_deg.toFixed(1)}°
        - Lead Leg Block Timing: ${metrics.lead_leg_block_timing.toFixed(1)}/100 (Optimal: 85+)
        - Release Point Consistency: ${metrics.release_point_consistency.toFixed(1)}/100 (Optimal: 90+)
        - Head Stability: ${metrics.head_stability.toFixed(1)}/100 (Optimal: 90+)

        Based on these, generate a professional analysis in JSON format:
        {
          "summary": "A 2-3 sentence overview of the pitching delivery and its primary strengths/weaknesses.",
          "top_cues": [
            {
              "title": "Short punchy title (e.g., 'Stack the Back Side')",
              "why": "Specific reason based on the metrics provided.",
              "how": "Practical instruction for the player.",
              "drill_ids": ["Pick 1-2 relevant IDs from: 'stride-extension-drill', 'long-toss', 'rocker-drill', 'med-ball-scoop', 'lead-leg-stabilization', 'single-leg-squat', 'flat-ground-work', 'towel-drill', 'balance-drill', 'one-leg-catch', 'recovery-routine'"]
            }
          ],
          "risk_flags": [
            {
              "name": "Brief name for the risk",
              "confidence": "low | med | high",
              "note": "Description of why this pattern is risky and how to address it safely."
            }
          ]
        }

        Requirements:
        - Provide 3-4 top_cues.
        - Only include risk_flags if metrics are significantly outside optimal ranges.
        - Output MUST be valid JSON.
      `;

            const response = await openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    { role: "system", content: "You are Nathan Thrower, an elite MLB-level pitching coach specializing in biomechanics and velocity development." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
            });

            const content = response.choices[0].message.content;
            if (!content) throw new Error("No content received from OpenAI");

            return JSON.parse(content) as GeneratedCoachingData;
        } catch (error) {
            console.error("OpenAI Analysis Error:", error);
            return null;
        }
    }
};
