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
  const [currentUser, setCurrentUser] = useState(null);
  
  // NEW: State to track if the app is focused (0) or in miniplayer PIP (1)
  const [layoutMode, setLayoutMode] = useState(0); 
  
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

        // --- NEW: Subscribe to PIP/Layout changes ---
        discordSdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode }) => {
          setLayoutMode(layout_mode);
        });

        // 1. Prompt the user to authorize the app
        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        });

        // 2. Ask backend for token
        const tokenRes = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const { access_token } = await tokenRes.json();

        // 3. Authenticate
        const auth = await discordSdk.commands.authenticate({ access_token });
        
        // 4. Save user
        setCurrentUser(auth.user);

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
    
    const enhancedPayload = {
      ...payload,
      requester_id: currentUser?.id,
      requester_name: currentUser?.username || 'Unknown User'
    };

    try {
      await fetch(`/api/${endpoint}?guild_id=${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enhancedPayload)
      });
    } catch (e) {
      console.error(`Failed action: ${endpoint}`, e);
    }
  };

  if (!guildId) {
    return <div className="loading">Connecting to Voice Channel...</div>;
  }

  const track = status?.current_track;
  let artUrl = null;
  if (track && (track.uri.includes('youtube.com') || track.uri.includes('youtu.be'))) {
    const videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
    artUrl = `/yt-img/vi/${videoId}/maxresdefault.jpg`;
  }

  return (
    <div className="app-container">
      {artUrl && (
        <div 
          className="blurred-background" 
          style={{ backgroundImage: `url(${artUrl})` }}
        />
      )}
      
      {/* Pass the PIP state down so the LeftPanel knows to hide text/controls */}
      <LeftPanel 
        status={status} 
        onAction={handleAction} 
        artUrl={artUrl} 
        isPip={layoutMode === 1} 
      />
      
      {/* Completely unmount the RightPanel and Modals if we are in the tiny PIP view */}
      {layoutMode !== 1 && (
        <>
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
        </>
      )}
    </div>
  );
}