import { useEffect, useRef, useState } from 'react';
import PropertyCard from './PropertyCard.jsx';
import CompsTable from './CompsTable.jsx';
import BookCallModal from './BookCallModal.jsx';
import { detectCity } from '../utils/geolocation.js';

const OVERVIEW_QUESTION = 'Give me a quick overview of this property — current status, price, and key details.';
const AUTOCOMPLETE_MIN_LENGTH = 3;
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Turns the literal "privacy policy" phrase in the disclaimer into a real link.
function renderDisclaimer(text, url) {
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

// Mosaic wordmark: navy circle, coral angular "M" mark. Brand colors: #1d3c68 / #f1645f / white.
function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="14" fill="#1d3c68" />
      <path d="M7 20V9L13 15L14 14L20 9V20" stroke="#f1645f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function ChatBox({ user, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [address, setAddress] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [disclaimer, setDisclaimer] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [city, setCity] = useState('Kitchener');
  const [suggestions, setSuggestions] = useState([]);
  const [showBookCall, setShowBookCall] = useState(false);
  const logRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    fetch('/api/disclaimer')
      .then((res) => res.json())
      .then((data) => {
        setDisclaimer(data.disclaimer || '');
        setPrivacyUrl(data.privacyUrl || '');
      })
      .catch(() => {});
  }, []);

  // Optional — silently falls back to the default city on denial/error.
  useEffect(() => {
    detectCity().then(setCity);
  }, []);

  // Debounced address autocomplete, only relevant before a property is resolved.
  useEffect(() => {
    if (address || input.trim().length < AUTOCOMPLETE_MIN_LENGTH) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/autocomplete?partial=${encodeURIComponent(input.trim())}&city=${encodeURIComponent(city)}`)
        .then((res) => res.json())
        .then((data) => setSuggestions(data.suggestions || []))
        .catch(() => setSuggestions([]));
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [input, address, city]);

  async function sendMessage(text) {
    if (!text || sending) return;

    const isFirstTurn = !address;
    const userMessage = { id: crypto.randomUUID(), role: 'user', text };
    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    setSuggestions([]);
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    try {
      const { answer, subject, comps } = await postJson('/api/chat', {
        address: isFirstTurn ? text : address,
        question: isFirstTurn ? OVERVIEW_QUESTION : text,
        history,
      });

      if (isFirstTurn) setAddress(subject?.address || text);

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: answer, subject, comps },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: `Something went wrong: ${err.message}`, isError: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input.trim());
  }

  function handleSuggestionClick(suggestion) {
    sendMessage(suggestion);
  }

  function handleNewSearch() {
    setMessages([]);
    setAddress(null);
    setInput('');
    setSuggestions([]);
  }

  return (
    <div className="chatbox">
      <header className="chatbox-header">
        <div className="chatbox-header-brand">
          <Logo />
          <span>Mosaic Real Estate Intelligence</span>
        </div>
        <div className="chatbox-header-actions">
          <button type="button" className="book-call-btn" onClick={() => setShowBookCall(true)}>
            Book a call
          </button>
          {address && (
            <button type="button" className="new-search-btn" onClick={handleNewSearch}>
              New search
            </button>
          )}
          {user && (
            <span className="user-menu">
              <span className="user-email">{user.email}</span>
              <button type="button" className="logout-btn" onClick={onLogout}>Log out</button>
            </span>
          )}
        </div>
      </header>

      <div className="chatbox-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="chatbox-empty">
            Type a property address to get started — e.g. "123 Main Street, Kitchener"
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg-row ${m.role}`}>
            <div className={`msg-bubble ${m.role}${m.isError ? ' error' : ''}`}>
              {m.subject && <PropertyCard property={m.subject} />}
              {m.comps && <CompsTable comps={m.comps} />}
              <p className="msg-text">{m.text}</p>
            </div>
          </div>
        ))}

        {sending && (
          <div className="msg-row assistant">
            <div className="msg-bubble assistant typing">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        )}
      </div>

      <div className="chatbox-input-wrap">
        {suggestions.length > 0 && (
          <ul className="autocomplete-list">
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => handleSuggestionClick(s)}>{s}</button>
              </li>
            ))}
          </ul>
        )}
        <form className="chatbox-input-row" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={address ? 'Ask a follow-up question about this property…' : 'Enter a property address…'}
            disabled={sending}
            autoComplete="off"
          />
          <button type="submit" disabled={sending || !input.trim()}>
            Send
          </button>
        </form>
      </div>

      {disclaimer && <footer className="chatbox-disclaimer">{renderDisclaimer(disclaimer, privacyUrl)}</footer>}

      {showBookCall && <BookCallModal onClose={() => setShowBookCall(false)} />}
    </div>
  );
}
