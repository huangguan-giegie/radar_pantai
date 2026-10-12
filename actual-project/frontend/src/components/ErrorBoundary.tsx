/*
 * The last thing standing between a thrown render and a blank white page.
 *
 * Without one, any error inside a screen unmounts the whole tree and React
 * leaves an empty <div id="root">. No text, no error, no way back - the user
 * cannot even tell the app broke rather than the network. We hit exactly that:
 * a single unparseable value in localStorage took the entire app down.
 *
 * This is deliberately NOT a place to explain the failure. A volunteer on a
 * beach cannot act on a stack trace, and the message they can act on is
 * "start again". The technical detail goes to the console for us.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { C, MONO } from '../theme';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[radar-pantai] a screen failed to render', error, info.componentStack);
  }

  // Clears the two keys that can hold a value bad enough to break a render,
  // then does a full reload rather than a re-render: whatever produced the bad
  // state is in module scope, so only a fresh load actually re-runs it.
  private restart = () => {
    for (const key of ['rs_mock_accounts_v2', 'rs_mock_photos_v1', 'rs_report_draft_v1']) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch {
        // Storage unavailable. The reload is still worth trying.
      }
    }
    window.location.replace('/home');
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
          background: C.bg,
        }}
      >
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: C.dim }}>
            RADAR PANTAI
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 650, letterSpacing: '-.3px', color: C.ink, margin: '12px 0 0' }}>
            This screen stopped working
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, margin: '10px 0 0' }}>
            Your submitted reports are saved. Starting again clears any unsent draft.
          </p>
          <button
            type="button"
            onClick={this.restart}
            style={{
              marginTop: 22,
              padding: '13px 26px',
              borderRadius: 16,
              background: C.navy,
              color: C.bg,
              fontSize: 14.5,
              fontWeight: 650,
            }}
          >
            Start Again
          </button>
        </div>
      </div>
    );
  }
}
