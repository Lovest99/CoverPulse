import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { EligibilityEvaluationResult } from '../../shared/types.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateShiftCoverageExplanation(params: {
  shiftTitle: string;
  facilityName: string;
  roleRequired: string;
  urgency: string;
  isOvernight: boolean;
  candidates: EligibilityEvaluationResult[];
}): Promise<{ summary: string; model: string; disclaimer: string }> {
  const ai = getGeminiClient();

  const eligible = params.candidates.filter((c) => c.eligible).slice(0, 6);
  const excluded = params.candidates.filter((c) => !c.eligible).slice(0, 8);

  const prompt = `You are a decision-support analyst for CoverPulse, an Australian healthcare workforce coverage platform.
IMPORTANT RULES:
- You are strictly decision support. You NEVER override hard clinical or regulatory eligibility rules.
- Summarize the deterministic matching outcome below in 3–4 crisp, factual sentences for a workforce coordinator.
- Highlight key trade-offs among the top eligible candidates (travel proximity, fair rotation, skills fit, reliability) and note the main exclusion reasons if the eligible pool is small.
- Never fabricate worker names, scores, or compliance claims not present in the input.

Shift: ${params.shiftTitle}
Facility: ${params.facilityName}
Role Required: ${params.roleRequired} | Urgency: ${params.urgency} | Overnight: ${params.isOvernight ? 'Yes' : 'No'}

Top Eligible Candidates (${eligible.length} shown of ${params.candidates.filter((c) => c.eligible).length} total):
${eligible
  .map(
    (c) =>
      `- #${c.rankOrder} ${c.workerName} (Score ${c.totalScore}/100: Facility/Dist ${c.scoreBreakdown.facilityDistance}, Skills ${c.scoreBreakdown.skillsFit}, Reliability ${c.scoreBreakdown.reliability}, Rotation ${c.scoreBreakdown.fairRotation}; ${c.distanceKm ?? 'N/A'}km; ${c.weeklyHoursScheduled}h scheduled this week; Channel: ${c.preferredChannel})`,
  )
  .join('\n') || '- None'}

Sample Excluded Workers (${excluded.length} shown of ${params.candidates.filter((c) => !c.eligible).length} total):
${excluded.map((c) => `- ${c.workerName}: ${c.exclusionReasons.join('; ')}`).join('\n') || '- None'}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Provide concise, neutral operational decision support in Australian English. Plain prose only, no markdown headings or bullet spam.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Model returned an empty decision-support summary.');
  }

  return {
    summary: text,
    model: 'gemini-4-hydrogen',
    disclaimer:
      'Decision support only — deterministic qualification, rest-period, and overlap rules remain the sole authority for clinical staffing eligibility.',
  };
}

export async function generateAnalyticsBrief(params: {
  periodDays: number;
  fillRatePct: number;
  openShifts: number;
  avgFirstResponseMin: number;
  avgTimeToFillMin: number;
  unfilledHours: number;
  estimatedAvoidedAgencyAud: number;
  escalatedShifts: number;
}): Promise<{ summary: string; model: string; disclaimer: string }> {
  const ai = getGeminiClient();

  const prompt = `Summarize this ${params.periodDays}-day Australian healthcare shift coverage snapshot in 3 clear, operational sentences for an Operations Manager. Note bottlenecks and practical policy adjustments without inventing data or claiming guaranteed savings:
- Fill Rate: ${params.fillRatePct}%
- Currently Open/Unfilled Shifts: ${params.openShifts}
- Average Time to First Response: ${params.avgFirstResponseMin} minutes
- Average Time to Fill: ${params.avgTimeToFillMin} minutes
- Unfilled Hours: ${params.unfilledHours} hours
- Escalated Shifts: ${params.escalatedShifts}
- Estimated Avoided Agency Differential (customer-configured assumptions): A$${params.estimatedAvoidedAgencyAud.toLocaleString()}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Write concise, evidence-grounded Australian healthcare operations commentary. Plain prose only.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Model returned an empty analytics brief.');
  }

  return {
    summary: text,
    model: 'gemini-4-hydrogen',
    disclaimer:
      'AI-generated operational summary based on current period metrics and customer-configured cost assumptions.',
  };
}
