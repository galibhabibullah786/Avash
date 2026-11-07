import { Link } from "react-router-dom";
import { useHealth } from "../features/health/useHealth";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

const preventionCards = [
  [
    "01",
    "মশার কামড় এড়িয়ে চলুন",
    "ফুল হাতা পোশাক পরিধান করুন এবং বিশেষ করে সকাল ও সন্ধ্যায় মশানিরোধক ব্যবহার করুন।",
    "◌",
  ],
  [
    "02",
    "জমে থাকা পানি অপসারণ করুন",
    "টব, পাত্র, বালতি ও ডাবের খোসা পরিষ্কার রাখুন যাতে বৃষ্টির পানি জমতে না পারে।",
    "⌁",
  ],
  [
    "03",
    "ঘরবাড়ি সুরক্ষিত রাখুন",
    "জানালা-দরজায় নেট লাগান এবং রাতে ঘুমানোর সময় অবশ্যই মশারি ব্যবহার করুন।",
    "⌂",
  ],
  [
    "04",
    "এলাকা পরিচ্ছন্ন রাখুন",
    "প্রতি সপ্তাহে অন্তত ১০ মিনিট সময় নিয়ে নিজের আঙিনা ও আশপাশের পরিবেশ পরিষ্কার করুন।",
    "♧",
  ],
];

export default function Home() {
  const isOnline = useOnlineStatus();
  const health = useHealth();
  const { status: installStatus, promptInstall, isIos, dismissPrompt } = useInstallPrompt();

  return (
    <main className="home">
      <section className="home__hero">
        <div className="home__hero-copy">
          <p className="eyebrow">
            <span className="eyebrow__dot" /> বাংলাদেশ ডেঙ্গু পূর্বাভাস ও তথ্য
          </p>

          <h1>সুরক্ষার আগাম বার্তা</h1>

          <p className="home__lede">
            বাংলাদেশের প্রতিটি এলাকার জন্য আগাম সতর্কতা, স্থানীয় ঝুঁকি বিশ্লেষণ এবং কার্যকর প্রতিরোধ।
          </p>

          <div className="button-row">
            <Link className="button button--primary" to="/risk">
              ঝুঁকির মানচিত্র দেখুন <span>↗</span>
            </Link>
          </div>

          <div className="hero__trust">
            <span>●</span> আবহাওয়া ও স্বাস্থ্য তথ্যের ভিত্তিতে প্রতিদিন হালনাগাদকৃত{" "}
            <strong>·</strong>
          </div>
        </div>

        <img style={{ maxWidth: '100%', width: '550px', height: 'auto', borderRadius: "24px" }} src="/img/mosquito.png" alt="ডেঙ্গু সচেতনতা" />
      </section>

      {installStatus === 'available' ? (
        <section className="px-6 py-4 mx-auto my-4 max-w-5xl bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4" data-testid="home-install-banner">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">📲</span>
            <div>
              <strong className="block text-[var(--color-text)]">আভাস অ্যাপ ইনস্টল করুন</strong>
              <small className="text-[var(--color-text-muted)]">ব্রাউজার বন্ধ থাকলেও তাৎক্ষণিক ডেঙ্গু সতর্কতা পেতে আপনার ডিভাইসে ইনস্টল করুন।</small>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="button button--primary text-sm py-2 px-4"
              onClick={() => void promptInstall()}
              data-testid="home-install-btn"
            >
              ইনস্টল করুন
            </button>
            <button
              type="button"
              className="button button--quiet text-sm py-2 px-3 text-[var(--color-text-muted)]"
              onClick={() => dismissPrompt?.()}
              aria-label="বিজ্ঞপ্তি বন্ধ করুন"
            >
              ✕
            </button>
          </div>
        </section>
      ) : isIos && installStatus !== 'installed' && installStatus !== 'dismissed' ? (
        <section className="px-6 py-4 mx-auto my-4 max-w-5xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4" data-testid="home-ios-banner">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🍏</span>
            <div>
              <strong className="block text-[var(--color-text)]">আইফোনে ডেঙ্গু সতর্কতা সক্রিয় করুন</strong>
              <small className="text-[var(--color-text-muted)]">আইফোনে সতর্কতা পেতে Safari-এর <b>Share ⎋</b> বোতাম চেপে <b>&apos;Add to Home Screen ⊞&apos;</b> নির্বাচন করুন।</small>
            </div>
          </div>
          <button
            type="button"
            className="button button--quiet text-sm py-2 px-3 text-[var(--color-text-muted)] shrink-0"
            onClick={() => dismissPrompt?.()}
            aria-label="বিজ্ঞপ্তি বন্ধ করুন"
          >
            ✕
          </button>
        </section>
      ) : null}

      <section className="section ai-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">সংকেত থেকে তাৎক্ষণিক পদক্ষেপ</p>
            <h2>আগেভাগেই নির্ভুল পূর্বাভাস</h2>
          </div>
          <p className="section-note">
            আভাস প্রয়োজনীয় তথ্যসমূহ সমন্বয় করে জটিল স্বাস্থ্য ও আবহাওয়ার উপাত্তকে সহজ কার্যক্রমে রূপান্তর করে।
          </p>
        </div>
        <div className="ai-flow">
          {[
            ["০১", "ডেঙ্গু তথ্য", "আক্রান্ত ও রিপোর্ট"],
            ["০২", "আবহাওয়া", "বৃষ্টিপাত ও আর্দ্রতা"],
            ["০৩", "এআই মডেল", "প্যাটার্ন শনাক্তকরণ"],
            ["০৪", "ঝুঁকি পূর্বাভাস", "২–৪ সপ্তাহের আগাম বার্তা"],
            ["০৫", "আপনার মানচিত্র", "স্থানীয় পদক্ষেপ"],
          ].map(([number, title, sub], index) => (
            <div className="ai-step" key={title}>
              <span>{number}</span>
              <div className={`ai-icon ai-icon--${index}`}>
                {["⌁", "☼", "✦", "↗", "⌖"][index]}
              </div>
              <b>{title}</b>
              <small>{sub}</small>
              {index < 4 && <i>→</i>}
            </div>
          ))}
        </div>
      </section>
      <section className="section prevention-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ছোট পদক্ষেপ, বড় সুরক্ষা</p>
            <h2>প্রতিরোধ শুরু হোক এখনই</h2>
          </div>
          <Link className="text-link" to="/prevention">
            সকল প্রতিরোধ পরামর্শ দেখুন <span>↗</span>
          </Link>
        </div>
        <div className="prevention-grid">
          {preventionCards.map(([number, title, text, icon]) => (
            <article className="prevention-card" key={title}>
              <span className="prevention-card__number">{number}</span>
              <div className="prevention-card__icon">{icon}</div>
              <h3>{title}</h3>
              <p>{text}</p>
              <Link to="/prevention" aria-label={`${title} সম্পর্কে বিস্তারিত জানুন`}>
                বিস্তারিত জানুন <span>↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section
        className="status-panel home__status"
        aria-label="সিস্টেম সংযোগ অবস্থা"
      >
        <h2 className="status-panel__title">সিস্টেম সংযোগ অবস্থা</h2>
        {!isOnline ? (
          <p className="status-panel__item" data-testid="status-offline">
            আপনি অফলাইনে আছেন
          </p>
        ) : health.isLoading ? (
          <p className="status-panel__item" data-testid="status-loading">
            লাইভ সংকেত যাচাই করা হচ্ছে...
          </p>
        ) : health.isError ? (
          <p className="status-panel__item" data-testid="status-error">
            সার্ভার সংযোগ এই মুহূর্তে অনুপলব্ধ। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
          </p>
        ) : (
          <p className="status-panel__item" data-testid="status-success">
            লাইভ সংযোগ সক্রিয়: {health.data?.status ?? "স্বাভাবিক"}
          </p>
        )}
      </section>
    </main>
  );
}
