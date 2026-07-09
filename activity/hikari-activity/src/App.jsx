import { useEffect, useState, useRef } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import SearchModal from './components/SearchModal';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

export default function App() {
  const [guildId, setGuildId] = useState(null);
  const [status, setStatus] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pollInterval = useRef(null);

  useEffect(() => {
    async function setupDiscord() {
      try {
        await discordSdk.ready();
        
        if (discordSdk.guildId) {
          setGuildId(discordSdk.guildId);
        } else {
          console.error("Not in a server voice channel!");
        }
      } catch (err) {
        console.error("Failed to initialize Discord SDK:", err);
      }
    }
    setupDiscord();
  }, []);

  useEffect(() => {
    if (!guildId) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/status/${guildId}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch status", err);
      }
    };

    fetchStatus();
    pollInterval.current = setInterval(fetchStatus, 2000);

    return () => clearInterval(pollInterval.current);
  }, [guildId]);

  const handleAction = async (endpoint, payload = {}) => {
    if (!guildId) return;
    try {
      await fetch(`/api/${endpoint}?guild_id=${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined
      });
    } catch (e) {
      console.error(`Failed action: ${endpoint}`, e);
    }
  };

  if (!guildId) {
    return <div className="loading">Connecting to Voice Channel...</div>;
  }

  // Determine the album art URL globally so the background can use it
  const track = status?.current_track;
  let artUrl = null;
  if (track && (track.uri.includes('youtube.com') || track.uri.includes('youtu.be'))) {
    const videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
    artUrl = `/yt-img/vi/${videoId}/maxresdefault.jpg`;
  }

  return (
    <div className="app-container">
      {/* Dynamic Blurred Background Layer */}
      {artUrl && (
        <div 
          className="blurred-background" 
          style={{ backgroundImage: `url(${artUrl})` }}
        />
      )}
      
      <LeftPanel status={status} onAction={handleAction} artUrl={artUrl} />
      <RightPanel 
        status={status} 
        onAction={handleAction} 
        openModal={() => setIsModalOpen(true)} 
        guildId={guildId}
      />
      <SearchModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onAction={handleAction} 
      />
    </div>
  );
}