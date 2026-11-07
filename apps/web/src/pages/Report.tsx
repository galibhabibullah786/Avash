import { BreedingReportForm, ReportSubmissionList } from "../features/reports";

export default function Report() {
  return (
    <main className="inner-page report-page">
      <div className="inner-page__intro">
        <div>
          <p className="eyebrow">নাগরিক সহযোগিতা</p>
          <h1>মশার প্রজনন ক্ষেত্র রিপোর্ট করুন</h1>
          <p className="inner-lede">
            জমে থাকা পানি বা বদ্ধ ড্রেন দেখছেন? আপনার একটি রিপোর্ট এলাকাকে নিরাপদ রাখতে সাহায্য করতে পারে।
          </p>
        </div>
      </div>
      <BreedingReportForm />
      <ReportSubmissionList />
    </main>
  );
}
