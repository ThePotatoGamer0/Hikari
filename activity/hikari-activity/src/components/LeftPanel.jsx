import { useState, useEffect } from 'react';
import Icons from './Icons';

// Universal Metadata Sanitizer
const sanitizeMetadata = (rawTitle, rawAuthor) => {
  let author = rawAuthor || "Unknown";
  let title = rawTitle || "Unknown";

  author = author.replace(/^Official\s+/i, '').replace(/VEVO$/i, '').replace(/\s*-\s*Topic$/i, '').trim();
  title = title.replace(/[\[\(]?(Official|Audio|Lyric|Music Video|Visualizer|HD|HQ).*?([\]\)]|$)/gi, '')
               .replace(/\s+(ft\.|feat\.|featuring).*$/gi, '').trim();

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    const leftSide = parts[0].trim();
    const rightSide = parts.slice(1).join(' - ').trim();

    if (leftSide.toLowerCase().includes(author.toLowerCase()) || author.toLowerCase().includes(leftSide.toLowerCase())) {
      title = rightSide;
    } else {
      author = leftSide;
      title = rightSide;
    }
  }

  title = title.replace(/^[-~]\s*/, '').replace(/\s*[-~]$/, '').trim();
  return { cleanTitle: title, cleanAuthor: author };
};

export default function LeftPanel({ status, onAction, artUrl, isPip = false }) {
  const [localPos, setLocalPos] = useState(0);
  const [currentFilter, setCurrentFilter] = useState('clear');

  const track = status?.current_track;

  // Local seekbar tick
  useEffect(() => {
    if (!track || track.is_paused) return;
    setLocalPos(track.position);
    
    const ticker = setInterval(() => {
      setLocalPos((prev) => Math.min(prev + 1000, track.length));
    }, 1000);
    
    return () => clearInterval(ticker);
  }, [track]);

  // --- NEW: Interactive Seekbar Handler ---
  const handleSeek = (e) => {
    if (!track || track.length === 0) return; // Prevent seeking streams or empty tracks
    
    // Calculate the percentage clicked relative to the width of the seekbar
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    
    // Calculate exact millisecond target and optimistically update UI
    const targetPos = Math.floor(pct * track.length);
    setLocalPos(targetPos);
    
    // Send standard action out
    onAction('seek', { position: targetPos });
  };

  if (!track) {
    return (
      <div className={`left-panel empty ${isPip ? 'pip' : ''}`}>
        {Icons.MusicNote}
        {!isPip && (
          <>
            <h2>No music playing</h2>
            <p>Add a song to get started.</p>
          </>
        )}
      </div>
    );
  }

  const progressPct = track.length > 0 ? (localPos / track.length) * 100 : 0;

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const { cleanTitle, cleanAuthor } = sanitizeMetadata(track.title, track.author);

  return (
    <div className={`left-panel ${isPip ? 'pip' : ''}`}>
      <div className="album-art-container">
        {artUrl ? (
          <img src={artUrl} alt="Album Art" className="album-art" />
        ) : (
          <div className="album-art fallback">
            {Icons.MusicNote}
          </div>
        )}
      </div>
      
      {!isPip && (
        <div className="track-info">
          <h1 className="title">{cleanTitle}</h1>
          <h2 className="author">{cleanAuthor}</h2>
        </div>
      )}

      <div className="seekbar-container">
        {/* Pass the click handler directly to the container to track touches/clicks */}
        <div className="seekbar-bg" onClick={handleSeek}>
          <div className="seekbar-fill" style={{ width: `${progressPct}%` }}></div>
        </div>
        <div className="time-labels">
          <span>{formatTime(localPos)}</span>
          <span>{formatTime(track.length)}</span>
        </div>
      </div>

      {!isPip && (
        <>
          <div className="controls-row">
            <button 
              className={`control-btn ${status?.shuffle ? 'active' : ''}`} 
              onClick={() => onAction('shuffle')}
            >
              {Icons.Shuffle}
            </button>

            <button className="control-btn" onClick={() => onAction('stop')}>
              {Icons.Stop}
            </button>

            <button className="control-btn main-play" onClick={() => onAction('skip')}>
              {Icons.Skip}
            </button>

            <button 
              className={`control-btn ${status?.loop_mode !== 'off' ? 'active' : ''}`} 
              onClick={() => {
                const nextMode = status?.loop_mode === 'off' ? 'playlist' : status?.loop_mode === 'playlist' ? 'song' : 'off';
                onAction('loop', { mode: nextMode });
              }}
            >
              {status?.loop_mode === 'song' ? Icons.RepeatOne : Icons.Repeat}
            </button>

            <button 
              className={`control-btn ${status?.autoplay ? 'active' : ''}`} 
              onClick={() => onAction('autoplay')}
            >
              {Icons.Infinity}
            </button>
          </div>

          {/* NEW: Audio Filter Dropdown */}
          <div className="filter-container">
            <select 
              className="filter-select"
              value={currentFilter}
              onChange={(e) => {
                const newFilter = e.target.value;
                setCurrentFilter(newFilter);
                onAction('filter', { preset: newFilter });
              }}
            >
              <option value="clear">Audio: Normal</option>
              <option value="bassboost">Audio: Bass Boost</option>
              <option value="nightcore">Audio: Nightcore</option>
              <option value="8d">Audio: 8D Audio</option>
              <option value="vaporwave">Audio: Vaporwave</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}