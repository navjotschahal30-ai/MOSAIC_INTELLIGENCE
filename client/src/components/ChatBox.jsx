import { useEffect, useRef, useState } from 'react';
import PropertyCard from './PropertyCard.jsx';
import CompsTable from './CompsTable.jsx';

const OVERVIEW_QUESTION = 'Give me a quick overview of this property — current status, price, and key details.';

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

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#0d1b33" />
      <path d="M14 6L22 12.5V22H17V16H11V22H6V12.5L14 6Z" fill="#d4af37" />
    </svg>
  );
}

export default function ChatBox() {
  const [messages, setMessages] = useState([]);
  const [address, setAddress] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [disclaimer, setDisclaimer] = useState('');
  const [privacyUrl, setPrivacyUrl] = useState('');
  const logRef = useRef(null);

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

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const isFirstTurn = !address;
    const userMessage = { id: crypto.randomUUID(), role: 'user', text };
    const history = messages.map((m) => ({ role: m.role, content: m.text }));

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

  function handleNewSearch() {
    setMessages([]);
    setAddress(null);
    setInput('');
  }

  return (
    <div className="chatbox">
      <header className="chatbox-header">
        <div className="chatbox-header-brand">
          <Logo />
          <span>Mosaic Real Estate Intelligence</span>
        </div>
        {address && (
          <button type="button" className="new-search-btn" onClick={handleNewSearch}>
            New search
          </button>
        )}
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

      <form className="chatbox-input-row" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={address ? 'Ask a follow-up question about this property…' : 'Enter a property address…'}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>

      {disclaimer && <footer className="chatbox-disclaimer">{renderDisclaimer(disclaimer, privacyUrl)}</footer>}
    </div>
  );
}
