// activity/hikari-activity/src/components/RightPanel.jsx
import { useState, useEffect, useRef } from 'react';
import Icons from './Icons';
import ContextMenu from './ContextMenu';
import TrackRow from './TrackRow';

const ContextIcons = {
  Copy: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
  External: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
};

export default function RightPanel({ 
  status, 
  onAction, 
  openInfoModal, 
  guildId, 
  userFavorites = [], 
  onFavoriteToggle,
  currentUser 
}) {
  const [activeTab, setActiveTab] = useState('queue');
  const [queueSearch, setQueueSearch] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  
  // Lyrics Engine State
  const [lyricsData, setLyricsData] = useState([]);
  const [lyricsStatus, setLyricsStatus] = useState("Loading...");
  const [localPos, setLocalPos] = useState(0);
  const [lyricOffset, setLyricOffset] = useState(0);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  // Search Engine State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState('');

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
        const query = encodeURIComponent(`${track.title} ${track.author}`);
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
        setLyricsStatus("Failed to load lyrics.");
      }
    };
    fetchSyncedLyrics();
  }, [activeTab, track?.title]);

  // Automated Lavalink Recommendation Engine Effect
  useEffect(() => {
    if (activeTab !== 'search') return;
    
    if (searchQuery.trim() !== '') {
      const delayDebounce = setTimeout(() => {
        executeSearch(`${searchQuery}`);
      }, 600);
      return () => clearTimeout(delayDebounce);
    }

    // Default Fallback State (Lavalink Automated Suggestions)
    if (!track) {
      setSearchResults([]);
      setSearchStatus("Search for a track or play something to see suggestions.");
      return;
    }

    if (track.uri?.includes('soundcloud.com')) {
      setSearchResults([]);
      setSearchStatus("ℹ️ Cannot get related songs from a SoundCloud track.");
      return;
    }

    const fetchLavalinkRecommendations = async () => {
      setSearchStatus("Loading smart recommendations...");
      try {
        const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
        const res = await fetch(`/api/search?q=ytrec:${ytVideoId}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.data || data.tracks || []);
          setSearchStatus("");
        } else {
          setSearchStatus("Failed to pull automated suggestions.");
        }
      } catch (e) {
        setSearchStatus("Failed to query recommendation gateway.");
      }
    };
    fetchLavalinkRecommendations();
  }, [activeTab, searchQuery, track?.uri]);

  const executeSearch = async (formattedQuery) => {
    setSearchStatus("Searching audio network...");
    try {
      // Platform-agnostic layout lookup helper
      const res = await fetch(`/api/search?q=ytsearch:${encodeURIComponent(formattedQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.data || data.tracks || []);
        setSearchStatus("");
      } else {
        setSearchStatus("Search network failed.");
      }
    } catch (e) {
      setSearchStatus("Failed to execute search payload.");
    }
  };

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

  const handleContextMenu = (e, trackData) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, track: trackData });
  };

  const adjustedPos = localPos + (lyricOffset * 1000);
  const rawQueue = status?.queue || [];
  const queueWithIndexes = rawQueue.map((t, index) => ({ ...t, originalIndex: index + 1 }));
  const filteredQueue = queueWithIndexes.filter(queueTrack => {
    if (!queueSearch) return true;
    return queueTrack.title?.toLowerCase().includes(queueSearch.toLowerCase()) || queueTrack.author?.toLowerCase().includes(queueSearch.toLowerCase());
  });

  return (
    <div className="right-panel">
      <div className="tabs-header" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', display: 'grid' }}>
        <button className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => setActiveTab('queue')}>Up Next</button>
        <button className={`tab-btn ${activeTab === 'lyrics' ? 'active' : ''}`} onClick={() => setActiveTab('lyrics')}>Lyrics</button>
        <button className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>Search</button>
        <button className={`tab-btn ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>Library</button>
      </div>

      <div 
        className="tab-content" ref={scrollRef}
        onWheel={handleUserInteraction} onTouchMove={handleUserInteraction} onMouseDown={handleUserInteraction}
      >
        {/* TAB 1: LIVE QUEUE */}
        {activeTab === 'queue' && (
          <div className="queue-tab-wrapper">
            {rawQueue.length > 0 && (
              <div className="queue-search-wrapper">
                <input 
                  type="text" className="queue-search-input" placeholder="Filter queue..."
                  value={queueSearch} onChange={(e) => setQueueSearch(e.target.value)}
                />
              </div>
            )}
            <div className="queue-list">
              {rawQueue.length === 0 ? (
                <div className="empty-state">Queue is empty</div>
              ) : filteredQueue.length === 0 ? (
                <div className="empty-state">No matching tracks found</div>
              ) : (
                filteredQueue.map((queueTrack) => (
                  <TrackRow 
                    key={queueTrack.uid}
                    track={queueTrack}
                    context="queue"
                    onAction={onAction}
                    isFavorited={userFavorites.some(f => f.lavalink_identifier === (queueTrack.lavalink_identifier || queueTrack.identifier || queueTrack.uri))}
                    onFavoriteToggle={onFavoriteToggle}
                    openInfoModal={openInfoModal}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LYRICS */}
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
                <p key={i} className={`lyric-line ${isActive ? 'active' : ''} ${isPast && !isActive ? 'passed' : ''}`}>
                  {line.text}
                </p>
              );
            })}
          </div>
        )}

        {/* TAB 3: CONSOLIDATED EXCLUSIVE SEARCH */}
        {activeTab === 'search' && (
          <div className="queue-tab-wrapper">
            <div className="queue-search-wrapper">
              <input 
                type="text" className="queue-search-input" placeholder="Search title or query..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="queue-list" style={{ marginTop: '0.5rem' }}>
              {searchStatus && <div className="empty-state" style={{ fontSize: '0.85rem', color: '#b5bac1', padding: '1rem' }}>{searchStatus}</div>}
              {searchResults.map((searchTrack, i) => (
                <TrackRow 
                  key={i}
                  track={{
                    title: searchTrack.info?.title || searchTrack.title,
                    author: searchTrack.info?.author || searchTrack.author,
                    uri: searchTrack.info?.uri || searchTrack.uri,
                    identifier: searchTrack.info?.identifier || searchTrack.identifier
                  }}
                  context="search"
                  onAction={onAction}
                  isFavorited={userFavorites.some(f => f.lavalink_identifier === (searchTrack.info?.identifier || searchTrack.identifier || searchTrack.info?.uri || searchTrack.uri))}
                  onFavoriteToggle={onFavoriteToggle}
                  openInfoModal={openInfoModal}
                />
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: PERSONAL FAVORITES POOL */}
        {activeTab === 'favorites' && (
          <div className="queue-tab-wrapper">
            <div style={{ padding: '0 0.5rem 0.5rem 0.5rem' }}>
              <button 
                onClick={() => onAction('favadd')}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: '#23a55a', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <i className="fa-solid fa-shuffle"></i> Deploy Favorites Pool
              </button>
            </div>
            <div className="queue-list">
              {userFavorites.length === 0 ? (
                <div className="empty-state">Your personal library is empty. Star songs in the player to build your library.</div>
              ) : (
                userFavorites.map((favTrack) => (
                  <TrackRow 
                    key={favTrack.track_id || favTrack.lavalink_identifier}
                    track={{
                      title: favTrack.title,
                      author: favTrack.author,
                      uri: favTrack.uri,
                      lavalink_identifier: favTrack.lavalink_identifier
                    }}
                    context="favorites"
                    onAction={onAction}
                    isFavorited={true}
                    onFavoriteToggle={onFavoriteToggle}
                    openInfoModal={openInfoModal}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {activeTab === 'lyrics' && !isAutoScroll && lyricsData.length > 0 && (
        <button className="resume-sync-btn" onClick={() => setIsAutoScroll(true)}>Resume Sync</button>
      )}

      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}
          options={[
            {
              label: "Copy Link", icon: ContextIcons.Copy,
              onClick: () => navigator.clipboard.writeText(contextMenu.track.uri)
            },
            {
              label: "Open in Browser", icon: ContextIcons.External,
              onClick: () => window.open(contextMenu.track.uri, '_blank')
            },
            {
              label: "Remove Track", icon: Icons.Trash, danger: true,
              onClick: () => onAction('remove', { uid: contextMenu.track.uid })
            }
          ]}
        />
      )}
    </div>
  );
}