import { useState, useEffect, useRef } from 'react';
import Icons from './Icons';
import ContextMenu from './ContextMenu';

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

// Inline SVGs for the new Context Menu options
const ContextIcons = {
  Copy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
  External: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
};

export default function RightPanel({ status, onAction, openModal, guildId }) {
  const [activeTab, setActiveTab] = useState('queue');
  const [queueSearch, setQueueSearch] = useState('');
  
  // NEW: Context Menu State
  const [contextMenu, setContextMenu] = useState(null);
  
  const [lyricsData, setLyricsData] = useState([]);
  const [lyricsStatus, setLyricsStatus] = useState("Loading...");
  const [localPos, setLocalPos] = useState(0);
  const [lyricOffset, setLyricOffset] = useState(0);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  
  const scrollRef = useRef(null);
  const track = status?.current_track;

  useEffect(() => {
    if (!track || track.is_paused || activeTab !== 'lyrics') return;
    setLocalPos(track.position);
    const ticker = setInterval(() => {
      setLocalPos((prev) => Math.min(prev + 100, track.length));
    }, 100);
    return () => clearInterval(ticker);
  }, [track, activeTab]);

  useEffect(() => {
    if (activeTab !== 'lyrics' || !track) return;

    const fetchSyncedLyrics = async () => {
      setLyricsStatus("Searching LRClib...");
      setLyricsData([]);
      setIsAutoScroll(true);
      setLyricOffset(0);
      
      try {
        const { cleanTitle, cleanAuthor } = sanitizeMetadata(track.title, track.author);
        const query = encodeURIComponent(`${cleanTitle} ${cleanAuthor}`);
        
        const res = await fetch(`/lrclib/api/search?q=${query}`);
        if (!res.ok) throw new Error("API Error");
        
        const data = await res.json();
        const bestMatch = data.find(song => song.syncedLyrics);

        if (bestMatch) {
          const parsed = bestMatch.syncedLyrics.split('\n').map(line => {
            const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
            if (match) {
              const minutes = parseInt(match[1], 10);
              const seconds = parseInt(match[2], 10);
              const ms = parseInt(match[3].padEnd(3, '0'), 10);
              const time = (minutes * 60 * 1000) + (seconds * 1000) + ms;
              return { time, text: match[4].trim() || '♪' };
            }
            return null;
          }).filter(l => l !== null);

          setLyricsData(parsed);
          setLyricsStatus("");
        } else {
          setLyricsStatus("No synced lyrics found for this track.");
        }
      } catch (err) {
        console.error("Lyrics fetch failed", err);
        setLyricsStatus("Failed to load lyrics.");
      }
    };

    fetchSyncedLyrics();
  }, [activeTab, track?.title]);

  useEffect(() => {
    if (activeTab === 'lyrics' && scrollRef.current && isAutoScroll) {
      const activeElement = scrollRef.current.querySelector('.lyric-line.active');
      const container = scrollRef.current;
      
      if (activeElement && container) {
        const targetScroll = activeElement.offsetTop - (container.offsetHeight / 2) + (activeElement.offsetHeight / 2);
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  }, [localPos, activeTab, isAutoScroll, lyricOffset]);

  const handleUserInteraction = () => {
    if (isAutoScroll) setIsAutoScroll(false);
  };

  // --- NEW: Handle Right Clicks ---
  const handleContextMenu = (e, trackData) => {
    e.preventDefault(); // Stop standard browser menu
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track: trackData
    });
  };

  const adjustedPos = localPos + (lyricOffset * 1000);

  const rawQueue = status?.queue || [];
  const queueWithIndexes = rawQueue.map((t, index) => ({ ...t, originalIndex: index + 1 }));
  
  const filteredQueue = queueWithIndexes.filter(queueTrack => {
    if (!queueSearch) return true;
    const { cleanTitle, cleanAuthor } = sanitizeMetadata(queueTrack.title, queueTrack.author);
    const query = queueSearch.toLowerCase();
    return cleanTitle.toLowerCase().includes(query) || cleanAuthor.toLowerCase().includes(query);
  });

  return (
    <div className="right-panel">
      <div className="tabs-header">
        <button 
          className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`} 
          onClick={() => setActiveTab('queue')}
        >
          Up Next
        </button>
        <button 
          className={`tab-btn ${activeTab === 'lyrics' ? 'active' : ''}`} 
          onClick={() => setActiveTab('lyrics')}
        >
          Lyrics
        </button>
      </div>

      <div 
        className="tab-content" 
        ref={scrollRef}
        onWheel={handleUserInteraction}
        onTouchMove={handleUserInteraction}
        onMouseDown={handleUserInteraction}
      >
        {activeTab === 'queue' && (
          <div className="queue-tab-wrapper">
            
            {rawQueue.length > 0 && (
              <div className="queue-search-wrapper">
                <input 
                  type="text"
                  className="queue-search-input"
                  placeholder="Filter queue..."
                  value={queueSearch}
                  onChange={(e) => setQueueSearch(e.target.value)}
                />
              </div>
            )}

            <div className="queue-list">
              {rawQueue.length === 0 ? (
                <div className="empty-state">Queue is empty</div>
              ) : filteredQueue.length === 0 ? (
                <div className="empty-state">No matching songs found</div>
              ) : (
                filteredQueue.map((queueTrack) => {
                  const { cleanTitle, cleanAuthor } = sanitizeMetadata(queueTrack.title, queueTrack.author);
                  
                  return (
                    <div 
                      key={queueTrack.uid} 
                      className="queue-item"
                      // NEW: Attach right click listener
                      onContextMenu={(e) => handleContextMenu(e, queueTrack)}
                    >
                      <span className="queue-index">{queueTrack.originalIndex}</span>
                      <div className="queue-meta">
                        <span className="queue-title">{cleanTitle}</span>
                        <span className="queue-author">{cleanAuthor}</span>
                      </div>
                      <div className="queue-actions">
                        <span className="queue-requester">{queueTrack.requester.split('#')[0]}</span>
                        <button className="remove-btn" onClick={() => onAction('remove', { uid: queueTrack.uid })}>
                          {Icons.Trash}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ... lyrics tab mapping remains the same ... */}
        {activeTab === 'lyrics' && (
          <div className="synced-lyrics-container">
            {lyricsStatus && <div className="empty-state">{lyricsStatus}</div>}
            
            {lyricsData.length > 0 && (
              <div className="lyrics-offset-controls">
                <button onClick={() => setLyricOffset(prev => prev + 1)}>▲</button>
                <span>{lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}s</span>
                <button onClick={() => setLyricOffset(prev => prev - 1)}>▼</button>
              </div>
            )}
            
            {lyricsData.map((line, i) => {
              const isPast = adjustedPos >= line.time;
              const isBeforeNext = !lyricsData[i + 1] || adjustedPos < lyricsData[i + 1].time;
              const isActive = isPast && isBeforeNext;

              return (
                <p 
                  key={i} 
                  className={`lyric-line ${isActive ? 'active' : ''} ${isPast && !isActive ? 'passed' : ''}`}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {activeTab === 'queue' && (
        <button className="fab-add" onClick={openModal}>
          {Icons.Plus}
        </button>
      )}

      {activeTab === 'lyrics' && !isAutoScroll && lyricsData.length > 0 && (
        <button 
          className="resume-sync-btn" 
          onClick={() => setIsAutoScroll(true)}
        >
          Resume Sync
        </button>
      )}

      {/* --- NEW: Context Menu Render --- */}
      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          options={[
            {
              label: "Copy Link",
              icon: ContextIcons.Copy,
              onClick: () => navigator.clipboard.writeText(contextMenu.track.uri)
            },
            {
              label: "Open in Browser",
              icon: ContextIcons.External,
              onClick: () => window.open(contextMenu.track.uri, '_blank')
            },
            {
              label: "Remove Track",
              icon: Icons.Trash,
              danger: true,
              onClick: () => onAction('remove', { uid: contextMenu.track.uid })
            }
          ]}
        />
      )}
    </div>
  );
}