import { Link } from 'react-router-dom';

export interface LifelineItem {
  icon: string;
  title: string;
  subtitle: string;
  desc: string;
  linkText: string;
  to: string;
}

export const CITIZEN_LIFELINES: readonly LifelineItem[] = [
  {
    icon: '⌖',
    title: 'জাতীয় ঝুঁকি মানচিত্র',
    subtitle: '২–৪ সপ্তাহের আগাম পূর্বাভাস',
    desc: 'আবহাওয়া ও স্বাস্থ্য তথ্যের সমন্বয়ে বিভাগভিত্তিক ডেঙ্গু প্রাদুর্ভাবের আগাম ঝুঁকির মাত্রা পর্যবেক্ষণ করুন।',
    linkText: 'ঝুঁকির মানচিত্র দেখুন',
    to: '/risk',
  },
  {
    icon: '✚',
    title: 'হাসপাতাল শয্যা ও রক্ত সেবা',
    subtitle: 'জরুরি রক্ত ও চিকিৎসা তথ্য',
    desc: 'নিকটস্থ হাসপাতালে খোলা শয্যা ও ব্লাড ব্যাংকের প্লাটিলেট এবং রক্তের প্রাপ্যতা যাচাই করুন।',
    linkText: 'চিকিৎসা ও রক্ত সেবা',
    to: '/resources',
  },
  {
    icon: '✦',
    title: 'লক্ষণ মূল্যায়ন ও পরামর্শ',
    subtitle: '৬০ সেকেন্ডের স্ব-পরীক্ষা',
    desc: 'লক্ষণ যাচাই করে তাৎক্ষণিক বিপদচিহ্ন এবং পরবর্তী চিকিৎসার সঠিক দিকনির্দেশনা জানুন।',
    linkText: 'লক্ষণ পরীক্ষা করুন',
    to: '/symptoms',
  },
];

export function CitizenLifelines() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">জরুরি সেবা ও তাৎক্ষণিক সংকেত</p>
          <h2>আজকের সার্বিক পরিস্থিতি ও পদক্ষেপ</h2>
        </div>
        <p className="section-note">
          আবহাওয়া ও স্বাস্থ্য উপাত্তের সমন্বয়ে নাগরিক সুরক্ষা ও জরুরি চিকিৎসা সহায়তা।
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {CITIZEN_LIFELINES.map((item) => (
          <article className="prevention-card flex flex-col justify-between" key={item.title}>
            <div>
              <span className="prevention-card__number">{item.subtitle}</span>
              <div className="prevention-card__icon" aria-hidden="true">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </div>
            <Link
              to={item.to}
              className="inline-flex items-center gap-1.5 min-h-[48px] font-bold text-[var(--color-primary)] hover:underline mt-2"
            >
              <span>{item.linkText}</span>
              <span aria-hidden="true">↗</span>
            </Link>
          </article>
        ))}
      </div>

      <div className="mt-6 p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-3xl" aria-hidden="true">📸</span>
          <div>
            <strong className="block text-[var(--color-text)] text-base">আপনার এলাকায় এডিস মশার প্রজননস্থল দেখেছেন?</strong>
            <small className="text-[var(--color-text-muted)] text-sm">জমে থাকা পানির ছবি ও ভৌগোলিক অবস্থান পাঠিয়ে প্রতিরোধ কার্যক্রমে অংশ নিন।</small>
          </div>
        </div>
        <Link to="/report" className="button button--primary shrink-0 min-h-[48px] px-5 py-2.5">
          রিপোর্ট করুন <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
