function money(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : '—';
}

// Ampre's UnparsedAddress can include city/province/postal — show just the
// street segment here so the table stays compact inside a chat bubble.
function streetOnly(address) {
  return address.split(',')[0];
}

export default function CompsTable({ comps }) {
  if (!comps || comps.length === 0) return null;

  return (
    <div className="comps-wrap">
      <div className="comps-label">Sold Comparables</div>
      <div className="comps-scroll">
        <table className="comps-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Sold</th>
              <th>Pending/Sold</th>
              <th>Bd/Ba</th>
              <th>Sqft</th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.id}>
                <td>{streetOnly(c.address)}</td>
                <td>{money(c.closePrice)}</td>
                <td>{c.pendingDate || c.closeDate || '—'}</td>
                <td>{c.beds ?? '—'}/{c.baths ?? '—'}</td>
                <td>{c.sqft ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
