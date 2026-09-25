import { Link } from 'react-router-dom';

export const Footer = () => {
    return (
        <footer className="footer">
            <div className="footer__brand">
                <span className="navbar__mark" aria-hidden="true">
                    ✦
                </span>
                <strong>আভাস</strong>
                <p>সুরক্ষার আগাম বার্তা</p>
            </div>
            <div className="footer__links">
                <Link to="/risk">Risk Map</Link>
                <Link to="/symptoms">Symptoms</Link>
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