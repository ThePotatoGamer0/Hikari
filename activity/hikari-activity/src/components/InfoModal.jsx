import Icons from './Icons';

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Translates internal proxy URLs back to their true public source
const getTrueUrl = (url) => {
  if (!url) return 'None available';
  if (url.startsWith('/yt-img/')) return url.replace('/yt-img/', 'https://img.youtube.com/');
  if (url.startsWith('/sc-img/')) return url.replace('/sc-img/', 'https://i1.sndcdn.com/');
  return url;
};

export default function InfoModal({ isOpen, onClose, track, artUrl }) {
  if (!isOpen || !track) return null;

  const trueArtUrl = getTrueUrl(artUrl);

  return (
    <div className="info-modal-overlay" onClick={onClose}>
      <div className="info-modal" onClick={(e) => e.stopPropagation()}>
        <button className="info-close-btn" onClick={onClose}>
          {Icons.Close}
        </button>
        
        <div className="info-modal-header">
          <img src={artUrl || ''} alt="Album Art" className="info-modal-art" />
          <div className="info-modal-meta">
            <h2>{track.title}</h2>
            <h3>{track.author}</h3>
            <span className="info-duration">{formatTime(track.length)}</span>
          </div>
        </div>

        <div className="info-modal-details">
          <div className="info-row">
            <span className="info-label">Audio Source:</span>
            <a href={track.uri} target="_blank" rel="noreferrer" className="info-link">{track.uri || 'Unknown'}</a>
          </div>
          <div className="info-row">
            <span className="info-label">Artwork URL:</span>
            <a href={trueArtUrl} target="_blank" rel="noreferrer" className="info-link">{trueArtUrl}</a>
          </div>
        </div>
      </div>
    </div>
  );
}