export function EmergencyHelpline() {
  return (
    <section className="bg-[var(--color-primary-light)]/40 border border-[var(--color-primary)]/20 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4" style={{ padding: '10px', margin: '20px 0' }}>
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">📞</span>
        <div>
          <strong className="block text-[var(--color-text)]">স্বাস্থ্য বাতায়ন: ১৬২৬৩ (টোল-ফ্রি ২৪/৭)</strong>
          <small className="text-[var(--color-text-muted)]">যেকোনো স্বাস্থ্যগত জরুরি প্রয়োজনে সরকারি স্বাস্থ্যসেবা হটলাইনে সরাসরি যোগাযোগ করুন।</small>
        </div>
      </div>
      <a
        href="tel:16263"
        className="button button--primary text-sm min-h-[48px] px-5 py-2.5 flex items-center justify-center shrink-0"
      >
        সরাসরি কল করুন (১৬২৬৩)
      </a>
    </section>
  );
}
