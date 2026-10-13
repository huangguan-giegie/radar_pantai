import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/splash.css';

// Show the brand splash briefly, then continue to the original welcome route.
// Using replace prevents Back from reopening the splash after the redirect.
export default function SplashScreen() {
  const navigate = useNavigate();

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      navigate('/welcome', { replace: true });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [navigate]);

  return (
    <main className="screen splash-screen" aria-labelledby="splash-title">
      <div className="splash-body">
        <div className="splash-radar" aria-hidden="true">
          <span className="splash-radar-ring splash-radar-ring-middle" />
          <span className="splash-radar-ring splash-radar-ring-inner" />
          <span className="splash-radar-axis splash-radar-axis-vertical" />
          <span className="splash-radar-axis splash-radar-axis-horizontal" />
          <span className="splash-radar-sweep" />
          <span className="splash-radar-dot splash-radar-dot-one" />
          <span className="splash-radar-dot splash-radar-dot-two" />
          <span className="splash-radar-centre" />
        </div>
        <h1 id="splash-title">Radar Pantai</h1>
        <p className="splash-tagline">
          REPORT LITTER. SUPPORT CLEANUPS. PROTECT MARINE LIFE.
        </p>
      </div>
      <footer className="splash-footer">
        COMMUNITY BEACH LITTER REPORTING &amp; CLEANUP SUPPORT FOR MALAYSIA © 2026
      </footer>
    </main>
  );
}
