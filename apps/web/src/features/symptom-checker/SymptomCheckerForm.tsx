import { useState, type FormEvent } from 'react';
import { SYMPTOM_TEXT_MAX_CHARS, type SymptomChecklist } from '@avash/types';
import { useSymptomCheck } from './useSymptomCheck';
import { SEVERE_SIGN_FIELDS, OTHER_SYMPTOM_FIELDS } from './checklistFields';
import { SubmitButton } from '../../components/SubmitButton';
import './symptom-checker.css';

const EMPTY_CHECKLIST: Partial<SymptomChecklist> = {};

const OUTCOME_LABEL: Record<string, string> = {
  emergency: 'Emergency — seek care now',
  'consult-24h': 'See a doctor within 24 hours',
  monitor: 'Monitor at home',
};

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  emergency: 'badge--severe',
  'consult-24h': 'badge--high',
  monitor: 'badge--low',
};

/**
 * Free-text symptom description plus the WHO warning-sign checklist. The
 * outcome shown is always whatever `POST /api/symptom-check` returns — the
 * deterministic rule engine's decision (ADR-004), never anything computed
 * client-side. Gemini only helps pre-fill the checklist from the free
 * text; the triage result never depends on it, so the result panel renders
 * unconditionally once a response comes back, whether or not AI assist
 * was available.
 */
export function SymptomCheckerForm() {
  const [symptomText, setSymptomText] = useState('');
  const [checklist, setChecklist] = useState<Partial<SymptomChecklist>>(EMPTY_CHECKLIST);
  const mutation = useSymptomCheck();

  const remainingChars = SYMPTOM_TEXT_MAX_CHARS - symptomText.length;
  const overLimit = remainingChars < 0;

  function toggleField(key: keyof SymptomChecklist) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (overLimit) {
      return;
    }
    mutation.mutate({
      symptomText: symptomText.trim().length > 0 ? symptomText : undefined,
      checklist,
    });
  }

  const result = mutation.data;

  return (
    <div className="symptom-checker">
      <form className="form" onSubmit={handleSubmit} aria-label="Symptom checker">
        <fieldset className="symptom-checker__form-fieldset" disabled={mutation.isPending}>
          <div className="field">
            <label className="field__label" htmlFor="symptom-text">
              Describe how you feel (optional)
            </label>
            <textarea
              id="symptom-text"
              data-testid="symptom-text-input"
              rows={4}
              maxLength={SYMPTOM_TEXT_MAX_CHARS}
              value={symptomText}
              onChange={(event) => setSymptomText(event.target.value)}
              aria-describedby="symptom-text-counter"
            />
            <span
              id="symptom-text-counter"
              className="field__label"
              data-testid="symptom-text-counter"
            >
              {Math.max(remainingChars, 0)} characters remaining
            </span>
          </div>

          <fieldset className="symptom-checker__fieldset">
            <legend>Warning signs</legend>
            <p className="field__label">
              These signs can indicate severe dengue and need urgent attention.
            </p>
            {SEVERE_SIGN_FIELDS.map((field) => (
              <label key={field.key} className="symptom-checker__checkbox">
                <input
                  type="checkbox"
                  data-testid={`checklist-${field.key}`}
                  checked={checklist[field.key] === true}
                  onChange={() => toggleField(field.key)}
                />
                {field.label}
              </label>
            ))}
          </fieldset>

          <fieldset className="symptom-checker__fieldset">
            <legend>Other symptoms</legend>
            {OTHER_SYMPTOM_FIELDS.map((field) => (
              <label key={field.key} className="symptom-checker__checkbox">
                <input
                  type="checkbox"
                  data-testid={`checklist-${field.key}`}
                  checked={checklist[field.key] === true}
                  onChange={() => toggleField(field.key)}
                />
                {field.label}
              </label>
            ))}
          </fieldset>

          {overLimit ? (
            <p className="field__error" data-testid="symptom-text-error">
              Please shorten your description to {SYMPTOM_TEXT_MAX_CHARS} characters or fewer.
            </p>
          ) : null}
        </fieldset>

        <SubmitButton pending={mutation.isPending} disabled={overLimit} pendingLabel="Checking…">
          Check my symptoms
        </SubmitButton>
      </form>

      {mutation.isError ? (
        <p className="alert alert--error" role="alert" data-testid="symptom-check-error">
          Unable to check symptoms right now. Please try again.
        </p>
      ) : null}

      {result ? (
        <section className="card symptom-checker__result" data-testid="symptom-check-result" aria-live="polite">
          <span className={`badge ${OUTCOME_BADGE_CLASS[result.outcome] ?? ''}`} data-testid="symptom-check-outcome">
            {OUTCOME_LABEL[result.outcome] ?? result.outcome}
          </span>
          <p data-testid="symptom-check-guidance">{result.guidance}</p>

          {!result.aiAssistAvailable ? (
            <p className="alert" data-testid="symptom-check-ai-unavailable">
              AI assist temporarily unavailable — this result was determined from the checklist
              you filled in above.
            </p>
          ) : null}

          <p className="symptom-checker__disclaimer" data-testid="symptom-check-disclaimer">
            This tool does not provide a medical diagnosis. If you are worried about your
            symptoms, contact a healthcare professional.
          </p>
        </section>
      ) : (
        <p className="symptom-checker__disclaimer" data-testid="symptom-check-disclaimer-idle">
          This tool does not provide a medical diagnosis. It is meant to help you decide how
          urgently to seek care.
        </p>
      )}
    </div>
  );
}
