// Turns the literal "privacy policy" phrase into a real link — same approach
// the short footer disclaimer already uses, reused here for the full text.
function renderWithPrivacyLink(text, url) {
  const marker = 'privacy policy';
  const idx = text.indexOf(marker);
  if (!url || idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <a href={url} target="_blank" rel="noopener noreferrer">{marker}</a>
      {text.slice(idx + marker.length)}
    </>
  );
}

export default function LegalModal({ legalText, privacyUrl, onClose }) {
  return (
    <div className="legal-overlay" onClick={onClose}>
      <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="legal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <h2 className="legal-title">Legal</h2>
        <p className="legal-text">{renderWithPrivacyLink(legalText, privacyUrl)}</p>
      </div>
    </div>
  );
}
