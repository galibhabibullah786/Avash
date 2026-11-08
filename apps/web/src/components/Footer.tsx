import { Link } from 'react-router-dom';

export const Footer = () => {
    return (
        <footer className="footer">
            <div className="footer__brand">
                <img src="/icons/brand.svg" alt="" aria-hidden="true" className="w-[27px] h-[27px]" />
                <strong>আভাস</strong>
                <p>সুরক্ষার আগাম বার্তা</p>
                <div className="mt-3 text-xs text-[var(--color-primary)] font-semibold flex items-center gap-1.5">
                    <span aria-hidden="true">📞</span>
                    <span>স্বাস্থ্য বাতায়ন: ১৬২৬৩ (টোল-ফ্রি ২৪/৭)</span>
                </div>
            </div>
            <div className="footer__links">
                <Link to="/risk">ঝুঁকির মানচিত্র</Link>
                <Link to="/weather">আবহাওয়া</Link>
                <Link to="/resources">চিকিৎসা ও রক্ত</Link>
                <Link to="/symptoms">লক্ষণ পরীক্ষা</Link>
                <Link to="/prevention">প্রতিরোধ</Link>
                <Link to="/report">রিপোর্ট করুন</Link>
            </div>
            <p className="footer__note">
                আভাস স্বাস্থ্য তথ্য এবং আবহাওয়া-ভিত্তিক ঝুঁকির পূর্বাভাস প্রদান করে, এটি কোনো সরাসরি চিকিৎসা
                পরামর্শ বা জরুরি সেবা নয়। যেকোনো লক্ষণে বিশেষজ্ঞ চিকিৎসকের পরামর্শ নিন।
            </p>
            <div className="footer__bottom">
                <span>© 2026 আভাস বাংলাদেশ</span>
                <span>
                    সুস্থ সমাজের প্রত্যয়ে <b>আভাস</b>
                </span>
            </div>
        </footer>
    );
};
