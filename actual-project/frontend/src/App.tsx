

// The route table: which URL shows which screen.
//
// This is the map of the whole app. Read it top to bottom and you can see
// every page we have and what it takes to reach it. Pages that need a signed
// in user are wrapped in <RequireAuth>; pages in the middle of the report flow
// are also wrapped in <RequireStep>.
//
// It also keeps the browser tab title and a spoken page name in step with the
// route, and shows the session-trouble banner. See pageTitle below.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { DeviceFrame } from './components/DeviceFrame';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { useApp } from './AppContext';
import { guardStep, type ReportStep } from './flowRules';
import { useAppBack } from './navigation';
import { BackButton } from './components/ui';

import SplashScreen from './screens/SplashScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import IdentityScreen from './screens/IdentityScreen';
import HomeScreen from './screens/HomeScreen';
import NotFoundScreen from './screens/NotFoundScreen';
const MapScreen = lazy(() => import('./screens/MapScreen'));
const BeachScreen = lazy(() => import('./screens/CoastalBeachScreen'));
import MethodScreen from './screens/MethodScreen';
import PhotoScreen from './screens/PhotoScreen';
import GpsScreen from './screens/GpsScreen';
import ConfirmBeachScreen from './screens/ConfirmBeachScreen';
import RecordScreen from './screens/RecordScreen';
import ReviewScreen from './screens/ReviewScreen';
import SubmittedScreen from './screens/SubmittedScreen';
import MyReportsScreen from './screens/MyReportsScreen';
import ReportDetailScreen from './screens/ReportDetailScreen';
import AccountScreen from './screens/AccountScreen';
import AdminAccessDeniedScreen from './screens/AdminAccessDeniedScreen';
// Keep the short background page ready when opened from Home.
import BackgroundScreen from './screens/BackgroundScreen';
const CommunityScreen = lazy(() => import('./screens/CommunityScreen'));
const EventScreen = lazy(() => import('./screens/EventScreen'));
const CheckInScreen = lazy(() => import('./screens/CheckInScreen'));
const CleanupScreen = lazy(() => import('./screens/CleanupScreen'));
const CleanupResultScreen = lazy(() => import('./screens/CleanupResultScreen'));
const EventResultScreen = lazy(() => import('./screens/EventResultScreen'));
const SharedEventScreen = lazy(() => import('./screens/SharedEventScreen'));
const SharedItemScreen = lazy(() => import('./screens/SharedItemScreen'));
const AiSuggestionScreen = lazy(() => import('./screens/AiSuggestionScreen'));
const AiMethodScreen = lazy(() => import('./screens/AiMethodScreen'));
const AdminEventScreen = lazy(() => import('./screens/AdminEventScreen'));
const GalleryScreen = lazy(() => import('./screens/GalleryScreen'));
const InsightsScreen = lazy(() => import('./screens/InsightsScreen'));
const MarineLifeScreen = lazy(() => import('./screens/MarineLifeScreen'));
const SpeciesScreen = lazy(() => import('./screens/MarineLifeScreen').then(m => ({default:m.SpeciesScreen})));
const ModelSpeciesScreen = lazy(() => import('./screens/ModelSpeciesScreen'));
const HabitatScreen = lazy(() => import('./screens/MarineLifeScreen').then(m => ({default:m.HabitatScreen})));
const MarineAreaScreen = lazy(() => import('./screens/MarineLifeScreen').then(m => ({default:m.MarineAreaScreen})));
const PhotoCreditsScreen = lazy(() => import('./screens/PhotoCreditsScreen'));
const WildlifeHelpScreen = lazy(() => import('./screens/WildlifeHelpScreen'));


// Main destinations retain their tab bar; focused report/detail flows use Back.
// It is hidden all through the report flow on purpose: while filing a report
// the user has one job, and a tab bar is an invitation to wander off and lose
// what they typed.
const TAB_ROUTES = ['/home', '/map', '/community', '/reports', '/account', '/marine-life', '/habitats'];

function LoadingPage({ message = 'Loading...' }: { message?: string }) {
  const goBack = useAppBack('/home');
  return <div className="screen scroll-y"><div className="measure i2-page">
    <BackButton onClick={goBack} />
    <p role="status">{message}</p>
  </div></div>;
}


/**
 * Send anyone who is not signed in to the identity screen, and remember where
 * they were going so we can put them back there afterwards.
 *
 * The "?next=" part matters in a web app: people arrive from a shared link or
 * a bookmark, not always from our home page. Without it, signing in would
 * always dump them on /home and they would have to find that beach again.
 * The value is cleaned by safeNextPath() before it is used.
 */
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, authReady } = useApp();
  const { pathname, search } = useLocation();
  // Render nothing until we know who the user is. Deciding earlier would
  // redirect on the strength of a guess, and send people to the sign-in page
  // they were about to be let past.
  if (!authReady) return <LoadingPage message="Restoring your session..." />;
  if (!user) {
    return <Navigate to={`/identity?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, authReady } = useApp();
  const { pathname, search } = useLocation();
  if (!authReady) return <LoadingPage message="Restoring your session..." />;
  if (!user) return <Navigate to={`/identity?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (user.role !== 'moderator') return <AdminAccessDeniedScreen />;
  return children;
}


/**
 * The report-flow guard. If someone lands in the middle of the flow by typing
 * a URL or opening a bookmark, send them to the step they can actually be on.
 *
 * It sits INSIDE RequireAuth, not outside: a signed-out deep link should first
 * go to /identity?next=..., come back to the same URL, and only then be
 * checked for how far the draft has got. The other order would decide the step
 * for a user we have not identified yet. The rule itself is in flowRules.ts.
 *
 * One case is not sent back into the flow at all - see below.
 */
function RequireStep({ step, children }: { step: ReportStep; children: JSX.Element }) {
  const { draft, lastSavedReport } = useApp();
  const to = guardStep(step, draft);
  // The user has just finished a report, so the draft is empty again. Sending
  // them back to step 1 here would look like the app had started a fresh
  // report on its own - which is what the back button from the confirmation
  // screen, or an old report URL, would do. Their reports list is the honest
  // place to land instead.
  //
  // This does not get in the way of filing another report: SubmittedScreen
  // clears lastSavedReport before it sends the user to step 1.
  if (to && lastSavedReport) return <Navigate to="/reports" replace />;
  return to ? <Navigate to={to} replace /> : children;
}

export default function App() {
  const { pathname } = useLocation();
  const { toast, authSyncError, retryAuth } = useApp();
  // A plain name for the page the user is on, worked out from the URL.
  //
  // Every screen sits inside the same phone-shaped frame, so nothing on the
  // page itself tells a browser user which one they are on. This single string
  // feeds both the tab title and the spoken announcement below, so the two can
  // never drift apart.
  //
  // Order matters here: /report/saved is tested first because it also starts
  // with /report/, and the wider test below would otherwise swallow it and
  // call the confirmation page "Add a report".
  const legacyPageTitle = pathname.startsWith('/report/saved')
    ? 'Report saved'
    : pathname.startsWith('/report/')
      ? 'Add a report'
      : pathname.startsWith('/share/')
        ? 'Shared item'
        : pathname.startsWith('/events/') && pathname.endsWith('/check-in')
          ? 'Cleanup check-in'
          : pathname.startsWith('/events/') && pathname.endsWith('/result')
            ? 'Cleanup activity result'
            : pathname.startsWith('/events/')
              ? 'Cleanup activity'
              : pathname === '/platform/events/new'
                ? 'Create an activity'
              : pathname.startsWith('/cleanup/result/')
                ? 'Cleanup result'
                : pathname.startsWith('/cleanup/')
                  ? 'Add a cleanup'
                  : pathname.startsWith('/beach/') && pathname.endsWith('/gallery')
                    ? 'Litter gallery'
                    : pathname.startsWith('/beach/')
                      ? 'Beach details'
                      : pathname === '/community'
                        ? 'Community cleanups'
                        : pathname.startsWith('/background')
                          ? 'Background'
                        : pathname === '/method/ai'
                          ? 'AI suggestion method'
                          : pathname === '/map'
                            ? 'Beach map'
                            : pathname.startsWith('/reports/')
                              ? 'Report details'
                              : pathname === '/reports'
                                ? 'My reports'
                                : pathname === '/account'
                                  ? 'Account'
                                  : pathname === '/home'
                                    ? 'Home'
                                    : 'Radar Sampah';
  const pageTitle = pathname.startsWith('/insights') ? 'Beach Insights'
    : pathname.startsWith('/j/') ? 'Cleanup invitation'
    : pathname.startsWith('/species/') || pathname.startsWith('/model-species/') ? 'Species guide'
    : pathname.startsWith('/habitats') ? 'Coastal habitats'
    : pathname.startsWith('/marine-area') ? 'Marine life by area'
    : pathname === '/marine-life' ? 'Marine life'
    : pathname === '/about' || pathname === '/background' ? 'About us'
    : pathname === '/credits' ? 'Photo credits'
    : pathname.startsWith('/account/') ? 'Account'
    : pathname === '/community/wildlife-help' ? 'Animal hurt or stranded'
    : pathname === '/community/needs-volunteers' ? 'Beaches needing help'
    : legacyPageTitle;

  // Keep the browser tab title in step with the route.
  //
  // This is one page as far as the browser is concerned, so the title never
  // changes by itself. Without this, every open tab, every bookmark and every
  // history entry would read "Radar Sampah" and none could be told apart.
  useEffect(() => {
    document.title = `${pageTitle} · Radar Sampah`;
  }, [pageTitle]);

  return (
    <DeviceFrame>
      {/* Says the new page name out loud for screen reader users.

          Moving between routes does not reload the page, so a screen reader
          announces nothing on its own and the user is left guessing whether
          the tap did anything. A polite live region speaks the new name after
          whatever it is already reading, without cutting the user off.

          The style hides the text from sight but keeps it in the page.
          display:none or visibility:hidden would hide it from screen readers
          too, and then it would say nothing at all. */}
      <div
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
      >
        {pageTitle}
      </div>
      <Suspense fallback={<LoadingPage />}>
      <Routes>
        {/* Public pages. Anyone can look at beach data without an account -
            that is the point of the project, and it is what makes the map
            worth sharing. Only FILING a report needs an identity. */}
        <Route path="/" element={<SplashScreen />} />
        <Route path="/splash" element={<SplashScreen />} />
        <Route path="/background/intro" element={<Navigate to="/welcome" replace />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/identity" element={<IdentityScreen />} />

        <Route path="/home" element={<HomeScreen />} />
        <Route path="/insights" element={<InsightsScreen />} />
        <Route path="/insights/:topic" element={<InsightsScreen />} />
        <Route path="/insights/:topic/:beachId" element={<InsightsScreen />} />
        <Route path="/marine-life" element={<MarineLifeScreen />} />
        <Route path="/species/:speciesId" element={<SpeciesScreen />} />
        <Route path="/model-species/:scientificKey" element={<ModelSpeciesScreen />} />
        <Route path="/habitats" element={<HabitatScreen />} />
        <Route path="/habitats/:habitatId" element={<HabitatScreen />} />
        <Route path="/marine-area" element={<MarineAreaScreen />} />
        <Route path="/marine-area/:regionId" element={<MarineAreaScreen />} />
        <Route path="/credits" element={<PhotoCreditsScreen />} />
        <Route path="/community/wildlife-help" element={<WildlifeHelpScreen />} />
        <Route path="/community/needs-volunteers" element={<CommunityScreen />} />
        <Route path="/account/:section" element={<RequireAuth><AccountScreen /></RequireAuth>} />
        <Route path="/map" element={<MapScreen />} />
        <Route path="/beach/:beachId" element={<BeachScreen />} />
        <Route path="/beach/:beachId/gallery" element={<GalleryScreen />} />
        <Route path="/method" element={<MethodScreen />} />
        <Route path="/method/ai" element={<AiMethodScreen />} />
        <Route path="/background" element={<BackgroundScreen />} />
        <Route path="/about" element={<BackgroundScreen />} />

        <Route path="/community" element={<CommunityScreen />} />
        <Route path="/events/:eventId" element={<EventScreen />} />
        <Route path="/events/:eventId/result" element={<EventResultScreen />} />
        <Route path="/share/events/:eventId" element={<SharedEventScreen />} />
        <Route path="/j/:eventId" element={<SharedEventScreen />} />
        <Route path="/share/:token" element={<SharedItemScreen />} />
        <Route path="/events/:eventId/check-in" element={<RequireAuth><CheckInScreen /></RequireAuth>} />
        <Route path="/cleanup/:beachId" element={<RequireAuth><CleanupScreen /></RequireAuth>} />
        <Route path="/cleanup/result/:cleanupId" element={<RequireAuth><CleanupResultScreen /></RequireAuth>} />
        <Route path="/platform/events/new" element={<RequireAdmin><AdminEventScreen /></RequireAdmin>} />

        {/* The report flow, in order. Two wrappers on each one:
            RequireAuth  - you must be identified to file a report
            RequireStep  - you must have finished the earlier steps */}
        <Route path="/report/photo" element={
          <RequireAuth><RequireStep step="photo"><PhotoScreen /></RequireStep></RequireAuth>
        } />
        <Route path="/report/location" element={
          <RequireAuth><RequireStep step="location"><GpsScreen /></RequireStep></RequireAuth>
        } />
        <Route path="/report/confirm" element={
          <RequireAuth><RequireStep step="confirm"><ConfirmBeachScreen /></RequireStep></RequireAuth>
        } />
        <Route path="/report/details" element={
          <RequireAuth><RequireStep step="details"><RecordScreen /></RequireStep></RequireAuth>
        } />
        <Route path="/report/suggestions" element={
          <RequireAuth><RequireStep step="suggestions"><AiSuggestionScreen /></RequireStep></RequireAuth>
        } />
        <Route path="/report/review" element={
          <RequireAuth><RequireStep step="review"><ReviewScreen /></RequireStep></RequireAuth>
        } />
        {/* The result page has no RequireStep. By the time we get here the
            draft has been cleared, so a step check would look at an empty
            draft and bounce the user off the confirmation they just earned. */}
        <Route path="/report/saved" element={<RequireAuth><SubmittedScreen /></RequireAuth>} />

        <Route path="/reports" element={<RequireAuth><MyReportsScreen /></RequireAuth>} />
        <Route path="/reports/:reportId" element={<RequireAuth><ReportDetailScreen /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><AccountScreen /></RequireAuth>} />

        {/* Keep mistyped or outdated URLs visible with a useful 404 screen. */}
        <Route path="*" element={<NotFoundScreen />} />
      </Routes>
      </Suspense>

      {/* We could not refresh the session, but the old one still looks valid,
          so the user stays where they are and gets a quiet strip instead of
          being thrown out. role="status" so a screen reader mentions it after
          the current sentence rather than interrupting. Retry asks again -
          usually all that is needed once the network is back. */}
      {authSyncError && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 'calc(var(--safe-bottom) + 14px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 14,
            background: '#FFF8E8',
            border: '1px solid rgba(154,106,20,.25)',
            color: '#6B4A14',
            fontSize: 12,
          }}
        >
          <span>{authSyncError}</span>
          <button type="button" onClick={() => void retryAuth()} style={{ border: 0, background: 'transparent', color: '#6B4A14', fontWeight: 700, padding: 0 }}>
            Retry
          </button>
        </div>
      )}

      {(TAB_ROUTES.includes(pathname) || pathname.startsWith('/insights') || pathname.startsWith('/account/') || pathname.startsWith('/community/')) && <TabBar />}
      {toast && <Toast message={toast} />}
    </DeviceFrame>
  );
}
