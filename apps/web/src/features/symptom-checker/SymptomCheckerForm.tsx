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

  const hasWarningSign = useMemo(() => {
    return schema.sections.some((sec) =>
      sec.questions.some((q) => {
        const selected = getSelectedValues(q, answers);
        return q.options.some((opt) => opt.warningSign && selected.includes(opt.value));
      })
    );
  }, [schema, answers]);

  const answeredCount = useMemo(() => {
    return schema.sections.reduce((count, sec) => {
      return count + sec.questions.filter((q) => getSelectedValues(q, answers).length > 0).length;
    }, 0);
  }, [schema, answers]);

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

      {hasWarningSign && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="symptom-warning-alert"
          className="p-4 rounded-lg bg-[var(--color-danger-light)] border-2 border-[var(--color-danger)] text-[var(--color-danger)] flex items-start gap-3 shadow-md"
        >
          <span className="text-2xl" aria-hidden="true">🚨</span>
          <div>
            <strong className="block text-base font-bold">জরুরি সতর্ক সংকেত চিহ্নিত হয়েছে!</strong>
            <p className="text-sm mt-1 text-[var(--color-text)]">
              আপনি এক বা একাধিক বিপজ্জনক সতর্ক লক্ষণ (যেমন অস্বাভাবিক রক্তপাত, প্রচণ্ড পেটব্যথা বা ক্রমাগত বমি) নির্বাচন করেছেন। বিলম্ব না করে অবিলম্বে নিকটস্থ হাসপাতালের জরুরি বিভাগে যান অথবা স্বাস্থ্য বাতায়নে (১৬২৬৩) যোগাযোগ করুন।
            </p>
          </div>
        </div>
      )}

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
                        className={`symptom-checker__option ${isChecked ? 'symptom-checker__option--selected' : ''}`}
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

        <div className="sticky bottom-4 z-20 p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-[var(--color-text-muted)]">
            উত্তর দেওয়া হয়েছে: <strong className="text-[var(--color-primary)] font-bold">{answeredCount}</strong> / {schema.totalQuestions}টি প্রশ্ন
          </div>
          <button
            className="button flex items-center justify-center min-h-[48px] px-6 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg font-bold shadow-md transition-all active:scale-[0.98]"
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
        </div>
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
