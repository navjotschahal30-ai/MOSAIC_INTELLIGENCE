import { useState } from 'react';

export default function SearchForm({ onSearch, loading }) {
  const [address, setAddress] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (address.trim()) onSearch(address.trim());
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Enter a property address (e.g. 123 Main Street, Kitchener)"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <button type="submit" disabled={loading || !address.trim()}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
