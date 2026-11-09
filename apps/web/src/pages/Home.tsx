import { Link } from "react-router-dom";
import { useHealth } from "../features/health/useHealth";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { CitizenLifelines, EmergencyHelpline } from "../features/home";

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
    "✦",
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
            <Link className="button button--primary min-h-[48px]" to="/risk">
              ঝুঁকির মানচিত্র দেখুন <span aria-hidden="true">↗</span>
            </Link>
            <Link className="button button--quiet min-h-[48px]" to="/symptoms">
              লক্ষণ পরীক্ষা করুন <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <div className="hero__trust">
            <span>●</span> আবহাওয়া ও স্বাস্থ্য তথ্যের ভিত্তিতে প্রতিদিন হালনাগাদকৃত
          </div>
        </div>

        <img
          style={{ maxWidth: '100%', width: '550px', height: 'auto', borderRadius: "24px" }}
          src="/img/mosquito.png"
          alt="ডেঙ্গু সচেতনতা ও সতর্কতা"
          width={550}
          height={380}
        />
      </section>

      {/* Emergency Helpline */}
      <EmergencyHelpline />

      {/* Install Prompt Banners */}
      {installStatus === 'available' ? (
        <section className="max-w-5xl bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4" data-testid="home-install-banner" style={{ padding: '10px', marginBottom: '20px' }}>
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
              className="button button--primary text-sm min-h-[48px] py-2.5 px-4"
              onClick={() => void promptInstall()}
              data-testid="home-install-btn"
            >
              ইনস্টল করুন
            </button>
            <button
              type="button"
              className="button button--quiet text-sm min-h-[48px] min-w-[48px] py-2.5 px-3 text-[var(--color-text-muted)]"
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
            className="button button--quiet text-sm min-h-[48px] min-w-[48px] py-2.5 px-3 text-[var(--color-text-muted)] shrink-0"
            onClick={() => dismissPrompt?.()}
            aria-label="বিজ্ঞপ্তি বন্ধ করুন"
          >
            ✕
          </button>
        </section>
      ) : null}

      {/* Citizen Lifelines */}
      <CitizenLifelines />

      {/* Prevention Advice Section */}
      <section className="section prevention-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ছোট পদক্ষেপ, বড় সুরক্ষা</p>
            <h2>প্রতিরোধ শুরু হোক এখনই</h2>
          </div>
          <Link className="text-link inline-flex items-center gap-1 min-h-[48px]" to="/prevention">
            সকল প্রতিরোধ পরামর্শ দেখুন <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="prevention-grid">
          {preventionCards.map(([number, title, text, icon]) => (
            <article className="prevention-card" key={title}>
              <span className="prevention-card__number">{number}</span>
              <div className="prevention-card__icon" aria-hidden="true">{icon}</div>
              <h3>{title}</h3>
              <p>{text}</p>
              <Link
                to="/prevention"
                className="inline-flex items-center gap-1 min-h-[48px]"
                aria-label={`${title} সম্পর্কে বিস্তারিত জানুন`}
              >
                বিস্তারিত জানুন <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Connection & Telemetry Status */}
      <section
        className="status-panel home__status"
        aria-label="সিস্টেম সংযোগ অবস্থা"
        role="status"
        aria-live="polite"
      >
        <h2 className="status-panel__title sr-only">সিস্টেম সংযোগ অবস্থা</h2>
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
          {!isOnline ? (
            <p className="status-panel__item m-0 flex items-center gap-2" data-testid="status-offline">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)] inline-block" aria-hidden="true" />
              আপনি অফলাইনে আছেন (সংরক্ষিত তথ্য প্রদর্শিত হচ্ছে)
            </p>
          ) : health.isLoading ? (
            <p className="status-panel__item m-0 flex items-center gap-2" data-testid="status-loading">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)] inline-block animate-pulse" aria-hidden="true" />
              লাইভ সংকেত যাচাই করা হচ্ছে...
            </p>
          ) : health.isError ? (
            <p className="status-panel__item m-0 flex items-center gap-2" data-testid="status-error">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)] inline-block" aria-hidden="true" />
              সার্ভার সংযোগ এই মুহূর্তে অনুপলব্ধ। ক্যাশড তথ্য সক্রিয়।
            </p>
          ) : (
            <p className="status-panel__item m-0 flex items-center gap-2" data-testid="status-success">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-safe)] inline-block" aria-hidden="true" />
              লাইভ সংযোগ সক্রিয়: {health.data?.status ?? "স্বাভাবিক"}
            </p>
          )}
          <span className="text-[var(--color-text-muted)] text-xs">স্বাস্থ্য অধিদপ্তর (DGHS) ও আবহাওয়া অধিদপ্তর (BMD) মানদণ্ড অনুযায়ী</span>
        </div>
      </section>
    </main>
  );
}
