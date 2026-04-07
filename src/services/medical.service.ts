import { db } from '../db/connection.js';
import { getProfile } from './health-profile.service.js';
import { generateMedicalResponse } from './ai.service.js';
import type { MedicalQueryWithResponse } from '../models/medical-query.js';

export async function submitQuery(
  userId: string,
  queryText: string,
): Promise<MedicalQueryWithResponse> {
  // Fetch health profile — throws 404 if missing (mapped to 422 by route)
  const profile = await getProfile(userId);

  const healthContext = {
    age_years: profile.age_years,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    bmi: profile.bmi,
  };

  // Store the query with a snapshot of the health profile at query time
  const [query] = await db('medical_queries')
    .insert({
      user_id: userId,
      query_text: queryText,
      health_profile_snapshot: JSON.stringify(healthContext),
    })
    .returning(['id', 'created_at']);

  // Generate AI response
  const { responseText, disclaimerText } = await generateMedicalResponse(queryText, healthContext);

  // Persist the response
  await db('ai_medical_responses').insert({
    query_id: query.id,
    response_text: responseText,
    disclaimer_text: disclaimerText,
  });

  return {
    query_id: query.id,
    response_text: responseText,
    disclaimer_text: disclaimerText,
    created_at: query.created_at,
    health_context: healthContext,
  };
}
