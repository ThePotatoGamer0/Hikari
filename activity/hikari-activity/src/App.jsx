import { useEffect, useState, useRef, useCallback } from 'react';
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

  // NEW: Unified Global Artwork State
  // This completely replaces scArtUrl and the ThumbnailImage component
  const [resolvedArtUrl, setResolvedArtUrl] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  const pollInterval = useRef(null);

  // 1. App Launch: Initialize SDK quickly
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
        const authRes = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'consent',
          scope: ['identify']
        });
        code = authRes.code;
      }

      const tokenRes = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      
      const tokenData = await tokenRes.json();
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(`Backend Token Exchange failed: ${JSON.stringify(tokenData)}`);
      }

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

  // 4. Centralized Artwork Resolution & Fallback Logic
  useEffect(() => {
    const track = status?.current_track;
    if (!track) {
      setResolvedArtUrl(null);
      return;
    }

    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      const maxRes = `/yt-img/vi/${ytVideoId}/maxresdefault.jpg`;
      const hqRes = `/yt-img/vi/${ytVideoId}/hqdefault.jpg`;

      // Preload image invisibly to check for 404s and Fake YouTube Placeholders
      const img = new window.Image();
      img.onload = () => {
        // If it successfully loads but is tiny, it's the fake gray placeholder
        if (img.naturalWidth <= 120) {
          setResolvedArtUrl(hqRes); 
        } else {
          setResolvedArtUrl(maxRes); 
        }
      };
      img.onerror = () => {
        // If it throws a true 404 error
        setResolvedArtUrl(hqRes); 
      };
      img.src = maxRes;

    } else if (track.uri.includes('soundcloud.com')) {
      const fetchSoundcloudArt = async () => {
        try {
          const res = await fetch(`/sc-api/oembed?format=json&url=${encodeURIComponent(track.uri)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.thumbnail_url) {
              const urlObj = new URL(data.thumbnail_url);
              let proxyPath = `/sc-img${urlObj.pathname}`;
              proxyPath = proxyPath.replace('-t400x400.jpg', '-t500x500.jpg').replace('-large.jpg', '-t500x500.jpg');
              setResolvedArtUrl(proxyPath);
            }
          }
        } catch (e) {
          console.error("Failed to fetch SoundCloud art", e);
        }
      };
      fetchSoundcloudArt();
    } else {
      setResolvedArtUrl(null);
    }
  }, [status?.current_track?.uri]);

  // 5. Global Action Handler
  const handleAction = async (endpoint, payload = {}) => {
    if (!guildId) return;

    const user = await ensureAuthenticated();
    if (!user) return; 

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

  return (
    <div className="app-container">
      {/* Both the Background and LeftPanel now use the guaranteed "resolvedArtUrl" 
        This prevents the UI from desyncing or crashing!
      */}
      {resolvedArtUrl && (
        <div 
          className="blurred-background" 
          style={{ backgroundImage: `url(${resolvedArtUrl})` }}
        />
      )}
      
      <LeftPanel 
        status={status} 
        onAction={handleAction} 
        artUrl={resolvedArtUrl} 
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