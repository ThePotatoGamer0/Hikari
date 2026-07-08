import { useState, useEffect } from 'react';
import Icons from './Icons';

export default function RightPanel({ status, onAction, openModal, guildId }) {
  const [activeTab, setActiveTab] = useState('queue');
  const [lyricsData, setLyricsData] = useState({ text: "Loading...", source: "" });
  const [lyricOffset, setLyricOffset] = useState(0);

  useEffect(() => {
    if (activeTab !== 'lyrics' || !guildId) return;

    const fetchLyrics = async () => {
      setLyricsData({ text: "Searching for lyrics...", source: "" });
      try {
        const res = await fetch(`${import.meta.env.VITE_BOT_API_URL}/api/lyrics?guild_id=${guildId}`);
        if (res.ok) {
          const data = await res.json();
          setLyricsData({ text: data.lyrics, source: data.source });
        } else {
          setLyricsData({ text: "Lyrics not found for this track.", source: "" });
        }
      } catch {
        setLyricsData({ text: "Error fetching lyrics.", source: "" });
      }
    };

    fetchLyrics();
  }, [activeTab, status?.current_track?.title, guildId]);

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

      <div className="tab-content">
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
          <div className="lyrics-container">
            <div className="lyrics-offset-controls">
              <button onClick={() => setLyricOffset(prev => prev + 1)}>▲</button>
              <span>{lyricOffset}s</span>
              <button onClick={() => setLyricOffset(prev => prev - 1)}>▼</button>
            </div>
            <pre className="lyrics-text">{lyricsData.text}</pre>
            {lyricsData.source && <small className="lyrics-source">Source: {lyricsData.source}</small>}
          </div>
        )}
      </div>

      {activeTab === 'queue' && (
        <button className="fab-add" onClick={openModal}>
          {Icons.Plus}
        </button>
      )}
    </div>
  );
}