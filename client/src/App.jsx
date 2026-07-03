import { useState } from 'react';
import SearchForm from './components/SearchForm.jsx';
import PropertyResults from './components/PropertyResults.jsx';
import Chat from './components/Chat.jsx';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function App() {
  const [address, setAddress] = useState(null);
  const [property, setProperty] = useState(null);
  const [comps, setComps] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingComps, setLoadingComps] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch(searchAddress) {
    setError(null);
    setLoadingSearch(true);
    setProperty(null);
    setComps([]);
    setAddress(searchAddress);

    try {
      const { property: found } = await postJson('/api/property-search', { address: searchAddress });
      setProperty(found);
    } catch (err) {
      setError(err.message);
      setLoadingSearch(false);
      return;
    }
    setLoadingSearch(false);

    setLoadingComps(true);
    try {
      const { comps: found } = await postJson('/api/comps', { address: searchAddress });
      setComps(found);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingComps(false);
    }
  }

  async function handleAsk(question, history) {
    const { answer } = await postJson('/api/chat', {
      address,
      question,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    });
    return answer;
  }

  return (
    <div className="app">
      <header>
        <h1>Mosaic Real Estate Intelligence</h1>
        <p className="tagline">Team MOSAIC · eXp Realty</p>
      </header>

      <SearchForm onSearch={handleSearch} loading={loadingSearch} />

      {error && <div className="error">{error}</div>}

      {property && (
        <>
          <PropertyResults property={property} comps={comps} loadingComps={loadingComps} />
          <Chat address={address} disabled={!property} onAsk={handleAsk} />
        </>
      )}
    </div>
  );
}
