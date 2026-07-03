// Best-effort city detection via browser geolocation + reverse geocoding.
// Fully optional: resolves to the default city on denial, timeout, missing
// browser support, or any network error — never blocks or throws.

const DEFAULT_CITY = 'Kitchener';

function getPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null), // permission denied, unavailable, or timed out
      { timeout: 5000, maximumAge: 300000 },
    );
  });
}

/** @returns {Promise<string>} the detected city, or "Kitchener" as a fallback. */
export async function detectCity() {
  const position = await getPosition();
  if (!position) return DEFAULT_CITY;

  try {
    const { latitude, longitude } = position.coords;
    const res = await fetch(`/api/geocode/reverse?lat=${latitude}&lon=${longitude}`);
    const data = await res.json();
    return data.city || DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}
