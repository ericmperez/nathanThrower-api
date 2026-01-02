import { CoachingReport, AnalysisMetrics, PitchType, Handedness, Goal } from '../lib/shared';
import { aiService } from './aiService';

/**
 * Analysis Provider Interface
 * Allows swapping between mock, MediaPipe, or other pose estimation providers
 */
export interface IAnalysisProvider {
  analyzeVideo(videoPath: string, metadata: AnalysisMetadata): Promise<AnalysisResult>;
}

export interface AnalysisMetadata {
  pitchType: PitchType;
  handedness: Handedness;
  goal: Goal;
}

export interface AnalysisResult {
  metrics: AnalysisMetrics;
  report: CoachingReport;
}

/**
 * Mock Analysis Provider
 * Returns realistic sample data for development
 */
export class MockAnalysisProvider implements IAnalysisProvider {
  async analyzeVideo(videoPath: string, metadata: AnalysisMetadata): Promise<AnalysisResult> {
    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const metrics = this.generateMockMetrics(metadata);
    const report = await this.generateMockReport(metrics, metadata);

    return { metrics, report };
  }

  private generateMockMetrics(metadata: AnalysisMetadata): AnalysisMetrics {
    // Generate realistic metrics with some variation
    const base = {
      stride_length_pct: 85 + Math.random() * 15,
      trunk_tilt_deg: 30 + Math.random() * 10,
      shoulder_hip_separation_deg: 35 + Math.random() * 20,
      arm_slot_deg: metadata.handedness === 'R' ? 50 + Math.random() * 15 : -(50 + Math.random() * 15),
      release_point_consistency: 70 + Math.random() * 25,
      lead_leg_block_timing: 80 + Math.random() * 15,
      head_stability: 75 + Math.random() * 20,
    };

    // Adjust based on pitch type
    if (metadata.pitchType === 'FB') {
      base.stride_length_pct += 5;
    } else if (metadata.pitchType === 'CB') {
      base.trunk_tilt_deg -= 5;
    }

    return base;
  }

  private async generateMockReport(metrics: AnalysisMetrics, metadata: AnalysisMetadata): Promise<CoachingReport> {
    // Attempt to get AI-generated content first
    const aiData = await aiService.generateCoachingReport(metrics, {
      pitchType: metadata.pitchType,
      handedness: metadata.handedness,
      goal: metadata.goal,
    });

    if (aiData) {
      const routine = this.generateRoutine(aiData.top_cues, metadata);
      return {
        summary: aiData.summary,
        top_cues: aiData.top_cues,
        metrics,
        routine,
        risk_flags: aiData.risk_flags,
      };
    }

    // Fallback to static mock logic if AI is unavailable
    const cues: any[] = [];
    const riskFlags: any[] = [];

    // Generate cues based on metrics
    if (metrics.stride_length_pct < 90) {
      cues.push({
        title: 'Extend Your Stride',
        why: `Your stride length is at ${metrics.stride_length_pct.toFixed(1)}%, which limits power transfer. Elite pitchers typically achieve 95%+ of their height in stride length.`,
        how: 'Focus on driving powerfully off the rubber with your back leg. Practice long-toss and crow hops to build the feeling of explosive extension.',
        drill_ids: ['stride-extension-drill', 'long-toss'],
      });
    }

    if (metrics.shoulder_hip_separation_deg < 40) {
      cues.push({
        title: 'Improve Hip-Shoulder Separation',
        why: `Your separation angle of ${metrics.shoulder_hip_separation_deg.toFixed(1)}° is below optimal. Greater separation (45-55°) creates more elastic energy and velocity.`,
        how: 'Focus on rotating your hips early while keeping your shoulders closed longer. Use medicine ball throws and rocker drills to feel this separation.',
        drill_ids: ['rocker-drill', 'med-ball-scoop'],
      });

      if (metadata.goal === 'velo') {
        riskFlags.push({
          name: 'Limited Separation Pattern',
          confidence: 'med',
          note: 'Limited hip-shoulder separation may reduce velocity potential. Work with a qualified coach to improve sequencing safely.',
        });
      }
    }

    if (metrics.lead_leg_block_timing < 85) {
      cues.push({
        title: 'Strengthen Lead Leg Block',
        why: `Your lead leg bracing scores ${metrics.lead_leg_block_timing.toFixed(1)}%. A firm block redirects momentum upward and forward, increasing velocity and command.`,
        how: 'Practice landing with a slightly flexed but firm front leg. Focus on absorbing force without collapsing. Single-leg strengthening exercises help.',
        drill_ids: ['lead-leg-stabilization', 'single-leg-squat'],
      });
    }

    if (metrics.release_point_consistency < 80) {
      cues.push({
        title: 'Improve Release Point Consistency',
        why: `Your release point consistency is ${metrics.release_point_consistency.toFixed(1)}%. Greater consistency leads to better command and deception.`,
        how: 'Focus on repeating your arm path and finish. Use flat-ground work and targets to groove a consistent release. Video review helps.',
        drill_ids: ['flat-ground-work', 'towel-drill'],
      });
    }

    if (metrics.head_stability < 80) {
      cues.push({
        title: 'Stabilize Your Head Position',
        why: `Head stability scores ${metrics.head_stability.toFixed(1)}%. Excessive head movement can disrupt timing and reduce command.`,
        how: 'Keep your eyes level and minimize up/down movement. Think about "staying tall" through release. Balance drills help.',
        drill_ids: ['balance-drill', 'one-leg-catch'],
      });
    }

    // Ensure we have at least 3 cues
    if (cues.length < 3) {
      cues.push({
        title: 'Maintain Current Mechanics',
        why: 'Your overall mechanics show good fundamentals. Continue reinforcing these patterns.',
        how: 'Stay consistent with your current routine. Focus on recovery and maintaining strength/mobility.',
        drill_ids: ['recovery-routine'],
      });
    }

    // Limit to top 5 cues
    const topCues = cues.slice(0, 5);

    // Generate routine
    const routine = this.generateRoutine(topCues, metadata);

    const summary = this.generateSummary(metrics, metadata);

    return {
      summary,
      top_cues: topCues,
      metrics,
      routine,
      risk_flags: riskFlags,
    };
  }

  private generateRoutine(cues: any[], metadata: AnalysisMetadata): any {
    const drillSteps = cues.flatMap((cue) =>
      cue.drill_ids.slice(0, 1).map((id: string) => ({
        name: this.getDrillName(id),
        sets: '3x10',
        notes: 'Focus on quality over quantity',
        video_url: `https://example.com/drills/${id}`,
      }))
    );

    return {
      title: `Personalized ${metadata.pitchType} ${metadata.goal === 'velo' ? 'Velocity' : metadata.goal === 'command' ? 'Command' : 'Injury Prevention'} Routine`,
      duration_min: 45,
      steps: [
        {
          name: 'Dynamic Warmup',
          sets: '1x',
          notes: 'Arm circles, leg swings, band work (10 min)',
        },
        ...drillSteps,
        {
          name: 'Throwing Program',
          sets: '30-40 throws',
          notes: 'Progress from 60ft to full distance, focus on feel',
        },
        {
          name: 'Cool Down',
          sets: '1x',
          notes: 'Static stretching, arm care routine (10 min)',
        },
      ],
    };
  }

  private getDrillName(id: string): string {
    const drillNames: Record<string, string> = {
      'stride-extension-drill': 'Stride Extension Drill',
      'long-toss': 'Long Toss',
      'rocker-drill': 'Rocker Drill',
      'med-ball-scoop': 'Med Ball Scoop Throw',
      'lead-leg-stabilization': 'Lead Leg Stabilization',
      'single-leg-squat': 'Single Leg Squat',
      'flat-ground-work': 'Flat Ground Work',
      'towel-drill': 'Towel Drill',
      'balance-drill': 'Balance Drill',
      'one-leg-catch': 'One Leg Catch Play',
      'recovery-routine': 'Recovery Routine',
    };
    return drillNames[id] || id;
  }

  private generateSummary(metrics: AnalysisMetrics, metadata: AnalysisMetadata): string {
    const issues: string[] = [];

    if (metrics.stride_length_pct < 90) issues.push('stride length');
    if (metrics.shoulder_hip_separation_deg < 40) issues.push('hip-shoulder separation');
    if (metrics.lead_leg_block_timing < 85) issues.push('lead leg block');
    if (metrics.release_point_consistency < 80) issues.push('release consistency');

    if (issues.length === 0) {
      return `Your ${metadata.pitchType} delivery shows solid fundamentals with good overall sequencing. Continue reinforcing these patterns with consistent practice.`;
    }

    const issueText = issues.length === 1
      ? issues[0]
      : issues.slice(0, -1).join(', ') + ' and ' + issues[issues.length - 1];

    return `Your ${metadata.pitchType} delivery has strong foundations. Primary focus areas: ${issueText}. The recommended routine addresses these specific areas to help you ${metadata.goal === 'velo' ? 'increase velocity' : metadata.goal === 'command' ? 'improve command' : 'reduce injury risk'}.`;
  }
}

// Export singleton instance
export const analysisProvider: IAnalysisProvider = new MockAnalysisProvider();
