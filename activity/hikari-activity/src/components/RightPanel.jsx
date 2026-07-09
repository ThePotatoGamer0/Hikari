import { useState, useEffect, useRef } from 'react';
import Icons from './Icons';

// --- UPDATED: Universal Metadata Sanitizer ---
const sanitizeMetadata = (rawTitle, rawAuthor) => {
  let author = rawAuthor || "Unknown";
  let title = rawTitle || "Unknown";

  // 1. Clean the Author name (Remove 'Official', 'VEVO', '- Topic')
  author = author
    .replace(/^Official\s+/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*-\s*Topic$/i, '')
    .trim();

  // 2. Clean the Title (Remove bracketed fluff, and 'ft. ...')
  title = title
    .replace(/[\[\(]?(Official|Audio|Lyric|Music Video|Visualizer|HD|HQ).*?([\]\)]|$)/gi, '')
    .replace(/\s+(ft\.|feat\.|featuring).*$/gi, '')
    .trim();

  // 3. The Re-uploader Fix: Handle "Artist - Title" format
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    const leftSide = parts[0].trim();
    const rightSide = parts.slice(1).join(' - ').trim();

    // If the uploader's channel name matches the left side, they are the real artist.
    if (leftSide.toLowerCase().includes(author.toLowerCase()) || author.toLowerCase().includes(leftSide.toLowerCase())) {
      title = rightSide;
    } 
    // If they don't match, the uploader is likely a random channel, and the left side is the true artist.
    else {
      author = leftSide;
      title = rightSide;
    }
  }

  // 4. Final trim of leftover dashes or spaces
  title = title.replace(/^[-~]\s*/, '').replace(/\s*[-~]$/, '').trim();

  return { cleanTitle: title, cleanAuthor: author };
};

export default function RightPanel({ status, onAction, openModal, guildId }) {
  const [activeTab, setActiveTab] = useState('queue');
  
  // Lyrics State
  const [lyricsData, setLyricsData] = useState([]);
  const [lyricsStatus, setLyricsStatus] = useState("Loading...");
  const [localPos, setLocalPos] = useState(0);
  
  // Offset state
  const [lyricOffset, setLyricOffset] = useState(0);
  
  // Scroll lock state
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  
  const scrollRef = useRef(null);
  const track = status?.current_track;

  // 1. Keep track of the current song time
  useEffect(() => {
    if (!track || track.is_paused || activeTab !== 'lyrics') return;
    setLocalPos(track.position);
    
    const ticker = setInterval(() => {
      setLocalPos((prev) => Math.min(prev + 100, track.length));
    }, 100);
    
    return () => clearInterval(ticker);
  }, [track, activeTab]);

  // 2. Fetch and Parse LRClib data
  useEffect(() => {
    if (activeTab !== 'lyrics' || !track) return;

    const fetchSyncedLyrics = async () => {
      setLyricsStatus("Searching LRClib...");
      setLyricsData([]);
      setIsAutoScroll(true);
      setLyricOffset(0);
      
      try {
        // Use our new sanitizer so LRClib gets a crystal clear search query!
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

  // 3. Isolated Auto-scroll logic
  useEffect(() => {
    if (activeTab === 'lyrics' && scrollRef.current && isAutoScroll) {
      const activeElement = scrollRef.current.querySelector('.lyric-line.active');
      const container = scrollRef.current;
      
      if (activeElement && container) {
        const targetScroll = activeElement.offsetTop - (container.offsetHeight / 2) + (activeElement.offsetHeight / 2);
        
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }
  }, [localPos, activeTab, isAutoScroll, lyricOffset]);

  const handleUserInteraction = () => {
    if (isAutoScroll) setIsAutoScroll(false);
  };

  const adjustedPos = localPos + (lyricOffset * 1000);

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
          <div className="queue-list">
            {(status?.queue || []).length === 0 ? (
              <div className="empty-state">Queue is empty</div>
            ) : (
              status.queue.map((queueTrack, i) => {
                // Sanitize every track in the queue!
                const { cleanTitle, cleanAuthor } = sanitizeMetadata(queueTrack.title, queueTrack.author);
                
                return (
                  <div key={queueTrack.uid} className="queue-item">
                    <span className="queue-index">{i + 1}</span>
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
        )}

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
    </div>
  );
}