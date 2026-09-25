import { Link } from 'react-router-dom';

const cards = [
    ['01', 'Avoid mosquito bites', 'Repellent, long sleeves, and mosquito nets make a powerful daily habit.', '◌'],
    ['02', 'Remove standing water', 'Empty and scrub containers, buckets, plant pots, and roof gutters every week.', '⌁'],
    ['03', 'Protect your home', 'Use screens, close doors, and keep cool dark corners clear.', '⌂'],
    ['04', 'Keep your community clean', 'A 10-minute weekly clean-up can remove the places mosquitoes lay eggs.', '♧'],
] as const;

const breedingSites = [
    ['◫', 'Buckets & containers', 'Keep empty or covered'],
    ['♧', 'Plant pots & trays', 'Empty after rainfall'],
    ['⌁', 'Blocked drains', 'Clear leaves and debris'],
    ['▱', 'Discarded tires', 'Store under cover'],
] as const;

export default function Prevention() {
    return (
        <main className="inner-page prevention-page">
            <section className="prevention-hero">
                <div>
                    <p className="eyebrow">Dengue prevention</p>
                    <h1>Prevent dengue<br /><em>before it starts.</em></h1>
                    <p className="inner-lede">Small, consistent actions at home and in the neighborhood can interrupt the cycle.</p>
                    <Link className="button button--primary" to="/report">Report a breeding site <span>↗</span></Link>
                </div>
                <div className="prevention-illustration" aria-hidden="true">
                    <div className="illustration-sun">☼</div>
                    <div className="illustration-house">⌂</div>
                    <span className="illustration-water">≈ ≈ ≈</span>
                    <span className="illustration-leaf">♧</span>
                </div>
            </section>
            <section className="section">
                <div className="section-heading"><div><p className="eyebrow">Four habits</p><h2>Make prevention part of your week.</h2></div></div>
                <div className="prevention-grid">
                    {cards.map(([number, title, text, icon]) => (
                        <article className="prevention-card" key={title}>
                            <span className="prevention-card__number">{number}</span>
                            <div className="prevention-card__icon">{icon}</div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                            <Link to="/prevention">Learn more <span>↗</span></Link>
                        </article>
                    ))}
                </div>
            </section>
            <section className="breeding-section">
                <div><p className="eyebrow">Look around</p><h2>Common breeding sites</h2><p>Most mosquito breeding sites are close to home and easy to miss.</p></div>
                <div className="breeding-list">
                    {breedingSites.map(([icon, title, note]) => <div className="breeding-item" key={title}><span>{icon}</span><div><b>{title}</b><small>{note}</small></div><i>→</i></div>)}
                </div>
            </section>
        </main>
    );
}
