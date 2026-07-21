function money(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : '—';
}

function streetOnly(address) {
  return address.split(',')[0];
}

// Unlike CompsTable (sold data, plain text address — see routes/chat.js),
// these are currently-for-sale listings with a real live navjotchahal.ca
// link resolved via Lofty, so the address renders as a clickable link.
export default function SimilarListings({ listings }) {
  if (!listings || listings.length === 0) return null;

  return (
    <div className="similar-listings-wrap">
      <div className="similar-listings-label">Similar Listings For Sale</div>
      <div className="similar-listings-cards">
        {listings.map((l) => (
          <div className="similar-listing-card" key={l.id}>
            {l.url ? (
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="similar-listing-address">
                {streetOnly(l.address)}
              </a>
            ) : (
              <span className="similar-listing-address">{streetOnly(l.address)}</span>
            )}
            <div className="similar-listing-price">{money(l.listPrice)}</div>
            <div className="similar-listing-stats">
              {l.beds ?? '—'} bd / {l.baths ?? '—'} ba{l.sqft ? ` · ${l.sqft} sqft` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
