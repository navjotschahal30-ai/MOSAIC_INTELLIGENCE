function money(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : '—';
}

export default function PropertyResults({ property, comps, loadingComps }) {
  if (!property) return null;

  return (
    <div className="results">
      <div className="subject-card">
        <h2>{property.address}{property.city ? `, ${property.city}` : ''}</h2>
        <div className="badge">{property.status || 'Unknown status'}</div>
        <div className="stat-row">
          <span>{money(property.listPrice)}</span>
          <span>{property.beds ?? '—'} bd</span>
          <span>{property.baths ?? '—'} ba</span>
          <span>{property.sqft ?? '—'} sqft</span>
          <span>{property.propertySubType || property.propertyType || '—'}</span>
        </div>
        {property.remarks && <p className="remarks">{property.remarks}</p>}
      </div>

      <div className="comps-section">
        <h3>Sold Comparables {loadingComps && <span className="loading-tag">loading…</span>}</h3>
        {!loadingComps && comps?.length === 0 && <p className="empty">No sold comparables found nearby.</p>}
        {comps?.length > 0 && (
          <table className="comps-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Sold Price</th>
                <th>Closed</th>
                <th>Bd/Ba</th>
                <th>Sqft</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c.id}>
                  <td>{c.address}{c.city ? `, ${c.city}` : ''}</td>
                  <td>{money(c.closePrice)}</td>
                  <td>{c.closeDate || '—'}</td>
                  <td>{c.beds ?? '—'}/{c.baths ?? '—'}</td>
                  <td>{c.sqft ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
