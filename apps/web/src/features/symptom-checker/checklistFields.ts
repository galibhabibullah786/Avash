import type { SymptomChecklist } from '@avash/types';

export interface ChecklistFieldDef {
  key: keyof SymptomChecklist;
  label: string;
  /** WHO warning signs that alone drive the deterministic engine straight to "emergency" (ADR-004). */
  severe: boolean;
}

/**
 * Human-readable labels for the 12 frozen checklist fields
 * (`packages/types/api.ts` `symptomChecklistSchema`). Grouped by the same
 * severe-sign / consult-criteria split the rule engine uses
 * (`packages/security/triage.ts`) so the form visually explains why an
 * answer matters, without the UI itself making any triage decision.
 */
export const SEVERE_SIGN_FIELDS: ChecklistFieldDef[] = [
  { key: 'severeAbdominalPain', label: 'তীব্র বা স্থায়ী পেটে ব্যথা (Severe or persistent abdominal pain)', severe: true },
  { key: 'persistentVomiting', label: 'ক্রমাগত বমি হওয়া (Persistent vomiting)', severe: true },
  { key: 'mucosalBleeding', label: 'মাড়ি, নাক বা অন্য স্থান থেকে রক্তপাত (Mucosal bleeding)', severe: true },
  { key: 'lethargyOrRestlessness', label: 'অস্বাভাবিক ক্লান্তি, দুর্বলতা বা অস্থিরতা (Lethargy or restlessness)', severe: true },
  { key: 'liverEnlargement', label: 'যকৃৎ বৃদ্ধি পাওয়া (Liver enlargement - চিকিৎসকের মতে)', severe: true },
  { key: 'fluidAccumulation', label: 'শরীরে পানি জমার লক্ষণ (Clinical fluid accumulation - চিকিৎসকের মতে)', severe: true },
];

export const OTHER_SYMPTOM_FIELDS: ChecklistFieldDef[] = [
  { key: 'fever', label: 'জ্বর (Fever)', severe: false },
  { key: 'nauseaOrVomiting', label: 'বমি বমি ভাব বা বমি (Nausea or vomiting)', severe: false },
  { key: 'rash', label: 'ত্বকে লালচে দানা বা র‍্যাশ (Skin rash)', severe: false },
  { key: 'achesAndPains', label: 'চোখের পেছনে, পেশিতে বা গাঁটে তীব্র ব্যথা (Muscle, joint, or eye pain)', severe: false },
  { key: 'positiveTourniquetTest', label: 'পজিটিভ টুরনিকেট টেস্ট (Positive tourniquet test - চিকিৎসকের মতে)', severe: false },
  { key: 'leukopenia', label: 'রক্তে শ্বেতকণিকার স্বল্পতা (Leukopenia - সাম্প্রতিক রক্ত পরীক্ষার রিপোর্ট)', severe: false },
];

export const ALL_CHECKLIST_FIELDS: ChecklistFieldDef[] = [...SEVERE_SIGN_FIELDS, ...OTHER_SYMPTOM_FIELDS];
