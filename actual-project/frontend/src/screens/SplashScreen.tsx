import { useNavigate } from 'react-router-dom';
import '../styles/splash.css';

// A real entry page, independent of how quickly the JavaScript loads. The
// visitor can continue immediately; direct links keep their own destination.
export default function SplashScreen() {
  const navigate = useNavigate();

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
        <button
          type="button"
          className="splash-continue"
          onClick={() => navigate('/welcome', { replace: true })}
        >
          Get Started <span aria-hidden="true">→</span>
        </button>
      </div>
      <footer className="splash-footer">
        COMMUNITY BEACH LITTER REPORTING &amp; CLEANUP SUPPORT FOR MALAYSIA © 2026
      </footer>
    </main>
  );
}
