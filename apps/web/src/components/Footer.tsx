import { Link } from 'react-router-dom';

export const Footer = () => {
    return (
        <footer className="footer">
            <div className="footer__brand">
                <img src="/icons/brand.svg" alt="Avas Brand Icon" style={{ width: "27px", height: "27px" }} aria-hidden="true" />
                <strong>আভাস</strong>
                <p>সুরক্ষার আগাম বার্তা</p>
            </div>
            <div className="footer__links">
                <Link to="/risk">Risk Map</Link>
                <Link to="/symptoms">Symptoms-checker</Link>
                <Link to="/prevention">Prevention</Link>
                <Link to="/report">Report Site</Link>
            </div>
            <p className="footer__note">
                আভাস provides health information and risk insights, not medical
                diagnosis or emergency care. Seek professional medical advice for
                symptoms.
            </p>
            <div className="footer__bottom">
                <span>© 2026 আভাস Bangladesh</span>
                <span>
                    Built for healthier communities <b>আভাস</b>
                </span>
            </div>
        </footer>
    );
}