import { useState, useEffect, useRef } from 'react';
import Icons from './Icons';

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
        const cleanTitle = track.title.replace(/(\(Official.*\)|\(Lyric.*\)|\(Music Video\)|ft\..*)/gi, '').trim();
        const query = encodeURIComponent(`${cleanTitle} ${track.author}`);
        
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

  // 3. FIXED: Isolated Auto-scroll logic
  useEffect(() => {
    if (activeTab === 'lyrics' && scrollRef.current && isAutoScroll) {
      const activeElement = scrollRef.current.querySelector('.lyric-line.active');
      const container = scrollRef.current;
      
      if (activeElement && container) {
        // Calculate exact center relative to the scroll container ONLY
        const targetScroll = activeElement.offsetTop - (container.offsetHeight / 2) + (activeElement.offsetHeight / 2);
        
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }
  }, [localPos, activeTab, isAutoScroll, lyricOffset]);

  // Disable auto-scroll if the user manually interacts with the lyric container
  const handleUserInteraction = () => {
    if (isAutoScroll) setIsAutoScroll(false);
  };

  // Adjusted time includes the user's manual offset (in milliseconds)
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
              status.queue.map((track, i) => (
                <div key={track.uid} className="queue-item">
                  <span className="queue-index">{i + 1}</span>
                  <div className="queue-meta">
                    <span className="queue-title">{track.title}</span>
                    <span className="queue-author">{track.author}</span>
                  </div>
                  <div className="queue-actions">
                    <span className="queue-requester">{track.requester.split('#')[0]}</span>
                    <button className="remove-btn" onClick={() => onAction('remove', { uid: track.uid })}>
                      {Icons.Trash}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'lyrics' && (
          <div className="synced-lyrics-container">
            {lyricsStatus && <div className="empty-state">{lyricsStatus}</div>}
            
            {/* Offset Controls */}
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

      {/* Resume Sync Button */}
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