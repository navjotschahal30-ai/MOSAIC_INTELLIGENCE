function money(n) {
  return n != null ? `$${Number(n).toLocaleString('en-CA')}` : '—';
}

// Ampre's UnparsedAddress sometimes already includes city/province/postal — only
// append the separate city field when it isn't already part of the address string.
function fullAddress(property) {
  if (property.city && !property.address.includes(property.city)) {
    return `${property.address}, ${property.city}`;
  }
  return property.address;
}

export default function PropertyCard({ property }) {
  if (!property) return null;

  return (
    <div className="property-card">
      <div className="property-card-top">
        <div className="property-card-address">{fullAddress(property)}</div>
        {property.status && <span className="status-badge">{property.status}</span>}
      </div>

      <div className="property-card-price">
        {property.closePrice ? money(property.closePrice) : money(property.listPrice)}
        {property.closePrice && <span className="price-sub"> sold {property.closeDate}</span>}
      </div>

      <div className="property-card-stats">
        <span>{property.beds ?? '—'} bd</span>
        <span>{property.baths ?? '—'} ba</span>
        <span>{property.sqft ? `${property.sqft} sqft` : '— sqft'}</span>
        <span>{property.propertySubType || property.propertyType || '—'}</span>
      </div>
    </div>
  );
}
