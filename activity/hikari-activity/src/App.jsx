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
  
  // Track layout mode: 0 (Focused), 1 (PIP), 2 (Grid)
  const [layoutMode, setLayoutMode] = useState(0); 
  
  // State to hold asynchronously fetched SoundCloud artwork
  const [scArtUrl, setScArtUrl] = useState(null);

  // State to track the authenticated user profile details
  const [currentUser, setCurrentUser] = useState(null);

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

        // Subscribe to PIP/Layout changes
        discordSdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode }) => {
          setLayoutMode(layout_mode);
        });

        // --- DISCORD OAUTH2 HANDSHAKE FLOW ---
        // 1. Request a temporary authorization code from the Discord client
        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        });

        // 2. POST the code to your Python backend token exchange endpoint
        const tokenRes = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const { access_token } = await tokenRes.json();

        // 3. Finalize SDK client authentication using the returned access token
        const auth = await discordSdk.commands.authenticate({ access_token });
        
        // 4. Cache the verified user object in application state
        setCurrentUser(auth.user);

      } catch (err) {
        console.error("Failed to initialize Discord SDK Flow:", err);
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

  // Handle asynchronous SoundCloud oEmbed artwork resolving
  useEffect(() => {
    const track = status?.current_track;
    if (!track || !track.uri.includes('soundcloud.com')) {
      setScArtUrl(null);
      return;
    }

    const fetchSoundcloudArt = async () => {
      try {
        const res = await fetch(`/sc-api/oembed?format=json&url=${encodeURIComponent(track.uri)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.thumbnail_url) {
            const urlObj = new URL(data.thumbnail_url);
            let proxyPath = `/sc-img${urlObj.pathname}`;
            proxyPath = proxyPath.replace('-t400x400.jpg', '-t500x500.jpg').replace('-large.jpg', '-t500x500.jpg');
            setScArtUrl(proxyPath);
          }
        }
      } catch (e) {
        console.error("Failed to fetch SoundCloud art", e);
      }
    };

    fetchSoundcloudArt();
  }, [status?.current_track?.uri]);

  const handleAction = async (endpoint, payload = {}) => {
    if (!guildId) return;

    // Build the payload by securely adding the active user's Snowflake ID 
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
  
  if (track) {
    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      artUrl = `/yt-img/vi/${videoId}/maxresdefault.jpg`;
    } else if (track.uri.includes('soundcloud.com')) {
      artUrl = scArtUrl; 
    }
  }

  return (
    <div className="app-container">
      {artUrl && (
        <div 
          className="blurred-background" 
          style={{ backgroundImage: `url(${artUrl})` }}
        />
      )}
      
      <LeftPanel 
        status={status} 
        onAction={handleAction} 
        artUrl={artUrl} 
        isPip={layoutMode !== 0} 
      />
      
      {layoutMode === 0 && (
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