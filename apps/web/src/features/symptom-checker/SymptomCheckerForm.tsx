import { useMemo, useState, type FormEvent } from "react";
import "./symptom-checker.css";
import symptomCheckerConfigData from "./symptom-checker-config.json";

type QuestionType = "single_choice" | "multi_choice";

type QuestionOption = {
  id: string;
  label: string;
  value: string;
  warningSign?: boolean;
};

type Question = {
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

type Section = {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
};

type ResultCategory = {
  id: string;
  label: string;
  description: string;
  triggerType: string;
  clinicalThreshold: string;
  message: string;
};

type SymptomConfig = {
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

const SYMPTOM_CHECKER_CONFIG: SymptomConfig =
  symptomCheckerConfigData as SymptomConfig;

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  urgent: "badge--severe",
  dengue_suspected: "badge--high",
  dengue_possible: "badge--medium",
  dengue_less_likely: "badge--low",
};

const allQuestions = SYMPTOM_CHECKER_CONFIG.symptomChecker.sections.flatMap(
  (section) => section.questions,
);
const resultCategories = SYMPTOM_CHECKER_CONFIG.symptomChecker.resultCategories;

function getSelectedValues(
  question: Question,
  answers: Record<string, string | string[] | undefined>,
) {
  const value = answers[question.id];

  if (question.type === "multi_choice") {
    return Array.isArray(value) ? value : [];
  }

  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function determineOutcome(
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

export function SymptomCheckerForm() {
  const [answers, setAnswers] = useState<
    Record<string, string | string[] | undefined>
  >({});
  const [result, setResult] = useState<ResultCategory | null>(null);

  const schema = useMemo(() => SYMPTOM_CHECKER_CONFIG.symptomChecker, []);

  function handleSingleChoice(questionId: string, value: string) {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  }

  function handleMultiChoice(questionId: string, value: string) {
    setAnswers((previous) => {
      const current = Array.isArray(previous[questionId])
        ? previous[questionId]
        : [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];

      return {
        ...previous,
        [questionId]: next,
      };
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setResult(determineOutcome(answers));
  }

  return (
    <div className="symptom-checker">
      <p className="symptom-checker__summary">{schema.description}</p>

      <form
        className="symptom-checker__form"
        onSubmit={handleSubmit}
        aria-label="Dengue symptom checker"
      >
        {schema.sections.map((section) => (
          <section key={section.id} className="symptom-checker__section">
            <h2>{section.title}</h2>
            {section.description ? <p>{section.description}</p> : null}

            {section.questions.map((question) => {
              const selectedValues = getSelectedValues(question, answers);

              return (
                <fieldset
                  key={question.id}
                  className="symptom-checker__question"
                  data-testid={`symptom-question-${question.id}`}
                >
                  <legend>{question.question}</legend>

                  {question.options.map((option) => {
                    const sharedProps = {
                      id: `${question.id}-${option.value}`,
                      name: question.id,
                      checked:
                        question.type === "multi_choice"
                          ? selectedValues.includes(option.value)
                          : selectedValues.includes(option.value),
                      onChange: () => {
                        if (question.type === "multi_choice") {
                          handleMultiChoice(question.id, option.value);
                        } else {
                          handleSingleChoice(question.id, option.value);
                        }
                      },
                      "data-testid": `symptom-option-${question.id}-${option.value}`,
                    };

                    return (
                      <label
                        key={option.id}
                        className="symptom-checker__option"
                      >
                        <input
                          type={
                            question.type === "multi_choice"
                              ? "checkbox"
                              : "radio"
                          }
                          {...sharedProps}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
          </section>
        ))}

        <button className="button" type="submit">
          Check my symptoms
        </button>
      </form>

      {result ? (
        <section
          className="card symptom-checker__result"
          data-testid="symptom-check-result"
          aria-live="polite"
        >
          <span
            className={`badge ${OUTCOME_BADGE_CLASS[result.id] ?? ""}`}
            data-testid="symptom-check-outcome"
          >
            {result.label}
          </span>
          <p data-testid="symptom-check-guidance">{result.message}</p>
          <p
            className="symptom-checker__disclaimer"
            data-testid="symptom-check-disclaimer"
          >
            {schema.disclaimer}
          </p>
        </section>
      ) : (
        <p
          className="symptom-checker__disclaimer"
          data-testid="symptom-check-disclaimer-idle"
          style={{ color: '#c94a4a' }}
        >
          {schema.disclaimer}
        </p>
      )}
    </div>
  );
}
