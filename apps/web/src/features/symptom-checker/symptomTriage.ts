import symptomCheckerConfigData from "./symptom-checker-config.json";
import type { SymptomChecklist } from "@avash/types";

export type QuestionType = "single_choice" | "multi_choice";

export type QuestionOption = {
  id: string;
  label: string;
  value: string;
  warningSign?: boolean;
};

export type Question = {
  id: string;
  order: number;
  type: QuestionType;
  question: string;
  required: boolean;
  warningSignQuestion?: boolean;
  options: QuestionOption[];
  validation?: {
    exclusiveOptions?: string[];
  };
};

export type Section = {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
};

export type ResultCategory = {
  id: string;
  label: string;
  description: string;
  triggerType: string;
  clinicalThreshold: string;
  message: string;
};

export type SymptomConfig = {
  symptomChecker: {
    id: string;
    title: string;
    description: string;
    version: string;
    totalQuestions: number;
    disclaimer: string;
    sections: Section[];
    resultCategories: ResultCategory[];
    logic: {
      warningSignsOverrideSymptomScore: boolean;
      diagnosisEnabled: boolean;
      scoring: {
        enabled: boolean;
        note: string;
      };
    };
  };
};

export const SYMPTOM_CHECKER_CONFIG: SymptomConfig =
  symptomCheckerConfigData as SymptomConfig;

export const OUTCOME_BADGE_CLASS: Record<string, string> = {
  urgent: "badge--severe",
  dengue_suspected: "badge--high",
  dengue_possible: "badge--medium",
  dengue_less_likely: "badge--low",
};

export const allQuestions = SYMPTOM_CHECKER_CONFIG.symptomChecker.sections.flatMap(
  (section) => section.questions,
);

export const resultCategories = SYMPTOM_CHECKER_CONFIG.symptomChecker.resultCategories;

export function getSelectedValues(
  question: Question,
  answers: Record<string, string | string[] | undefined>,
): string[] {
  const value = answers[question.id];

  if (question.type === "multi_choice") {
    return Array.isArray(value) ? value : [];
  }

  return typeof value === "string" && value.length > 0 ? [value] : [];
}

export function determineOutcome(
  answers: Record<string, string | string[] | undefined>,
): ResultCategory {
  const warningSignFound = allQuestions.some((question) => {
    const selected = getSelectedValues(question, answers);
    return question.options.some(
      (option) =>
        selected.includes(option.value) && option.warningSign === true,
    );
  });

  if (warningSignFound) {
    return resultCategories[0]!;
  }

  const feverPresent = (() => {
    const selected = getSelectedValues(allQuestions[0]!, answers);
    return selected.some(
      (value) => value === "currently_fever" || value === "recently_gone",
    );
  })();

  const dengueCompatibleSymptoms = ["q4", "q5", "q6", "q7", "q8", "q9"].reduce(
    (count, questionId) => {
      const question = allQuestions.find((entry) => entry.id === questionId);
      if (!question) {
        return count;
      }

      const selected = getSelectedValues(question, answers);
      const hasCompatibleResponse = selected.some(
        (value) => !["no", "none", "not_sure"].includes(value),
      );
      return hasCompatibleResponse ? count + 1 : count;
    },
    0,
  );

  if (feverPresent && dengueCompatibleSymptoms >= 3) {
    return resultCategories[1]!;
  }

  if (feverPresent && dengueCompatibleSymptoms >= 1) {
    return resultCategories[2]!;
  }

  return resultCategories[3]!;
}

export function buildChecklist(
  answers: Record<string, string | string[] | undefined>,
): SymptomChecklist {
  const fever = ["currently_fever", "recently_gone"].includes(
    answers.q1 as string,
  );

  const achesAndPains =
    ["mild", "moderate", "severe"].includes(answers.q4 as string) ||
    ["mild", "moderate", "severe"].includes(answers.q5 as string) ||
    ["mild", "moderate", "severe"].includes(answers.q6 as string);

  const nauseaOrVomiting = [
    "nausea_only",
    "vomited_once_twice",
    "vomited_several_times",
    "persistent_vomiting",
  ].includes(answers.q7 as string);

  const rash = answers.q8 === "yes";

  const severeAbdominalPain = answers.q10 === "yes";
  const persistentVomiting =
    answers.q11 === "yes" || answers.q7 === "persistent_vomiting";

  const q12 = (answers.q12 || []) as string[];
  const mucosalBleeding = q12.some((v) =>
    [
      "nose",
      "gums",
      "blood_vomit",
      "blood_stool",
      "blood_urine",
      "heavy_menstrual",
      "other",
    ].includes(v),
  );

  const lethargyOrRestlessness = ["noticeable", "severe"].includes(
    answers.q14 as string,
  );

  return {
    fever,
    severeAbdominalPain,
    persistentVomiting,
    mucosalBleeding,
    lethargyOrRestlessness,
    liverEnlargement: false,
    fluidAccumulation: answers.q13 === "yes",
    nauseaOrVomiting,
    rash,
    achesAndPains,
    positiveTourniquetTest: false,
    leukopenia: false,
  };
}

export function backendOutcomeToResultCategory(
  outcome: "emergency" | "consult-24h" | "monitor",
  guidance: string,
): ResultCategory {
  if (outcome === "emergency") {
    return {
      id: "urgent",
      label: "জরুরি চিকিৎসা সেবা প্রয়োজন (Urgent Medical Attention)",
      message: guidance,
      description: "",
      triggerType: "",
      clinicalThreshold: "",
    };
  }
  if (outcome === "consult-24h") {
    return {
      id: "dengue_suspected",
      label: "দ্রুত চিকিৎসকের পরামর্শ নিন (Medical Consultation Recommended)",
      message: guidance,
      description: "",
      triggerType: "",
      clinicalThreshold: "",
    };
  }
  return {
    id: "dengue_possible",
    label: "লক্ষণ পর্যবেক্ষণ করুন (Monitor Symptoms)",
    message: guidance,
    description: "",
    triggerType: "",
    clinicalThreshold: "",
  };
}
