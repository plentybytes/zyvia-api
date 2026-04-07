import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import type { HealthProfileSnapshot } from '../models/medical-query.js';

const DISCLAIMER =
  '⚠️ MEDICAL DISCLAIMER: This information is for educational purposes only and does not constitute medical advice. Always consult a qualified healthcare professional before making any health decisions.';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

export interface AiResponseResult {
  responseText: string;
  disclaimerText: string;
}

export async function generateMedicalResponse(
  queryText: string,
  healthContext: HealthProfileSnapshot,
): Promise<AiResponseResult> {
  const systemPrompt = `You are a medical information assistant providing general health and wellness advice, symptom information, and medication guidance.

The user's health profile:
- Age: ${healthContext.age_years} years
- Height: ${healthContext.height_cm} cm
- Weight: ${healthContext.weight_kg} kg
- BMI: ${healthContext.bmi}

Provide informative, evidence-based responses relevant to the user's profile. Consider their age, BMI, and physical characteristics when appropriate.

Always end every response with this exact disclaimer on a new line:
${DISCLAIMER}`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: queryText }],
    });

    const content = response.content[0];
    const responseText =
      content.type === 'text' ? content.text : 'Unable to generate a response at this time.';

    // Ensure disclaimer is present (model may omit it)
    const finalText = responseText.includes(DISCLAIMER)
      ? responseText
      : `${responseText}\n\n${DISCLAIMER}`;

    return { responseText: finalText, disclaimerText: DISCLAIMER };
  } catch {
    throw Object.assign(
      new Error('The medical AI service is temporarily unavailable. Please try again later.'),
      { statusCode: 503 },
    );
  }
}
