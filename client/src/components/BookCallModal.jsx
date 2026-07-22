import { useEffect, useRef } from 'react';

const WIDGET_URL = 'https://www.navjotchahal.ca/api-site/widget/87802';

// The chime widget posts a `postMessage` telling its embedder how tall its
// content actually is (it renders inside its own iframe, so it can't resize
// itself) — this is the same auto-resize contract as the raw <iframe>+<script>
// snippet from navjotchahal.ca, just wired up as a React effect instead of an
// inline <script> tag.
export default function BookCallModal({ onClose }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    function handleMessage(e) {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.from === 'chimeSite' && data.event === 'updateBodyRect' && iframeRef.current) {
        iframeRef.current.style.height = `${data.data.height}px`;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="book-call-overlay" onClick={onClose}>
      <div className="book-call-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="book-call-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <iframe
          ref={iframeRef}
          src={WIDGET_URL}
          title="Book a call"
          className="book-call-iframe"
          frameBorder="0"
        />
      </div>
    </div>
  );
}
