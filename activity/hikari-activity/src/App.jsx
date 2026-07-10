import { useEffect, useState, useRef, useCallback } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import SearchModal from './components/SearchModal';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

// --- UPDATED: Component to handle YouTube Thumbnail Fallbacks by checking HTTP Status ---
const ThumbnailImage = ({ url, videoId }) => {
  const [src, setSrc] = useState(url);

  useEffect(() => {
    let isMounted = true;

    const verifyThumbnail = async () => {
      if (!url) return;
      
      // Default to the requested URL initially
      setSrc(url);

      // Only perform the explicit HTTP status check for maxresdefault
      if (url.includes('maxresdefault.jpg') && videoId) {
        try {
          // We use fetch to explicitly read the HTTP status code.
          // Because it's an image, the browser caches this GET request, 
          // meaning the <img> tag below will load it instantly from cache without a second download.
          const res = await fetch(url);
          
          if (isMounted) {
            // Explicitly test for the 404 Not Found code
            if (res.status === 404) {
              setSrc(`/yt-img/vi/${videoId}/hqdefault.jpg`);
            }
          }
        } catch (err) {
          // If the network request completely fails, trigger the fallback safely
          console.error("Thumbnail verification failed:", err);
          if (isMounted) {
            setSrc(`/yt-img/vi/${videoId}/hqdefault.jpg`);
          }
        }
      }
    };

    verifyThumbnail();

    return () => {
      isMounted = false; // Cleanup to prevent state updates if the component unmounts quickly
    };
  }, [url, videoId]);

  return (
    <img 
      src={src} 
      alt="Album Art" 
      className="album-art" 
      // Keep a basic onError just in case a true empty 404 slips past the fetch check
      onError={() => {
        if (src.includes('maxresdefault.jpg') && videoId) {
          setSrc(`/yt-img/vi/${videoId}/hqdefault.jpg`);
        }
      }}
    />
  );
};

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

  // 1. App Launch: Initialize SDK quickly without asking for permission
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

      } catch (err) {
        console.error("Failed to initialize Discord SDK Flow:", err);
      }
    }
    setupDiscord();
  }, []);

  // 2. Deferred On-Demand Auth Logic
  const ensureAuthenticated = useCallback(async () => {
    if (currentUser) return currentUser; // Already authed

    try {
      let code;
      try {
        // Try background silent auth first
        const authRes = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        });
        code = authRes.code;
      } catch (silentError) {
        console.log("Silent auth rejected, requesting explicit consent...");
        // If they haven't approved the app yet, show the Discord popup
        const authRes = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'consent',
          scope: ['identify']
        });
        code = authRes.code;
      }

      // POST the code to your Python backend token exchange endpoint
      const tokenRes = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      
      const tokenData = await tokenRes.json();
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(`Backend Token Exchange failed: ${JSON.stringify(tokenData)}`);
      }

      // Authenticate the SDK securely
      const auth = await discordSdk.commands.authenticate({ access_token: tokenData.access_token });
      setCurrentUser(auth.user);
      return auth.user;

    } catch (err) {
      console.error("Auth failed or user cancelled:", err);
      return null;
    }
  }, [currentUser]);

  // 3. Poll for Music Queue Status
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

  // 4. Handle asynchronous SoundCloud oEmbed artwork resolving
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

  // 5. Global Action Handler
  const handleAction = async (endpoint, payload = {}) => {
    if (!guildId) return;

    // Trigger auth ONLY when a user clicks a button to control music
    const user = await ensureAuthenticated();
    if (!user) return; // Halt if auth failed or was cancelled by user

    // Securely build payload with true User ID
    const enhancedPayload = {
      ...payload,
      requester_id: user.id,
      requester_name: user.username || 'Unknown User'
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
  let ytVideoId = null;
  
  if (track) {
    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      artUrl = `/yt-img/vi/${ytVideoId}/maxresdefault.jpg`;
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
        // Pass the dynamically managed component down to handle the fallback
        artComponent={artUrl && ytVideoId ? <ThumbnailImage url={artUrl} videoId={ytVideoId} /> : null}
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