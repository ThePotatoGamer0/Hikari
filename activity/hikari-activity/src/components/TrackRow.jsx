import { useState } from 'react';
import Icons from './Icons';

export default function TrackRow({ 
  track, 
  context, 
  onAction, 
  isFavorited, 
  onFavoriteToggle, 
  openInfoModal,
  index 
}) {
  const [flashState, setFlashState] = useState(null); 

  const isYouTube = track.uri?.includes('youtube.com') || track.uri?.includes('youtu.be');
  const isSoundCloud = track.uri?.includes('soundcloud.com');

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

  const getFallbackArtUrl = () => {
    if (!track.uri) return null;
    if (isYouTube) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      return `/yt-img/vi/${ytVideoId}/hqdefault.jpg`;
    }
    return null;
  };

  return (
    <div 
      className="queue-item track-row-container" 
      onClick={() => openInfoModal && openInfoModal(track)}
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', marginBottom: '0.5rem' }}
    >
      {/* Queue Index Number */}
      {index && (
        <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#b5bac1', minWidth: '1.2rem', textAlign: 'right' }}>
          {index}.
        </span>
      )}

      {/* Track Art / Icon */}
      <div style={{ width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', background: '#1E1F22', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {getFallbackArtUrl() ? (
          <img src={getFallbackArtUrl()} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ color: '#4e5058' }}>{Icons.MusicNote}</div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
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

        {context === 'search' && (
          <button 
            className="remove-btn"
            style={{ color: '#23a55a' }}
            onClick={(e) => {
              e.stopPropagation();
              onAction('play', { query: track.uri });
            }}
          >
            {Icons.Plus}
          </button>
        )}

        {context === 'queue' && (
          <button 
            className="remove-btn"
            onClick={(e) => {
              e.stopPropagation(); 
              onAction('remove', { uid: track.uid });
            }}
          >
            {Icons.Trash}
          </button>
        )}

        {context === 'favorites' && (
          <button 
            className="remove-btn"
            style={{ color: '#5865f2' }}
            onClick={(e) => {
              e.stopPropagation();
              onAction('play', { query: track.uri });
            }}
          >
            {Icons.Play}
          </button>
        )}
      </div>
    </div>
  );
}