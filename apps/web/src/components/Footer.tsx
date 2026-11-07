import { Link } from 'react-router-dom';

export const Footer = () => {
    return (
        <footer className="footer">
            <div className="footer__brand">
                <img src="/icons/brand.svg" alt="আভাস লোগো" style={{ width: "27px", height: "27px" }} aria-hidden="true" />
                <strong>আভাস</strong>
                <p>সুরক্ষার আগাম বার্তা</p>
            </div>
            <div className="footer__links">
                <Link to="/risk">ঝুঁকির মানচিত্র</Link>
                <Link to="/symptoms">লক্ষণ পরীক্ষা</Link>
                <Link to="/prevention">প্রতিরোধ</Link>
                <Link to="/report">রিপোর্ট করুন</Link>
            </div>
            <p className="footer__note">
                আভাস স্বাস্থ্য তথ্য এবং ঝুঁকির পূর্বাভাস প্রদান করে, এটি কোনো সরাসরি চিকিৎসা
                পরামর্শ বা জরুরি সেবা নয়। যেকোনো লক্ষণে বিশেষজ্ঞ চিকিৎসকের পরামর্শ নিন।
            </p>
            <div className="footer__bottom">
                <span>© 2026 আভাস বাংলাদেশ</span>
                <span>
                    সুস্থ সমাজের প্রত্যয়ে <b>আভাস</b>
                </span>
            </div>
        </footer>
    );
};