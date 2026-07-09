import { useState, useEffect } from 'react';
import Icons from './Icons';

export default function LeftPanel({ status, onAction }) {
  const [localPos, setLocalPos] = useState(0);

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

  if (!track) {
    return (
      <div className="left-panel empty">
        {Icons.MusicNote}
        <h2>No music playing</h2>
        <p>Add a song to get started.</p>
      </div>
    );
  }

  let artUrl = null;
  if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
    const videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
    artUrl = `/yt-img/vi/${videoId}/maxresdefault.jpg`;
  }

  const progressPct = track.length > 0 ? (localPos / track.length) * 100 : 0;

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="left-panel">
      <div className="album-art-container">
        {artUrl ? (
          <img src={artUrl} alt="Album Art" className="album-art" />
        ) : (
          <div className="album-art fallback">
            {Icons.MusicNote}
          </div>
        )}
      </div>
      
      <div className="track-info">
        <h1 className="title">{track.title}</h1>
        <h2 className="author">{track.author}</h2>
      </div>

      <div className="seekbar-container">
        <div className="seekbar-bg">
          <div className="seekbar-fill" style={{ width: `${progressPct}%` }}></div>
        </div>
        <div className="time-labels">
          <span>{formatTime(localPos)}</span>
          <span>{formatTime(track.length)}</span>
        </div>
      </div>

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
    </div>
  );
}