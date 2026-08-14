import { useState, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icons from './Icons';

export default function TrackRow({ 
  track, 
  context, 
  onAction, 
  isFavorited, 
  onFavoriteToggle, 
  openInfoModal,
  index,
  isSearchActive
}) {
  const [flashState, setFlashState] = useState(null); 
  
  // Drag and Drop integration (Only active in the queue tab, disabled if filtering)
  const isDraggable = context === 'queue' && !isSearchActive;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: track.uid || track.uri,
    disabled: !isDraggable
  });

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDraggable ? 'default' : 'pointer', 
    display: 'flex', 
    alignItems: 'center', 
    gap: '0.75rem', 
    padding: '0.5rem 0.75rem', 
    borderRadius: '8px', 
    background: 'rgba(255,255,255,0.02)', 
    marginBottom: '0.5rem',
    position: 'relative',
    overflow: 'hidden',
    zIndex: isDragging ? 99 : 1
  };
  
  // Advanced Hold-to-Fill Logic
  const [holdProgress, setHoldProgress] = useState(0);
  const animationRef = useRef(null);
  const startTime = useRef(0);
  const isTouch = useRef(false);
  const HOLD_DURATION = 1500; 

  const startHold = (e) => {
    if (e.pointerType === 'touch') isTouch.current = true;
    else isTouch.current = false;

    if (e.button !== undefined && e.button !== 0) return;
    
    startTime.current = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime.current;
      const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
      
      setHoldProgress(progress);
      
      if (progress < 100) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        onAction('playnext', { query: track.uri });
        setHoldProgress(0);
        if (navigator.vibrate) navigator.vibrate(50);
        startTime.current = 0; 
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
  };

  const endHold = (e) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    setHoldProgress(0);
    
    if (startTime.current > 0) {
      const elapsed = Date.now() - startTime.current;
      if (elapsed < 400) {
        onAction('play', { query: track.uri });
      }
      startTime.current = 0;
    }
  };

  const formatProxyUrl = (url) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('ytimg.com') || parsed.hostname.includes('youtube.com')) {
        return `/yt-img${parsed.pathname.replace('hqdefault.jpg', 'mqdefault.jpg')}`;
      }
      if (parsed.hostname.includes('sndcdn.com')) {
        return `/sc-img${parsed.pathname}`;
      }
      if (parsed.hostname.includes('googleusercontent.com')) {
        return `/yt3-img${parsed.pathname}`;
      }
      if (parsed.hostname.includes('ggpht.com')) {
        return `/ggpht-img${parsed.pathname}`;
      }
      return url;
    } catch (e) {
      return url;
    }
  };

  const [dynamicArt, setDynamicArt] = useState(formatProxyUrl(track.artworkUrl || track.artwork));

  const isYouTube = track.uri?.includes('youtube.com') || track.uri?.includes('youtu.be');
  const isSoundCloud = track.uri?.includes('soundcloud.com');

  useEffect(() => {
    const existingArt = formatProxyUrl(track.artworkUrl || track.artwork);
    if (existingArt) {
      setDynamicArt(existingArt);
      return;
    }

    let isMounted = true;
    if (isYouTube) {
      const ytVideoId = track.uri?.split('v=')[1]?.split('&')[0] || track.uri?.split('/').pop();
      if (ytVideoId && isMounted) {
        setDynamicArt(`/yt-img/vi/${ytVideoId}/mqdefault.jpg`);
      }
    } else if (isSoundCloud) {
      const fetchScArt = async () => {
        try {
          const res = await fetch(`/sc-api/oembed?format=json&url=${encodeURIComponent(track.uri)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.thumbnail_url && isMounted) {
              const urlObj = new URL(data.thumbnail_url);
              let proxyPath = `/sc-img${urlObj.pathname}`;
              proxyPath = proxyPath.replace('-t400x400.jpg', '-t500x500.jpg').replace('-large.jpg', '-t500x500.jpg');
              setDynamicArt(proxyPath);
            }
          }
        } catch (e) {}
      };
      fetchScArt();
    }
    return () => { isMounted = false; };
  }, [track.uri, track.artworkUrl, track.artwork, isYouTube, isSoundCloud]);

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

  const { cleanTitle, cleanAuthor } = sanitizeMetadata(track.title, track.author);

  const handleFavClick = async (e) => {
    e.stopPropagation();
    try {
      await onFavoriteToggle(track);
      setFlashState('success');
      setTimeout(() => setFlashState(null), 1200);
    } catch (err) {
      setFlashState('error');
      setTimeout(() => setFlashState(null), 1200);
    }
  };

  return (
    <div 
      ref={setNodeRef}
      className="queue-item track-row-container" 
      onClick={() => openInfoModal && openInfoModal(track)}
      style={rowStyle}
    >
      {holdProgress > 0 && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${holdProgress}%`,
          backgroundColor: context === 'search' ? 'rgba(35, 165, 90, 0.2)' : 'rgba(88, 101, 242, 0.2)',
          zIndex: 0,
          transition: 'width 0.1s linear'
        }} />
      )}

      {/* Drag Handle (Only active when sortable) */}
      {isDraggable && (
        <div 
          {...attributes} 
          {...listeners}
          style={{ 
            cursor: 'grab', 
            color: '#4e5058', 
            display: 'flex', 
            alignItems: 'center', 
            padding: '4px',
            marginRight: '-4px', // Tucks it nicely next to the index
            position: 'relative',
            zIndex: 10,
            touchAction: 'none' // Fixes mobile drag-and-drop by blocking scroll when gripping
          }}
        >
          {/* Inline SVG for GripVertical */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/>
            <circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </div>
      )}

      {index && (
        <span style={{ position: 'relative', zIndex: 1, fontSize: '0.85rem', fontWeight: 'bold', color: '#b5bac1', minWidth: '1.2rem', textAlign: 'right' }}>
          {index}.
        </span>
      )}

      <div style={{ position: 'relative', zIndex: 1, width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', background: '#1E1F22', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {dynamicArt ? (
          <img src={dynamicArt} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ color: '#4e5058' }}>{Icons.MusicNote}</div>
        )}
      </div>

      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#f2f3f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cleanTitle}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {isYouTube && Icons.YouTube}
          {isSoundCloud && Icons.SoundCloud}
          <span style={{ fontSize: '0.75rem', color: '#b5bac1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cleanAuthor}
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <button 
          onClick={handleFavClick}
          className={`fav-toggle-btn ${flashState ? `flash-${flashState}` : ''}`}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            color: flashState === 'success' ? '#23a55a' : flashState === 'error' ? '#f23f43' : isFavorited ? '#f23f43' : '#b5bac1',
            transition: 'color 0.2s, transform 0.1s',
            transform: flashState ? 'scale(1.2)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {isFavorited || flashState === 'success' ? Icons.HeartFilled : Icons.Heart}
        </button>

        {(context === 'search' || context === 'favorites') && (
          <button 
            className="remove-btn hold-action-btn"
            style={{ 
              color: context === 'search' ? '#23a55a' : '#5865f2',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '4px'
            }}
            title="Tap: Add to Queue | Hold/Right-Click: Play Next"
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold} 
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isTouch.current) {
                onAction('playnext', { query: track.uri });
              }
            }}
            onClick={(e) => e.stopPropagation()} 
          >
            {Icons.Play}
          </button>
        )}

        {context === 'queue' && (
          <button 
            className="remove-btn"
            title="Remove from Queue"
            onClick={(e) => {
              e.stopPropagation(); 
              onAction('remove', { uid: track.uid });
            }}
          >
            {Icons.Trash}
          </button>
        )}
      </div>
    </div>
  );
}