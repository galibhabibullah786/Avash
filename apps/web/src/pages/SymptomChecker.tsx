import { SymptomCheckerForm } from "../features/symptom-checker/SymptomCheckerForm";

export default function SymptomChecker() {
  return (
    <main className="inner-page checker-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">Screening tool</p>
          <h1>Dengue Symptom Checker</h1>
          <p className="inner-lede">
            A screening questionnaire for dengue-related symptoms and warning
            signs. This tool does not diagnose dengue.
          </p>
        </div>
        <span className="checker-time">Screening · private</span>
      </div>

      <SymptomCheckerForm />
    </main>
  );
}
