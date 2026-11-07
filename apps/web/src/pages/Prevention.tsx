import { Link } from 'react-router-dom';

const cards = [
    ['০১', 'মশার কামড় প্রতিরোধ', 'মশানিরোধক লোশন, ফুল হাতা পোশাক ও মশারি ব্যবহারের নিয়মিত অভ্যাস গড়ে তুলুন।', '◌'],
    ['০২', 'জমে থাকা পানি অপসারণ', 'বালতি, ফুলদানি, টব ও ছাদের ড্রেনেজ পাইপ সপ্তাহে অন্তত একবার পরিষ্কার ও শুকনা রাখুন।', '⌁'],
    ['০৩', 'ঘরবাড়ি সুরক্ষিত রাখুন', 'জানালায় নেট ব্যবহার করুন, দরজা বন্ধ রাখুন এবং ঘরের অন্ধকার কোণ পরিচ্ছন্ন রাখুন।', '⌂'],
    ['০৪', 'এলাকা পরিচ্ছন্ন রাখুন', 'সাপ্তাহিক ১০ মিনিটের পরিচ্ছন্নতা অভিযান মশার বংশবৃদ্ধি রুখে দিতে কার্যকর ভূমিকা রাখে।', '♧'],
] as const;

const breedingSites = [
    ['◫', 'বালতি ও খোলা পাত্র', 'খালি রাখুন অথবা শক্তভাবে ঢেকে রাখুন'],
    ['♧', 'গাছের টব ও ট্রে', 'বৃষ্টির পর জমে থাকা পানি ফেলে দিন'],
    ['⌁', 'আবদ্ধ ড্রেন ও নালা', 'ময়লা-আবর্জনা ও জমা পানি পরিষ্কার করুন'],
    ['▱', 'পরিত্যক্ত টায়ার ও প্লাস্টিক', 'শেডের নিচে বা পানি না জমে এমন স্থানে রাখুন'],
] as const;

export default function Prevention() {
    return (
        <main className="inner-page prevention-page">
            <section className="prevention-hero">
                <div>
                    <p className="eyebrow">ডেঙ্গু প্রতিরোধ</p>
                    <h1>ডেঙ্গুর বিস্তার রোধ করুন<br /><em>শুরুতেই সচেতন হোন।</em></h1>
                    <p className="inner-lede">বাসায় ও আশপাশে ছোট ছোট নিয়মিত পদক্ষেপ এডিস মশার বংশবিস্তার চক্র ভেঙে দিতে পারে।</p>
                    <Link className="button button--primary" to="/report">লার্ভার উৎস রিপোর্ট করুন <span>↗</span></Link>
                </div>
                <div className="prevention-illustration" aria-hidden="true">
                    <div className="illustration-sun">☼</div>
                    <div className="illustration-house">⌂</div>
                    <span className="illustration-water">≈ ≈ ≈</span>
                    <span className="illustration-leaf">♧</span>
                </div>
            </section>
            <section className="section">
                <div className="section-heading"><div><p className="eyebrow">চারটি স্বাস্থ্যকর অভ্যাস</p><h2>প্রতিরোধ হোক প্রাত্যহিক জীবনের অংশ</h2></div></div>
                <div className="prevention-grid">
                    {cards.map(([number, title, text, icon]) => (
                        <article className="prevention-card" key={title}>
                            <span className="prevention-card__number">{number}</span>
                            <div className="prevention-card__icon">{icon}</div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                            <Link to="/prevention">আরও জানুন <span>↗</span></Link>
                        </article>
                    ))}
                </div>
            </section>
            <section className="breeding-section">
                <div><p className="eyebrow">আশপাশে লক্ষ্য রাখুন</p><h2>সাধারণ প্রজনন ক্ষেত্রসমূহ</h2><p>অধিকাংশ মশার উৎস ঘরের খুব কাছেই থাকে যা অনেক সময় অসতর্কতায় চোখ এড়িয়ে যায়।</p></div>
                <div className="breeding-list">
                    {breedingSites.map(([icon, title, note]) => <div className="breeding-item" key={title}><span>{icon}</span><div><b>{title}</b><small>{note}</small></div><i>→</i></div>)}
                </div>
            </section>
        </main>
    );
}
