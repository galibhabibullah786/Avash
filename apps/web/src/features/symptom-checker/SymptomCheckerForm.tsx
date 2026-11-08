import { useMemo, useState, type FormEvent } from "react";
import "./symptom-checker.css";
import { Spinner } from "@avash/ui";
import { useSymptomCheck } from "./useSymptomCheck";
import type { SymptomCheckRequest } from "@avash/types";
import {
  SYMPTOM_CHECKER_CONFIG,
  OUTCOME_BADGE_CLASS,
  getSelectedValues,
  determineOutcome,
  buildChecklist,
  backendOutcomeToResultCategory,
  type ResultCategory,
} from "./symptomTriage";

export function SymptomCheckerForm() {
  const [answers, setAnswers] = useState<
    Record<string, string | string[] | undefined>
  >({});
  const [result, setResult] = useState<ResultCategory | null>(null);

  const mutation = useSymptomCheck();
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    try {
      const qaPairs = schema.sections.flatMap((section) =>
        section.questions
          .map((q) => {
            const selected = getSelectedValues(q, answers);
            const answerLabels = selected
              .map(
                (val) => q.options.find((opt) => opt.value === val)?.label,
              )
              .filter(Boolean);
            return {
              question: q.question,
              answer:
                answerLabels.length > 0
                  ? answerLabels.join(", ")
                  : "Not answered",
            };
          })
          .filter((qa) => qa.answer !== "Not answered"),
      );

      const payload: SymptomCheckRequest = {
        qaPairs,
        checklist: buildChecklist(answers),
      };
      const response = await mutation.mutateAsync(payload);
      setResult(
        backendOutcomeToResultCategory(response.outcome, response.guidance),
      );
    } catch (error) {
      console.warn("Backend symptom check failed, using local fallback", error);
      setResult(determineOutcome(answers));
    }
  }

  return (
    <div className="symptom-checker">
      <p className="symptom-checker__summary">{schema.description}</p>

      <form
        className="symptom-checker__form"
        onSubmit={handleSubmit}
        aria-label="ডেঙ্গুর লক্ষণ যাচাইকরণ"
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
                    const isChecked = selectedValues.includes(option.value);

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
                          id={`${question.id}-${option.value}`}
                          name={question.id}
                          checked={isChecked}
                          onChange={() => {
                            if (question.type === "multi_choice") {
                              handleMultiChoice(question.id, option.value);
                            } else {
                              handleSingleChoice(question.id, option.value);
                            }
                          }}
                          data-testid={`symptom-option-${question.id}-${option.value}`}
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

        <button
          className="button flex items-center justify-center"
          type="submit"
          disabled={mutation.isPending}
          data-testid="symptom-submit-button"
        >
          {mutation.isPending ? (
            <>
              <Spinner label="যাচাই করা হচ্ছে…" />
              <span style={{ marginLeft: "8px" }}>যাচাই করা হচ্ছে…</span>
            </>
          ) : (
            "লক্ষণ যাচাই করুন"
          )}
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
          style={{ color: "var(--color-critical, #ef4444)" }}
        >
          {schema.disclaimer}
        </p>
      )}
    </div>
  );
}
