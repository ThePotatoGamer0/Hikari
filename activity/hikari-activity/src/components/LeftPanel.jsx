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
  
  // NEW: State for the Three Dots menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);

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

  // Interactive Seekbar Handler
  const handleSeek = (e) => {
    if (!track || track.length === 0) return; // Prevent seeking streams or empty tracks
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    
    const targetPos = Math.floor(pct * track.length);
    setLocalPos(targetPos);
    
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
        <div className="seekbar-bg" onClick={handleSeek}>
          <div className="seekbar-fill" style={{ width: `${progressPct}%` }}></div>
        </div>
        <div className="time-labels">
          <span>{formatTime(localPos)}</span>
          <span>{formatTime(track.length)}</span>
        </div>
      </div>

      {!isPip && (
        <div className="controls-row">
          
          {/* 1. SHUFFLE */}
          <button 
            className={`control-btn ${status?.shuffle ? 'active' : ''}`} 
            onClick={() => onAction('shuffle')}
          >
            {Icons.Shuffle}
          </button>

          {/* 2. STOP */}
          <button className="control-btn" onClick={() => onAction('stop')}>
            {Icons.Stop}
          </button>

          {/* 3. PLAY/PAUSE (MAIN BUTTON) */}
          <button className="control-btn main-play" onClick={() => onAction('toggleplayback')}>
            {track.is_paused ? Icons.Play : Icons.Pause}
          </button>

          {/* 4. SKIP */}
          <button className="control-btn" onClick={() => onAction('skip')}>
            {Icons.Skip}
          </button>

          {/* 5. THREE DOTS MENU */}
          <div style={{ position: 'relative' }}>
            <button 
              className={`control-btn ${showMoreMenu ? 'active' : ''}`} 
              onClick={() => setShowMoreMenu(!showMoreMenu)}
            >
              {Icons.More}
            </button>

            {/* Submenu Dropdown */}
            {showMoreMenu && (
              <>
                {/* Invisible overlay to close menu when clicking outside */}
                <div 
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }} 
                  onClick={() => setShowMoreMenu(false)} 
                />
                
                {/* The Floating Menu */}
                <div style={{
                  position: 'absolute', 
                  bottom: 'calc(100% + 1rem)', 
                  right: '0',
                  background: 'rgba(20, 20, 20, 0.95)', 
                  backdropFilter: 'blur(25px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)', 
                  borderRadius: '12px',
                  padding: '1.2rem', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '1rem',
                  minWidth: '240px', 
                  zIndex: 50, 
                  boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
                }}>
                  
                  <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Playback Options
                  </div>

                  {/* Autoplay Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.95rem' }}>Autoplay</span>
                    <button className={`control-btn ${status?.autoplay ? 'active' : ''}`} onClick={() => onAction('autoplay')}>
                      {Icons.Infinity}
                    </button>
                  </div>

                  {/* Loop Toggle */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.95rem' }}>Loop</span>
                    <button className={`control-btn ${status?.loop_mode !== 'off' ? 'active' : ''}`} onClick={() => {
                      const nextMode = status?.loop_mode === 'off' ? 'playlist' : status?.loop_mode === 'playlist' ? 'song' : 'off';
                      onAction('loop', { mode: nextMode });
                    }}>
                      {status?.loop_mode === 'song' ? Icons.RepeatOne : Icons.Repeat}
                    </button>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.2rem 0' }} />

                  {/* Audio Filters */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.95rem' }}>Audio Filter</span>
                    <select 
                      className="filter-select"
                      value={currentFilter}
                      onChange={(e) => {
                        const newFilter = e.target.value;
                        setCurrentFilter(newFilter);
                        onAction('filter', { preset: newFilter });
                      }}
                      style={{ width: '100%', textAlign: 'left' }}
                    >
                      <option value="clear">Normal (Clear)</option>
                      <option value="bassboost">Bass Boost</option>
                      <option value="nightcore">Nightcore</option>
                      <option value="8d">8D Audio</option>
                      <option value="vaporwave">Vaporwave</option>
                    </select>
                  </div>

                </div>
              </>
            )}
          </div>

        </div>
      )}
    </div>
  );
}