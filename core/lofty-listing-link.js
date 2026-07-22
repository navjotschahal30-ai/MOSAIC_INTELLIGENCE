/**
 * Resolves MLS board listing numbers to their live navjotchahal.ca
 * listing-detail link via Lofty's own API — the same site the public IDX
 * pages are served from.
 *
 * Deliberately Active-listing only. Verified live against the real Lofty
 * account: GET /v1.0/listing?mlsListingIds=... returns an exact match for
 * active MLS numbers, but returns nothing at all for closed/sold MLS
 * numbers (Lofty's public site doesn't index sold data), and a plain
 * address-text search for a sold address can resolve to an unrelated
 * *different* listing (a re-list under a new MLS# with a different price/
 * status) rather than the sold record itself. So this module is only ever
 * called for "similar active listings" (routes/chat.js), never for sold
 * comparables — see legal-compliance.md.
 */

const LISTING_SEARCH_URL = 'https://api.lofty.com/v1.0/listing';

function sanitizeApiKey(rawKey) {
  // Strips anything outside printable ASCII before building the auth header —
  // a copy-pasted key can pick up an invisible Unicode line separator that
  // Node's fetch rejects outright since HTTP header values must be Latin-1.
  return (rawKey ?? '').replace(/[^\x20-\x7E]/g, '').trim();
}

function getLoftyHeaders() {
  return {
    Authorization: `token ${sanitizeApiKey(process.env.LOFTY_API_KEY)}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Builds a listing-detail page URL on the agent's site, e.g.
 * https://www.navjotchahal.ca/listing-detail/1176726529/269-Fairway-Rd-N-90-Kitchener-ON
 * The numeric ID is Lofty's own internal listingId — the trailing slug is
 * cosmetic (confirmed live: Lofty resolves the page off the ID alone).
 */
function buildListingDetailUrl(website, listing) {
  const slug = [listing.address, listing.city, listing.state]
    .filter(Boolean)
    .join(' ')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `https://www.${website}/listing-detail/${encodeURIComponent(listing.listingId)}/${slug}`;
}

/**
 * Batch-resolves MLS numbers (e.g. ["X12744264", "X11923996"]) to live
 * listing-detail URLs. Degrades to an empty map on any error or when Lofty
 * has no record for a given MLS# — callers should fall back to showing the
 * plain address, never a guessed/broken link.
 * @param {string[]} mlsListingIds
 * @returns {Promise<Map<string, string>>} MLS# -> live URL
 */
export async function resolveListingLinksByMls(mlsListingIds) {
  const links = new Map();
  const ids = (mlsListingIds || []).filter(Boolean);
  if (ids.length === 0) return links;

  const website = (process.env.AGENT_WEBSITE || 'navjotchahal.ca').trim();
  const url = `${LISTING_SEARCH_URL}?${new URLSearchParams({ mlsListingIds: ids.join(',') })}`;

  let data;
  try {
    const response = await fetch(url, { headers: getLoftyHeaders() });
    if (!response.ok) return links;
    data = await response.json();
  } catch {
    return links;
  }

  for (const listing of data?.listIng ?? []) {
    if (!listing.mlsListingId || links.has(listing.mlsListingId)) continue;
    links.set(listing.mlsListingId, buildListingDetailUrl(website, {
      listingId: listing.listingId,
      address: listing.listingStreetName,
      city: listing.listingCity,
      state: listing.listingState,
    }));
  }

  return links;
}
