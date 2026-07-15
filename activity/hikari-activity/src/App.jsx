import { useEffect, useState, useRef, useCallback } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import SearchModal from './components/SearchModal';
import InfoModal from './components/InfoModal';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

export default function App() {
  const [guildId, setGuildId] = useState(null);
  const [status, setStatus] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [infoModalTrack, setInfoModalTrack] = useState(null); 
  const [layoutMode, setLayoutMode] = useState(0); 
  const [resolvedArtUrl, setResolvedArtUrl] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [userFavorites, setUserFavorites] = useState([]);

  const pollInterval = useRef(null);

  const formatProxyUrl = (url) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('ytimg.com') || parsed.hostname.includes('youtube.com')) {
        return `/yt-img${parsed.pathname.replace('hqdefault.jpg', 'mqdefault.jpg')}`;
      }
      if (parsed.hostname.includes('sndcdn.com')) {
        return `/sc-img${parsed.pathname}`;
      }
      if (parsed.hostname.includes('googleusercontent.com')) {
        return `/yt3-img${parsed.pathname}`;
      }
      if (parsed.hostname.includes('ggpht.com')) {
        return `/ggpht-img${parsed.pathname}`;
      }
      return url;
    } catch (e) {
      return url;
    }
  };

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

  const ensureAuthenticated = useCallback(async () => {
    if (currentUser) return currentUser; 
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

  const fetchFavoritesCache = useCallback(async (userId) => {
    try {
      const res = await fetch(`/api/favorites?discord_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setUserFavorites(data.favorites || []);
      }
    } catch (e) {
      console.error("Failed to populate user library cache:", e);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      fetchFavoritesCache(currentUser.id);
    }
  }, [currentUser?.id, fetchFavoritesCache]);

  const handleFavoriteToggle = async (track) => {
    const user = await ensureAuthenticated();
    if (!user) throw new Error("Authentication required");

    const bestIdentifier = track.uri || track.identifier;
    const trackingId = track.lavalink_identifier || bestIdentifier;
    const isCurrentlyFav = userFavorites.some(f => f.lavalink_identifier === trackingId);

    let updatedList;
    if (isCurrentlyFav) {
      updatedList = userFavorites.filter(f => f.lavalink_identifier !== trackingId);
    } else {
      updatedList = [...userFavorites, {
        lavalink_identifier: trackingId,
        title: track.title,
        author: track.author,
        uri: track.uri || trackingId
      }];
    }
    setUserFavorites(updatedList);

    try {
      const res = await fetch('/api/favorites', {
        method: isCurrentlyFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: user.id,
          lavalink_identifier: trackingId,
          title: track.title,
          author: track.author,
          duration_ms: track.length || 0
        })
      });

      if (!res.ok) throw new Error("Server rejected state change");
      await fetchFavoritesCache(user.id);
    } catch (err) {
      await fetchFavoritesCache(user.id);
      throw err; 
    }
  };

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

  useEffect(() => {
    if (currentUser) return;
    ensureAuthenticated();
  }, [ensureAuthenticated, currentUser]);

  useEffect(() => {
    const track = status?.current_track;
    if (!track) {
      setResolvedArtUrl(null);
      return;
    }

    if (track.artworkUrl || track.artwork) {
      const art = track.artworkUrl || track.artwork;
      if (art.includes('googleusercontent.com') || art.includes('ggpht.com') || art.includes('sndcdn.com')) {
        setResolvedArtUrl(formatProxyUrl(art));
        return;
      }
    }

    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      const maxRes = `/yt-img/vi/${ytVideoId}/maxresdefault.jpg`;
      const mqRes = `/yt-img/vi/${ytVideoId}/mqdefault.jpg`;

      const img = new window.Image();
      img.onload = () => {
        if (img.naturalWidth <= 120) setResolvedArtUrl(mqRes); 
        else setResolvedArtUrl(maxRes); 
      };
      img.onerror = () => setResolvedArtUrl(mqRes); 
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
      setResolvedArtUrl(formatProxyUrl(track.artworkUrl || track.artwork) || null);
    }
  }, [status?.current_track?.uri, status?.current_track?.artwork, status?.current_track?.artworkUrl]);

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

  const getFallbackArtUrl = (track) => {
    if (!track) return null;
    
    const formatProxyUrl = (url) => {
      if (!url) return null;
      try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('ytimg.com') || parsed.hostname.includes('youtube.com')) {
          return `/yt-img${parsed.pathname.replace('hqdefault.jpg', 'mqdefault.jpg')}`;
        }
        if (parsed.hostname.includes('sndcdn.com')) {
          return `/sc-img${parsed.pathname}`;
        }
        if (parsed.hostname.includes('googleusercontent.com')) {
          return `/yt3-img${parsed.pathname}`;
        }
        if (parsed.hostname.includes('ggpht.com')) {
          return `/ggpht-img${parsed.pathname}`;
        }
        return url;
      } catch (e) {
        return url;
      }
    };

    if (track.artworkUrl || track.artwork) return formatProxyUrl(track.artworkUrl || track.artwork);
    
    if (track.uri?.includes('youtube.com') || track.uri?.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      return `/yt-img/vi/${ytVideoId}/mqdefault.jpg`; 
    }
    return null; 
  };

  if (!guildId) {
    return <div className="loading">Connecting to Voice Channel...</div>;
  }

  // Smooth, GPU-accelerated CSS flow with a film-grain anti-banding overlay
  const ambientStyles = `
    @keyframes ambientFlow {
      0% { transform: scale(1.2) translate(0%, 0%) rotate(0deg); }
      33% { transform: scale(1.3) translate(2%, 3%) rotate(1deg); }
      66% { transform: scale(1.25) translate(-2%, -1%) rotate(-1deg); }
      100% { transform: scale(1.2) translate(0%, 0%) rotate(0deg); }
    }
    .ambient-flow {
      animation: ambientFlow 25s ease-in-out infinite alternate;
      will-change: transform;
      /* Increased saturation makes the colors pop underneath the UI */
      filter: blur(80px) saturate(150%);
    }
    .grain-overlay {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      /* Base64 encoded repeating SVG noise to act as a dithering layer */
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
      opacity: 0.08;
      mix-blend-mode: screen;
    }
  `;

  return (
    <div className="app-container">
      <style>{ambientStyles}</style>

      {resolvedArtUrl && (
        <>
          <div 
            className="blurred-background ambient-flow" 
            style={{ backgroundImage: `url(${resolvedArtUrl})` }}
          />
          <div className="grain-overlay" />
        </>
      )}
      
      <LeftPanel 
        status={status} 
        onAction={handleAction} 
        artUrl={resolvedArtUrl} 
        isPip={layoutMode !== 0} 
        openInfoModal={() => setInfoModalTrack(status?.current_track)} 
        userFavorites={userFavorites}
        onFavoriteToggle={handleFavoriteToggle}
      />
      
      {layoutMode === 0 && (
        <>
          <RightPanel 
            status={status} 
            onAction={handleAction} 
            openModal={() => setIsModalOpen(true)} 
            openInfoModal={(track) => setInfoModalTrack(track)} 
            guildId={guildId}
            userFavorites={userFavorites}
            onFavoriteToggle={handleFavoriteToggle}
            currentUser={currentUser}
          />
          <SearchModal 
            isOpen={isModalOpen} 
            onClose={() => setIsModalOpen(false)} 
            onAction={handleAction} 
          />
          <InfoModal 
            isOpen={!!infoModalTrack} 
            onClose={() => setInfoModalTrack(null)} 
            track={infoModalTrack} 
            artUrl={infoModalTrack?.uid === status?.current_track?.uid ? resolvedArtUrl : getFallbackArtUrl(infoModalTrack)} 
          />
        </>
      )}
    </div>
  );
}