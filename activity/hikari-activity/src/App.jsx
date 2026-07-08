import { useEffect, useState, useRef } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import SearchModal from './components/SearchModal';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
const API_BASE = import.meta.env.VITE_BOT_API_URL;

export default function App() {
  const [auth, setAuth] = useState(null);
  const [guildId, setGuildId] = useState(null);
  const [status, setStatus] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pollInterval = useRef(null);

  useEffect(() => {
    async function setupDiscord() {
      await discordSdk.ready();
      
      const { code } = await discordSdk.commands.authorize({
        client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds', 'rpc.voice.read'],
      });

      // In a production app, you would exchange this code for an access token via your backend.
      // For this local/trusted activity, we bypass full OAuth and just grab the guild context.
      const authData = await discordSdk.commands.authenticate({ access_token: 'mock_token' });
      setAuth(authData);
      setGuildId(discordSdk.guildId);
    }
    setupDiscord();
  }, []);

  useEffect(() => {
    if (!guildId) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status/${guildId}`);
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
      await fetch(`${API_BASE}/api/${endpoint}?guild_id=${guildId}`, {
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

  return (
    <div className="app-container">
      <LeftPanel status={status} onAction={handleAction} />
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