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
  
  // Cache state for user's personal favorites list
  const [userFavorites, setUserFavorites] = useState([]);

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

  // Fetch Favorites Cache Hook
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

  // Two-Fold Optimistic Favorite Mutator Loop
  const handleFavoriteToggle = async (track) => {
    const user = await ensureAuthenticated();
    if (!user) throw new Error("Authentication required");

    const identifier = track.identifier || track.uri;
    const trackingId = track.lavalink_identifier || identifier;
    const isCurrentlyFav = userFavorites.some(f => f.lavalink_identifier === trackingId);

    // Step 1: Optimistic State Update
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

    // Step 2: Dispatch Network Payload
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
      await fetchFavoritesCache(user.id); // Sync database sequence
    } catch (err) {
      // Revert cache state if transaction fails
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

    if (track.uri.includes('youtube.com') || track.uri.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      const maxRes = `/yt-img/vi/${ytVideoId}/maxresdefault.jpg`;
      const hqRes = `/yt-img/vi/${ytVideoId}/hqdefault.jpg`;

      const img = new window.Image();
      img.onload = () => {
        if (img.naturalWidth <= 120) setResolvedArtUrl(hqRes); 
        else setResolvedArtUrl(maxRes); 
      };
      img.onerror = () => setResolvedArtUrl(hqRes); 
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
    if (track.uri?.includes('youtube.com') || track.uri?.includes('youtu.be')) {
      const ytVideoId = track.uri.split('v=')[1]?.split('&')[0] || track.uri.split('/').pop();
      return `/yt-img/vi/${ytVideoId}/hqdefault.jpg`; 
    }
    return null; 
  };

  if (!guildId) {
    return <div className="loading">Connecting to Voice Channel...</div>;
  }

  return (
    <div className="app-container">
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