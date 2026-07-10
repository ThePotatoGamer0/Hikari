import { useState, useEffect } from 'react';
import Icons from './Icons';

const formatTime = (ms) => {
  if (!ms || isNaN(ms)) return "Live / Unknown";
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

export default function InfoModal({ isOpen, onClose, track, artUrl: initialArtUrl }) {
  const [resolvedArt, setResolvedArt] = useState(initialArtUrl);

  // Independently resolve the best artwork specifically for the track being viewed
  useEffect(() => {
    if (!isOpen || !track) return;
    
    let isMounted = true;

    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      const maxRes = `/yt-img/vi/${ytVideoId}/maxresdefault.jpg`;
      
      // Use mqdefault (16:9) to prevent YouTube's baked-in black letterbox bars found on hqdefault (4:3)
      const fallbackRes = `/yt-img/vi/${ytVideoId}/mqdefault.jpg`;

      const img = new window.Image();
      img.onload = () => {
        if (!isMounted) return;
        // Check for the 120px wide fake gray placeholder
        if (img.naturalWidth <= 120) setResolvedArt(fallbackRes); 
        else setResolvedArt(maxRes); 
      };
      img.onerror = () => {
        if (isMounted) setResolvedArt(fallbackRes); 
      };
      img.src = maxRes;
      
    } else if (track.uri.includes('soundcloud.com')) {
       const fetchSoundcloudArt = async () => {
         try {
           const res = await fetch(`/sc-api/oembed?format=json&url=${encodeURIComponent(track.uri)}`);
           if (res.ok) {
             const data = await res.json();
             if (data.thumbnail_url && isMounted) {
               const urlObj = new URL(data.thumbnail_url);
               let proxyPath = `/sc-img${urlObj.pathname}`;
               proxyPath = proxyPath.replace('-t400x400.jpg', '-t500x500.jpg').replace('-large.jpg', '-t500x500.jpg');
               setResolvedArt(proxyPath);
             }
           }
         } catch (e) {
           console.error("Failed SC fetch in modal", e);
           if (isMounted) setResolvedArt(null);
         }
       };
       fetchSoundcloudArt();
    } else {
      setResolvedArt(initialArtUrl);
    }

    return () => { isMounted = false; };
  }, [track, isOpen, initialArtUrl]);

  if (!isOpen || !track) return null;

  const trueArtUrl = getTrueUrl(resolvedArt);

  return (
    <div className="info-modal-overlay" onClick={onClose}>
      <div className="info-modal" onClick={(e) => e.stopPropagation()}>
        <button className="info-close-btn" onClick={onClose}>
          {Icons.Close}
        </button>
        
        <div className="info-modal-header">
          {/* NEW: The wrapper physically enforces the 1:1 square crop */}
          <div className="info-modal-art-wrapper">
            <img src={resolvedArt || ''} alt="Album Art" className="info-modal-art" />
          </div>
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