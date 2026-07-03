import { useEffect, useState } from 'react';
import ChatBox from './components/ChatBox.jsx';
import AuthForm from './components/AuthForm.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  }

  if (checkingSession) return null;

  if (!user) return <AuthForm onAuthenticated={setUser} />;

  return <ChatBox user={user} onLogout={handleLogout} />;
}
