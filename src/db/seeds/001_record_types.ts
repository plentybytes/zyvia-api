import type { Knex } from 'knex';

const DEFAULT_RECORD_TYPES = [
  { name: 'Lab Result', description: 'Laboratory test results and pathology reports' },
  { name: 'Prescription', description: 'Medication prescriptions and drug orders' },
  { name: 'Imaging / Radiology', description: 'X-ray, MRI, CT, ultrasound, and other imaging files' },
  { name: 'Clinical Note', description: 'Physician or nurse notes from consultations' },
  { name: 'Vaccination Record', description: 'Immunization history and vaccine certificates' },
  { name: 'Discharge Summary', description: 'Hospital discharge documentation' },
  { name: 'Referral Letter', description: 'Specialist or inter-facility referral documents' },
  { name: 'Insurance Document', description: 'Health insurance claims, authorizations, and EOBs' },
];

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex('record_types').count('* as count').first();
  if (existing && Number(existing.count) > 0) {
    return; // Already seeded — skip
  }

  await knex('record_types').insert(DEFAULT_RECORD_TYPES);
}
