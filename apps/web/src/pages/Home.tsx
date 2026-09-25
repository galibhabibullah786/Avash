import { Link } from "react-router-dom";
import { useHealth } from "../features/health/useHealth";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

const preventionCards = [
  [
    "01",
    "Avoid bites",
    "Wear long sleeves and use mosquito repellent, especially at dawn and dusk.",
    "◌",
  ],
  [
    "02",
    "Remove standing water",
    "Empty containers, plant trays, and anything that can collect rainwater.",
    "⌁",
  ],
  [
    "03",
    "Protect your home",
    "Keep doors and windows screened. Sleep under a mosquito net when needed.",
    "⌂",
  ],
  [
    "04",
    "Clean your community",
    "Join a weekly 10-minute clean-up around your home and neighborhood.",
    "♧",
  ],
];

export default function Home() {
  const isOnline = useOnlineStatus();
  const health = useHealth();

  return (
    <main className="home">
      <section className="home__hero">
        <div className="home__hero-copy">
          <p className="eyebrow">
            <span className="eyebrow__dot" /> Bangladesh dengue intelligence
          </p>

          <h1>সুরক্ষার আগাম বার্তা</h1>

          <p className="home__lede">
            Early warnings, local insight, and practical prevention for every
            community in Bangladesh.
          </p>

          <div className="button-row">
            <Link className="button button--primary" to="/risk">
              Explore risk map <span>↗</span>
            </Link>
          </div>

          <div className="hero__trust">
            <span>●</span> Updated daily from weather and health signals{" "}
            <strong>·</strong>
          </div>
        </div>

        <img style={{ width: '550px', borderRadius: "50px" }} src="/img/mosquito.png" />
      </section>

      <section className="section ai-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">From signal to action</p>
            <h2>Smarter warnings, sooner.</h2>
          </div>
          <p className="section-note">
            AVASH brings together the signals that matter, turning complex data
            into a clear next step.
          </p>
        </div>
        <div className="ai-flow">
          {[
            ["01", "Dengue data", "Cases & reports"],
            ["02", "Weather", "Rainfall & humidity"],
            ["03", "AI model", "Pattern detection"],
            ["04", "Risk prediction", "2–4 week outlook"],
            ["05", "Your map", "Local action"],
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
            <p className="eyebrow">Small steps. Big impact.</p>
            <h2>Prevention starts here.</h2>
          </div>
          <Link className="text-link" to="/prevention">
            See all prevention tips <span>↗</span>
          </Link>
        </div>
        <div className="prevention-grid">
          {preventionCards.map(([number, title, text, icon]) => (
            <article className="prevention-card" key={title}>
              <span className="prevention-card__number">{number}</span>
              <div className="prevention-card__icon">{icon}</div>
              <h3>{title}</h3>
              <p>{text}</p>
              <Link to="/prevention" aria-label={`Learn more about ${title}`}>
                Learn more <span>↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section
        className="status-panel home__status"
        aria-label="API connection status"
      >
        <h2 className="status-panel__title">System status</h2>
        {!isOnline ? (
          <p className="status-panel__item" data-testid="status-offline">
            You are offline
          </p>
        ) : health.isLoading ? (
          <p className="status-panel__item" data-testid="status-loading">
            Checking live signals...
          </p>
        ) : health.isError ? (
          <p className="status-panel__item" data-testid="status-error">
            API: unavailable right now. Please try again later.
          </p>
        ) : (
          <p className="status-panel__item" data-testid="status-success">
            Live signals connected: {health.data?.status ?? "unknown"}
          </p>
        )}
      </section>
    </main>
  );
}
