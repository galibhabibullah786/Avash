import { SymptomCheckerForm } from "../features/symptom-checker/SymptomCheckerForm";

export default function SymptomChecker() {
  return (
    <main className="inner-page checker-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">প্রাথমিক মূল্যায়ন</p>
          <h1>ডেঙ্গুর লক্ষণ পরীক্ষা (Dengue Symptom Checker)</h1>
          <p className="inner-lede">
            ডেঙ্গু সম্পর্কিত লক্ষণ ও সতর্ক সংকেত মূল্যায়নের জন্য একটি প্রাথমিক যাচাইকরণ টুল। এই টুল কোনো সরাসরি ডাক্তারি রোগ নির্ণয় বা নিশ্চিতকরণ নয়।
          </p>
        </div>
        <span className="checker-time">যাচাইকরণ · গোপনীয়</span>
      </div>

      <SymptomCheckerForm />
    </main>
  );
}
