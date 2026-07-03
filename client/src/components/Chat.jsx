import { useState } from 'react';

export default function Chat({ address, disabled, onAsk }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [asking, setAsking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;

    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setQuestion('');
    setAsking(true);

    try {
      const answer = await onAsk(q, messages);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="chat">
      <h3>Ask about {address}</h3>
      <div className="chat-log">
        {messages.length === 0 && <p className="empty">Ask about pricing, comps, or property details.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <span className="chat-role">{m.role === 'user' ? 'You' : 'Mosaic'}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {asking && <div className="chat-msg assistant"><span className="chat-role">Mosaic</span><p>Thinking…</p></div>}
      </div>
      <form onSubmit={handleSubmit} className="chat-form">
        <input
          type="text"
          placeholder="Is this priced fairly compared to recent sales?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={disabled || asking}
        />
        <button type="submit" disabled={disabled || asking || !question.trim()}>Ask</button>
      </form>
    </div>
  );
}
