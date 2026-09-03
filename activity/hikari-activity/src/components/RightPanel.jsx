import { useState, useEffect, useRef } from 'react';
import '@braccato/core';
import { detectParser } from '@braccato/parsers';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  TouchSensor
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import Icons from './Icons';
import TrackRow from './TrackRow';
import ConfirmModal from './ConfirmModal';

export default function RightPanel({ 
  status, 
  onAction, 
  openInfoModal, 
  guildId, 
  userFavorites = [], 
  onFavoriteToggle,
  currentUser,
  onOpenAbout
}) {
  const [activeTab, setActiveTab] = useState('queue');
  const [queueSearch, setQueueSearch] = useState('');
  
  const [isClearQueueOpen, setIsClearQueueOpen] = useState(false);
  
  const [lyricsData, setLyricsData] = useState([]);
  const [lyricsStatus, setLyricsStatus] = useState("Loading...");
  const [lyricOffset, setLyricOffset] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState('');

  const [localQueue, setLocalQueue] = useState([]);
  const [activeDragId, setActiveDragId] = useState(null);
  
  const syncLock = useRef(null); 
  const lyricsRef = useRef(null);
  const animationRef = useRef(null);
  const lastSyncTime = useRef(Date.now());
  const track = status?.current_track;

  useEffect(() => {
    const lengthMismatch = status?.queue?.length !== localQueue.length;

    if (!activeDragId && (!syncLock.current || lengthMismatch)) {
      if (syncLock.current && lengthMismatch) {
        clearTimeout(syncLock.current);
        syncLock.current = null;
      }
      const rawQueue = status?.queue || [];
      setLocalQueue(rawQueue.map((t, index) => ({ ...t, originalIndex: index + 1 })));
    }
  }, [status?.queue, activeDragId, localQueue.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, 
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 }, 
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event) => {
    setActiveDragId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (over && active.id !== over.id) {
      const oldIndex = localQueue.findIndex((item) => item.uid === active.id);
      const newIndex = localQueue.findIndex((item) => item.uid === over.id);

      setLocalQueue((items) => arrayMove(items, oldIndex, newIndex));
      
      if (syncLock.current) clearTimeout(syncLock.current);
      syncLock.current = setTimeout(() => {
        syncLock.current = null;
      }, 2500);

      onAction('move', { uid: active.id, to_index: newIndex });
    }
  };

  useEffect(() => {
    if (activeTab !== 'lyrics' || !track) return;
    
    const abortController = new AbortController();

    const fetchSyncedLyrics = async () => {
      setLyricsStatus("Searching providers...");
      setLyricsData([]);
      setLyricOffset(0);
      
      const query = encodeURIComponent(`${track.title} ${track.author}`);
      const sParam = encodeURIComponent(track.title);
      const aParam = encodeURIComponent(track.author);
      const dParam = Math.floor(track.length / 1000);
      
      let videoId = '';
      if (track.uri?.includes('youtube.com') || track.uri?.includes('youtu.be')) {
        videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      }

      const bLyricsUrl = `/blyrics/getLyrics?s=${sParam}&a=${aParam}&d=${dParam}${videoId ? `&videoId=${videoId}` : ''}`;
      
      const lrcLibAuthor = track.author ? track.author.replace(/\s*-\s*Topic$/i, '').trim() : '';
      const lrcLibUrl = `/lrclib/api/search?track_name=${sParam}&artist_name=${encodeURIComponent(lrcLibAuthor)}`;

      const endpoints = [
        `/unison/lyrics?q=${videoId || query}`, 
        bLyricsUrl,                             
        lrcLibUrl   
      ];

      let rawLyrics = null;

      for (const endpoint of endpoints) {
        if (abortController.signal.aborted) return;
        
        try {
          const res = await fetch(endpoint, { signal: abortController.signal });
          
          if (!res.ok) continue;
          
          const data = await res.json();
          
          if (data.error === "API key required") continue;
          
          if (Array.isArray(data)) {
            const bestMatch = data.find(song => song.syncedLyrics || song.ttml || song.lyrics);
            if (bestMatch) {
              rawLyrics = bestMatch.syncedLyrics || bestMatch.ttml || bestMatch.lyrics;
              break;
            }
          } else if (data && (data.syncedLyrics || data.ttml || data.lyrics)) {
            rawLyrics = data.syncedLyrics || data.ttml || data.lyrics;
            break;
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn(`Failed fetching from ${endpoint}:`, err);
        }
      }

      if (rawLyrics) {
        try {
          const parsed = detectParser(rawLyrics);
          setLyricsData(parsed);
          setLyricsStatus("");
        } catch (err) {
          console.error("Braccato parser error:", err);
          setLyricsStatus("Failed to process lyrics format.");
        }
      } else {
        setLyricsStatus("No synced lyrics found for this track.");
      }
    };
    
    fetchSyncedLyrics();

    return () => abortController.abort();
  }, [activeTab, track?.title]);

  useEffect(() => {
    if (lyricsRef.current && lyricsData.length > 0) {
      lyricsRef.current.lyrics = lyricsData;
    }
  }, [lyricsData]);

  useEffect(() => {
    if (!track || activeTab !== 'lyrics') return;
    
    lastSyncTime.current = Date.now();

    const updatePlayhead = () => {
      if (!lyricsRef.current) return;
      
      let currentPos = track.position;
      if (!track.is_paused) {
        const elapsed = Date.now() - lastSyncTime.current;
        currentPos += elapsed;
      }
      
      const adjustedPos = Math.min(currentPos, track.length) + (lyricOffset * 1000);
      lyricsRef.current.currentTime = adjustedPos / 1000;

      if (!track.is_paused) {
        animationRef.current = requestAnimationFrame(updatePlayhead);
      }
    };

    updatePlayhead();
    return () => cancelAnimationFrame(animationRef.current);
  }, [track, activeTab, lyricOffset]);

  useEffect(() => {
    if (activeTab !== 'search') return;
    
    if (searchQuery.trim() !== '') {
      const delayDebounce = setTimeout(() => {
        executeSearch(`${searchQuery}`);
      }, 600);
      return () => clearTimeout(delayDebounce);
    }

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
      const res = await fetch(`/api/search?q=${encodeURIComponent(formattedQuery)}`);
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

  const handleClearQueue = () => {
    onAction('clearqueue');
  };
  
  const filteredQueue = localQueue.filter(queueTrack => {
    if (!queueSearch) return true;
    return queueTrack.title?.toLowerCase().includes(queueSearch.toLowerCase()) || queueTrack.author?.toLowerCase().includes(queueSearch.toLowerCase());
  });

  return (
    <div className="right-panel">
      <div className="tabs-header" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr auto', display: 'grid', alignItems: 'center' }}>
        <button className={`tab-btn ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => setActiveTab('queue')}>Up Next</button>
        <button className={`tab-btn ${activeTab === 'lyrics' ? 'active' : ''}`} onClick={() => setActiveTab('lyrics')}>Lyrics</button>
        <button className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>Search</button>
        <button className={`tab-btn ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>Library</button>
        <button 
          onClick={onOpenAbout}
          style={{ background: 'none', border: 'none', color: '#b5bac1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 0.5rem' }}
          title="About Hikari"
        >
          {Icons.Info}
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'queue' && (
          <div className="queue-tab-wrapper">
            {localQueue.length > 0 && (
              <div className="queue-search-wrapper" style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" className="queue-search-input" placeholder="Filter queue..."
                  value={queueSearch} onChange={(e) => setQueueSearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button 
                  onClick={() => setIsClearQueueOpen(true)}
                  style={{ background: '#da373c', color: '#fff', border: 'none', borderRadius: '4px', padding: '0 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  title="Clear Queue"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="queue-list">
              {localQueue.length === 0 ? (
                <div className="empty-state">Queue is empty</div>
              ) : filteredQueue.length === 0 ? (
                <div className="empty-state">No matching tracks found</div>
              ) : (
                <DndContext 
                  sensors={sensors} 
                  collisionDetection={closestCenter} 
                  onDragStart={handleDragStart} 
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext 
                    items={filteredQueue.map(t => t.uid)} 
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredQueue.map((queueTrack) => (
                      <TrackRow 
                        key={queueTrack.uid}
                        track={queueTrack}
                        context="queue"
                        isSearchActive={!!queueSearch} 
                        index={queueTrack.originalIndex} 
                        onAction={onAction}
                        isFavorited={userFavorites.some(f => f.lavalink_identifier === (queueTrack.lavalink_identifier || queueTrack.uri || queueTrack.identifier))}
                        onFavoriteToggle={onFavoriteToggle}
                        openInfoModal={openInfoModal}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        )}

        {activeTab === 'lyrics' && (
          <div className="synced-lyrics-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {lyricsStatus && <div className="empty-state">{lyricsStatus}</div>}
            {lyricsData.length > 0 && (
              <div className="lyrics-offset-controls">
                <button onClick={() => setLyricOffset(prev => prev + 1)}>▲</button>
                <span>{lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}s</span>
                <button onClick={() => setLyricOffset(prev => prev - 1)}>▼</button>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <braccato-player ref={lyricsRef} style={{ width: '100%', height: '100%', display: 'block' }}></braccato-player>
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <div className="queue-tab-wrapper">
            <div className="queue-search-wrapper" style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="text" className="queue-search-input" placeholder="Search title or paste URL/Playlist..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.includes('http')) {
                    onAction('play', { query: searchQuery });
                    setSearchQuery('');
                  }
                }}
              />
              {searchQuery.includes('http') && (
                <button 
                  onClick={() => {
                    onAction('play', { query: searchQuery });
                    setSearchQuery('');
                  }}
                  style={{ background: '#23a55a', color: '#fff', border: 'none', borderRadius: '4px', padding: '0 1rem', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  {Icons.Play} Play URL
                </button>
              )}
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
                    identifier: searchTrack.info?.identifier || searchTrack.identifier,
                    artworkUrl: searchTrack.info?.artworkUrl || searchTrack.artworkUrl
                  }}
                  context="search"
                  onAction={onAction}
                  isFavorited={userFavorites.some(f => f.lavalink_identifier === (searchTrack.info?.uri || searchTrack.uri || searchTrack.info?.identifier || searchTrack.identifier))}
                  onFavoriteToggle={onFavoriteToggle}
                  openInfoModal={openInfoModal}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="queue-tab-wrapper">
            <div style={{ padding: '0 0.5rem 0.5rem 0.5rem' }}>
              <button 
                onClick={() => onAction('favadd')}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', background: '#23a55a', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {Icons.Shuffle} Deploy Favorites Pool
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
                      uri: favTrack.uri || favTrack.lavalink_identifier,
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

      <ConfirmModal 
        isOpen={isClearQueueOpen}
        onClose={() => setIsClearQueueOpen(false)}
        onConfirm={handleClearQueue}
        title="Clear Queue"
        message="Are you sure you want to remove all upcoming tracks from the queue? This cannot be undone."
      />
    </div>
  );
}