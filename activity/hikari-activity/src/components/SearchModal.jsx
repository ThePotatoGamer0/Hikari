import { useState } from 'react';
import Icons from './Icons';

export default function SearchModal({ isOpen, onClose, onAction }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (type) => {
    if (!query.trim()) return;
    onAction(type, { query });
    setQuery('');
    onClose();
  };

  return (
    <div className={`search-modal ${isOpen ? 'open' : ''}`}>
      <div className="modal-header">
        <h3>Add to Queue</h3>
        <button className="close-btn" onClick={onClose}>{Icons.Close}</button>
      </div>
      
      <div className="modal-body">
        <input 
          type="text" 
          className="search-input" 
          placeholder="Paste URL or type search..." 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit('play')}
        />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => handleSubmit('playnext')}>Play Next</button>
          <button className="btn-primary" onClick={() => handleSubmit('play')}>Add to Queue</button>
        </div>
      </div>
    </div>
  );
}