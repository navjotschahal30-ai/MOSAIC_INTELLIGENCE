import { useState } from 'react';

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

export default function AuthForm({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState('external_agent');
  const [companyName, setCompanyName] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && !privacyAgreed) {
      setError('You must accept the privacy policy to register.');
      return;
    }

    setSubmitting(true);
    try {
      const { user } = mode === 'register'
        ? await postJson('/api/auth/register', { email, password, userType, privacyAgreed, companyName })
        : await postJson('/api/auth/login', { email, password });
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Mosaic Real Estate Intelligence</h1>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>

          {mode === 'register' && (
            <>
              <label>
                Account type
                <select value={userType} onChange={(e) => setUserType(e.target.value)}>
                  <option value="external_agent">External Agent</option>
                  <option value="team_mosaic">Team Mosaic</option>
                </select>
              </label>

              <label>
                Company name (optional)
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </label>

              <label className="auth-checkbox">
                <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <a href="https://navjotchahal.ca/privacy" target="_blank" rel="noopener noreferrer">privacy policy and terms</a>
                </span>
              </label>
            </>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
