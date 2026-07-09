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
  
  // Track layout mode: 0 (Focused), 1 (PIP), 2 (Grid)
  const [layoutMode, setLayoutMode] = useState(0); 
  
  // NEW: State to hold the asynchronously fetched SC artwork
  const [scArtUrl, setScArtUrl] = useState(null);
  
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

        discordSdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode }) => {
          setLayoutMode(layout_mode);
        });

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        });

        const tokenRes = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const { access_token } = await tokenRes.json();

        const auth = await discordSdk.commands.authenticate({ access_token });
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

  // --- NEW: Fetch SoundCloud Artwork ---
  useEffect(() => {
    const track = status?.current_track;
    
    // If it's not a SC track, wipe the state and ignore
    if (!track || !track.uri.includes('soundcloud.com')) {
      setScArtUrl(null);
      return;
    }

    const fetchSoundcloudArt = async () => {
      try {
        // Ask SoundCloud for the track data using our new API proxy
        const res = await fetch(`/sc-api/oembed?format=json&url=${encodeURIComponent(track.uri)}`);
        
        if (res.ok) {
          const data = await res.json();
          if (data.thumbnail_url) {
            // SC gives us a full URL (e.g., https://i1.sndcdn.com/artworks-123.jpg)
            // We just extract the path and route it through our Discord Image Proxy
            const urlObj = new URL(data.thumbnail_url);
            let proxyPath = `/sc-img${urlObj.pathname}`;
            
            // Force the API to give us the high-res 500x500 image instead of the blurry thumbnail
            proxyPath = proxyPath.replace('-t400x400.jpg', '-t500x500.jpg').replace('-large.jpg', '-t500x500.jpg');
            
            setScArtUrl(proxyPath);
          }
        }
      } catch (e) {
        console.error("Failed to fetch SoundCloud art", e);
      }
    };

    fetchSoundcloudArt();
  }, [status?.current_track?.uri]); // Only re-run this if the URI actually changes

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
  
  // --- UPDATED: Merge YouTube and SoundCloud logic ---
  if (track) {
    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const videoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      artUrl = `/yt-img/vi/${videoId}/maxresdefault.jpg`;
    } else if (track.uri.includes('soundcloud.com')) {
      // Plug in our dynamically fetched SC artwork here
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