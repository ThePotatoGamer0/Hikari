import { useState, useEffect } from 'react';
import Icons from './Icons';
import ContextMenu from './ContextMenu';

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

// Inline SVGs for the Context Menu
const ContextIcons = {
  Copy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
  Image: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
};

// Translates internal proxy URLs back to their true public source
const getTrueUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/yt-img/')) return url.replace('/yt-img/', 'https://img.youtube.com/');
  if (url.startsWith('/sc-img/')) return url.replace('/sc-img/', 'https://i1.sndcdn.com/');
  return url;
};

// Bypasses CORS by rendering the proxied image to a canvas, then copying as a raw PNG
const copyImageToClipboard = async (url) => {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous"; 
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new window.ClipboardItem({ 'image/png': blob })
          ]);
        } catch (err) {
          console.error("Clipboard write failed", err);
        }
      }, 'image/png');
    };
  } catch (err) {
    console.error("Image fetch failed", err);
  }
};

export default function LeftPanel({ status, onAction, artUrl, artComponent, isPip = false }) {
  const [localPos, setLocalPos] = useState(0);
  const [currentFilter, setCurrentFilter] = useState('clear');
  const [contextMenu, setContextMenu] = useState(null);

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
    if (!track || track.length === 0) return; 
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    
    const targetPos = Math.floor(pct * track.length);
    setLocalPos(targetPos);
    
    onAction('seek', { position: targetPos });
  };

  // Right-Click Handler for Album Art
  const handleContextMenu = (e) => {
    if (!artUrl) return; // Prevent menu if there's no artwork loaded
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY
    });
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
      <div 
        className="album-art-container"
        onContextMenu={handleContextMenu}
        style={{ cursor: artUrl ? 'context-menu' : 'default' }}
      >
        {artComponent ? (
          artComponent
        ) : artUrl ? (
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

      {/* --- Context Menu Render --- */}
      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          options={[
            {
              label: "Copy Image",
              icon: ContextIcons.Image,
              // We pass the internal proxied URL here so the canvas can bypass CORS
              onClick: () => copyImageToClipboard(artUrl) 
            },
            {
              label: "Copy Image URL",
              icon: ContextIcons.Copy,
              // We pass the true public URL to the user's clipboard
              onClick: () => navigator.clipboard.writeText(getTrueUrl(artUrl)) 
            }
          ]}
        />
      )}
    </div>
  );
}