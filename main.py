import discord
import wavelink
import os
import logging
import sys
import datetime
import asyncio
import spotipy
import random
import string
import json
import math
import aiohttp
import re
import time
import aiomysql
from aiohttp import web
from collections import deque
from spotipy.oauth2 import SpotifyClientCredentials
from discord import app_commands
from discord.ext import commands
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Union, Set

# ====================================
# INITIALIZATION & LOGGING
# ====================================
from dotenv import load_dotenv
load_dotenv()

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

file_handler = logging.FileHandler("bot.log")
file_handler.setFormatter(formatter)
root_logger.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)
root_logger.addHandler(console_handler)

logger = logging.getLogger("HikariBot")


# ====================================
# HELPERS
# ====================================
def generate_uid(length=5):
    """Generates a short, random alphanumeric ID for queue tracks."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def extract_track_payload(track: wavelink.Playable) -> dict:
    """Safely extracts or reconstructs the Lavalink track payload for JSON serialization."""
    for attr in ['raw_data', 'data', 'payload', '_raw_data', '_raw']:
        val = getattr(track, attr, None)
        if val and isinstance(val, dict):
            return val
            
    # Fallback Reconstruction
    return {
        "encoded": getattr(track, 'encoded', ""),
        "info": {
            "identifier": getattr(track, 'identifier', ""),
            "isSeekable": getattr(track, 'is_seekable', getattr(track, 'isSeekable', True)),
            "author": getattr(track, 'author', ""),
            "length": getattr(track, 'length', 0),
            "isStream": getattr(track, 'is_stream', getattr(track, 'isStream', False)),
            "position": getattr(track, 'position', 0),
            "title": getattr(track, 'title', ""),
            "uri": getattr(track, 'uri', ""),
            "sourceName": getattr(track, 'source', "youtube"),
            "artworkUrl": getattr(track, 'artwork', "")
        }
    }

def chunk_text(text: str, max_len: int = 1500) -> List[str]:
    """Splits long text cleanly by natural line breaks for Discord embeds."""
    pages = []
    lines = text.split('\n')
    current_page = ""
    for line in lines:
        if len(current_page) + len(line) + 1 > max_len:
            if current_page: pages.append(current_page.strip())
            current_page = line + "\n"
        else:
            current_page += line + "\n"
    if current_page: pages.append(current_page.strip())
    return pages if pages else ["No content available."]


# ====================================
# ICON CONFIGURATION
# ====================================
class Icons:
    """Centralized dictionary for all bot emojis."""
    MUSIC = "<:music_white:1523496640697340046>"
    SKIP = "<:skipforward_white:1523496676978069625>"
    STOP = "<:square_white:1523496680639565904>"
    AUTOPLAY = "<:infinity_white:1523496636268150824>"
    SHUFFLE = "<:shuffle_white:1523496667469578431>"
    PLAY = "<:play_white:1523496655893303376>"
    ADDED = "<:savecheck_white:1523496664529371290>"
    SUCCESS = "<:check_white:1523496625715281930>"
    ERROR = "<:trianglealert_white:1523496683705597973>"
    EMPTY = "<:ban_white:1523496620866666557>"
    USER = "<:user_white:1523496689200009368>"
    PLUS = "<:plus_white:1523496659118456932>"
    PREV = "<:play_flipped_white:1523496654689406997>"
    NEXT = "<:play_white:1523496655893303376>"
    FIRST = "<:fastforward_flipped_white:1523496631658479749>"
    LAST = "<:fastforward_white:1523496632602071200>"
    CLOSE = "<:x_white:1523497109769003191>"
    TOOLS = "<:wrench_white:1523496706321285120>"
    BAR_START = "<:SeekBar_SolidStart:1523497100086739097>"
    BAR_END = "<:SeekBar_SolidDarkEnd:1523497099575037952>"
    BAR_FILLED = "<:SeekBar_Solid:1523497097469493250>"
    BAR_EMPTY = "<:SeekBar_SolidDark:1523497098702749827>"
    BAR_PLAYHEAD = "<:SeekBar_PlayHead:1523497096097824879>"
    CD = "<a:cd:1523507325145448479>"
    REPEAT = "<:repeat_white:1524533301006696498>"
    REPEAT_OFF = "<:repeatoff_white:1524533308170567750>"
    REPEAT_ONE = "<:repeat1_white:1524533304404086894>" 


# ====================================
# DATA MODELS & PERSISTENCE
# ====================================
@dataclass
class TrackRequest:
    """Wraps a Wavelink track with the user who requested it."""
    track: wavelink.Playable
    requester: Union[discord.Member, discord.User]
    uid: str = field(default_factory=generate_uid)


class PersistenceManager:
    def __init__(self):
        self.base_dir = "servers"
        os.makedirs(self.base_dir, exist_ok=True)

    def _get_dir(self, guild_id: int) -> str:
        path = os.path.join(self.base_dir, str(guild_id))
        os.makedirs(path, exist_ok=True)
        return path

    def load_settings(self, guild_id: int) -> dict:
        path = os.path.join(self._get_dir(guild_id), "settings.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"prefix": os.getenv('BOT_PREFIX', 'h!'), "dj_lockdown": False, "vote_percentage": 75, "roles": {}}

    def save_settings(self, guild_id: int, data: dict):
        path = os.path.join(self._get_dir(guild_id), "settings.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)

    def load_persistence(self, guild_id: int) -> dict:
        path = os.path.join(self._get_dir(guild_id), "persistence.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def save_persistence(self, guild_id: int, data: dict):
        path = os.path.join(self._get_dir(guild_id), "persistence.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)


# ====================================
# QUEUE SYSTEM
# ====================================
class QueueManager:
    def __init__(self, bot: "MusicBot", guild_id: int):
        self.bot = bot
        self.guild_id = guild_id
        self._queue: deque[TrackRequest] = deque()
        self._lock = asyncio.Lock()
        self._logger = logging.getLogger(f"QueueManager-{guild_id}")

    def _save(self):
        try:
            p_data = self.bot.persistence.load_persistence(self.guild_id)
            q_list = []
            
            for req in self._queue:
                t_data = extract_track_payload(req.track)
                q_list.append({
                    "data": t_data,
                    "uri": req.track.uri or req.track.title,
                    "requester_id": getattr(req.requester, "id", None),
                    "uid": req.uid
                })
                
            p_data["queue"] = q_list
            self.bot.persistence.save_persistence(self.guild_id, p_data)
        except Exception as e:
            self._logger.error(f"Failed to sync queue to JSON: {e}")

    async def enqueue(self, track_req: TrackRequest):
        async with self._lock:
            self._queue.append(track_req)
            self._logger.info(f"Track added: {track_req.track.title}")
            await self.on_track_added(track_req)

    async def add_to_front(self, track_req: TrackRequest):
        """Pushes an override track to index 0 of the deque (PlayNext)."""
        async with self._lock:
            self._queue.appendleft(track_req)
            self._logger.info(f"Track forced to front: {track_req.track.title}")
            await self.on_track_added(track_req)

    async def dequeue(self) -> Optional[TrackRequest]:
        async with self._lock:
            if not self._queue:
                return None
            track_req = self._queue.popleft()
            self._logger.info(f"Track dequeued: {track_req.track.title}")
            await self.on_track_removed(track_req)
            return track_req

    async def peek(self) -> Optional[TrackRequest]:
        async with self._lock:
            return self._queue[0] if self._queue else None

    async def clear(self):
        async with self._lock:
            self._queue.clear()
            self._logger.info("Queue cleared.")
            await self.on_queue_cleared()

    async def remove_by_uid(self, uid: str) -> Optional[TrackRequest]:
        async with self._lock:
            found = next((req for req in self._queue if req.uid.upper() == uid.upper()), None)
            if found:
                self._queue.remove(found)
                await self.on_track_removed(found)
                return found
            return None

    async def get_all(self) -> List[TrackRequest]:
        async with self._lock:
            return list(self._queue)

    async def shuffle(self):
        async with self._lock:
            if len(self._queue) > 1:
                temp_list = list(self._queue)
                random.shuffle(temp_list)
                self._queue = deque(temp_list)
            self._logger.info("Queue shuffled.")
            await self.on_shuffle_enabled()

    @property
    def is_empty(self) -> bool:
        return len(self._queue) == 0

    async def on_track_added(self, track_req: TrackRequest): self._save()
    async def on_track_removed(self, track_req: TrackRequest): self._save()
    async def on_queue_cleared(self): self._save()
    async def on_shuffle_enabled(self): self._save()
    async def on_shuffle_disabled(self): self._save()


# ====================================
# STATE & EXTERNAL RESOLVERS
# ====================================
@dataclass
class GuildMusicState:
    guild_id: int
    bot: "MusicBot"
    channel_id: Optional[int] = None
    message_id: Optional[int] = None
    voice_channel_id: Optional[int] = None
    status_message: Optional[discord.Message] = None
    current_track_req: Optional[TrackRequest] = None
    
    # Playback Modifiers
    autoplay_enabled: bool = False
    shuffle_enabled: bool = False
    loop_mode: str = "off" # "off", "playlist", "song"
    
    is_stopping: bool = False
    skip_requested: bool = False # Flag to bypass loop when user forces skip
    
    # Vote skip memory per track
    skip_votes: Set[int] = field(default_factory=set)
    
    _playback_lock: Optional[asyncio.Lock] = field(default=None, init=False)
    queue: QueueManager = field(init=False)
    updater_task: Optional[asyncio.Task] = field(default=None, init=False)
    
    # UI Rate Limit Protection
    last_ui_update: float = 0.0
    ui_update_pending: bool = False

    @property
    def playback_lock(self) -> asyncio.Lock:
        if self._playback_lock is None:
            self._playback_lock = asyncio.Lock()
        return self._playback_lock

    def __post_init__(self):
        self.queue = QueueManager(self.bot, self.guild_id)

    @property
    def dj_lockdown(self) -> bool:
        settings = self.bot.persistence.load_settings(self.guild_id)
        return settings.get("dj_lockdown", False)


class SpotifyResolver:
    def __init__(self, client_id: Optional[str], client_secret: Optional[str]):
        self.enabled = bool(client_id and client_secret)
        if self.enabled:
            auth_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
            self.sp = spotipy.Spotify(auth_manager=auth_manager)
            logger.info("SpotifyResolver initialized successfully.")
        else:
            self.sp = None
            logger.warning("Spotify API keys missing. Spotify resolution is disabled.")

    def is_spotify_url(self, query: str) -> bool:
        return "spotify.com" in query or "spotify.link" in query

    def _fetch_track_sync(self, query: str) -> str:
        if not self.enabled:
            raise RuntimeError("Spotify API is not configured.")
        if any(x in query for x in ["/playlist/", "/album/", "/show/", "/episode/", "/artist/"]):
            raise ValueError("Playlists, albums, and artists are not currently supported via direct link. Please search by name.")
        if "/track/" not in query:
            raise ValueError("Invalid or unsupported Spotify link.")
        track_info = self.sp.track(query)
        return f"{track_info['name']} {track_info['artists'][0]['name']}"

    async def resolve(self, query: str) -> str:
        return await asyncio.to_thread(self._fetch_track_sync, query)

class LyricsResolver:
    """Handles falling back through multiple lyrics providers smoothly."""
    def __init__(self):
        self.genius_token = os.getenv('GENIUS_ACCESS_TOKEN')

    async def get_lyrics(self, query: str) -> Optional[tuple[str, str]]:
        # Step 1: LRCLib (Highly reliable, clean plain text)
        lyrics = await self._fetch_lrclib(query)
        if lyrics: return (lyrics, "LRCLib")
        
        # Step 2: Musixmatch Fallback Placeholder
        lyrics = await self._fetch_musixmatch(query)
        if lyrics: return (lyrics, "Musixmatch")
        
        # Step 3: Genius API Fallback
        if self.genius_token:
            lyrics = await self._fetch_genius(query)
            if lyrics: return (lyrics, "Genius")
            
        return None

    async def _fetch_lrclib(self, query: str) -> Optional[str]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get("https://lrclib.net/api/search", params={"q": query}) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data and len(data) > 0:
                            return data[0].get("plainLyrics")
        except Exception as e:
            logger.error(f"LRCLib fetch failed: {e}")
        return None

    async def _fetch_musixmatch(self, query: str) -> Optional[str]:
        # Fallback stub. Direct scraping is heavily blocked, safely skipped.
        return None

    async def _fetch_genius(self, query: str) -> Optional[str]:
        try:
            headers = {"Authorization": f"Bearer {self.genius_token}"}
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.genius.com/search", params={"q": query}, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        hits = data.get("response", {}).get("hits", [])
                        if hits:
                            url = hits[0]["result"]["url"]
                            async with session.get(url) as page_resp:
                                if page_resp.status == 200:
                                    html = await page_resp.text()
                                    # Locate the specific react container Genius uses for lyrics
                                    containers = re.findall(r'<div data-lyrics-container="true"[^>]*>(.*?)</div>', html)
                                    if containers:
                                        text = "\n".join(containers)
                                        text = re.sub(r'<br/?>', '\n', text)
                                        text = re.sub(r'<[^>]+>', '', text)
                                        return text
        except Exception as e:
            logger.error(f"Genius fetch failed: {e}")
        return None


class MusicManager:
    def __init__(self, bot: "MusicBot"):
        self.bot = bot
        self.states: Dict[int, GuildMusicState] = {}
        
        client_id = os.getenv('SPOTIPY_CLIENT_ID')
        client_secret = os.getenv('SPOTIPY_CLIENT_SECRET')
        self.spotify = SpotifyResolver(client_id, client_secret)
        self.lyrics = LyricsResolver()

    def get_state(self, guild_id: int) -> GuildMusicState:
        if guild_id not in self.states:
            state = GuildMusicState(guild_id=guild_id, bot=self.bot)
            
            p_data = self.bot.persistence.load_persistence(guild_id)
            state.channel_id = p_data.get("channel_id")
            state.message_id = p_data.get("message_id")
            state.voice_channel_id = p_data.get("voice_channel_id")
            
            self.states[guild_id] = state
        return self.states[guild_id]

    async def get_next_track(self, state: GuildMusicState) -> Optional[TrackRequest]:
        req = await state.queue.dequeue()
        state.current_track_req = req
        state.skip_votes.clear()  # Clear votes for the new track
        
        p_data = self.bot.persistence.load_persistence(state.guild_id)
        if req:
            t_data = extract_track_payload(req.track)
            p_data["current_track"] = {
                "data": t_data,
                "uri": req.track.uri or req.track.title,
                "requester_id": getattr(req.requester, "id", None),
                "uid": req.uid
            }
        else:
            p_data.pop("current_track", None)
        self.bot.persistence.save_persistence(state.guild_id, p_data)
        
        return req


# ====================================
# PERMISSION LEVEL CHECKER (RBAC)
# ====================================
def get_user_level(bot: "MusicBot", member: discord.Member) -> int:
    """
    Evaluates integer role permission hierarchy:
    0 = Full System Administrator (Owner / Server Admin)
    1 = Music Administrator
    2 = DJ / Track Manager
    1000 = Regular Member / Listener
    """
    if member.id == bot.owner_id:
        return 0
    if member == member.guild.owner:
        return 0
    if member.guild_permissions.administrator:
        return 0
        
    settings = bot.persistence.load_settings(member.guild.id)
    role_map = settings.get("roles", {})
    
    highest_p = 1000
    for role in member.roles:
        r_str = str(role.id)
        if r_str in role_map:
            level = int(role_map[r_str])
            if level < highest_p:
                highest_p = level
                
    return highest_p

def is_authorized(level: int):
    """Decorator ensuring a user reaches the targeted permission level or throws CheckFailure."""
    async def predicate(ctx: commands.Context):
        u_level = get_user_level(ctx.bot, ctx.author)
        
        # Check lockdown constraints
        state = ctx.bot.music_manager.get_state(ctx.guild.id)
        if state.dj_lockdown and u_level >= 10:
            raise commands.CheckFailure("DJ Lockdown Mode is active. Only DJs and Admins can change the music right now.")
            
        if u_level <= level:
            return True
            
        raise commands.CheckFailure("You don't have the required permission to use this command.")
    return commands.check(predicate)


# ====================================
# SESSION RESTORE HANDLER
# ====================================
async def restore_sessions(bot: "MusicBot"):
    logger.info("Initializing session restore scan...")
    if not os.path.exists(bot.persistence.base_dir):
        return
        
    for guild_str in os.listdir(bot.persistence.base_dir):
        if not guild_str.isdigit(): continue
        guild_id = int(guild_str)
        p_data = bot.persistence.load_persistence(guild_id)
        vc_id = p_data.get("voice_channel_id")
        
        if vc_id:
            logger.info(f"Dispatching restore_guild task for Guild {guild_id}")
            bot.loop.create_task(restore_guild(bot, guild_id, vc_id, p_data))

async def restore_guild(bot: "MusicBot", guild_id: int, vc_id: int, p_data: dict):
    guild = bot.get_guild(guild_id)
    retries = 0
    while not guild and retries < 5:
        await asyncio.sleep(2)
        guild = bot.get_guild(guild_id)
        retries += 1
        
    if not guild or (guild.voice_client and guild.voice_client.is_connected()): return
    
    vc = guild.get_channel(vc_id)
    if not vc:
        try: vc = await bot.fetch_channel(vc_id)
        except discord.NotFound: pass
    if not vc: return
    
    try:
        player = await vc.connect(cls=wavelink.Player)
        state = bot.music_manager.get_state(guild_id)
        state.voice_channel_id = vc_id
        
        saved_queue = p_data.get("queue", [])
        current_track = p_data.get("current_track")
        
        await state.queue.clear()
        items_to_restore = ([current_track] if current_track else []) + saved_queue
        
        valid_tracks = []
        if items_to_restore:
            for item in items_to_restore:
                track_data = item.get("data")
                uri = item.get("uri")
                track = None
                try:
                    if track_data:
                        if hasattr(wavelink.Playable, 'from_dict'):
                            track = wavelink.Playable.from_dict(track_data)
                        else:
                            track = wavelink.Playable(track_data)
                    if not track and uri:
                        tracks = await wavelink.Playable.search(uri)
                        if tracks: track = tracks[0]
                    if track:
                        req_id = item.get("requester_id")
                        requester = guild.get_member(req_id) or bot.user
                        uid = item.get("uid") or generate_uid()
                        valid_tracks.append(TrackRequest(track=track, requester=requester, uid=uid))
                except Exception as e:
                    logger.error(f"Failed to restore track {uri}: {e}")
                    
            if valid_tracks:
                async with state.queue._lock:
                    state.queue._queue.extend(valid_tracks)
                    state.queue._save()
                    
            if not state.queue.is_empty and not player.playing:
                next_req = await bot.music_manager.get_next_track(state)
                if next_req: await player.play(next_req.track)
            
            if state.channel_id:
                text_channel = guild.get_channel(state.channel_id)
                if text_channel:
                    try: await text_channel.send(f"Welcome back! I found an unfinished queue with {len(valid_tracks)} songs, so I'm resuming playback in {vc.name}.", delete_after=20.0)
                    except discord.HTTPException: pass
                    
        EmbedManager.start_updater(bot, guild_id)
        await update_rich_presence(bot)
    except Exception as e:
        logger.error(f"Failed to restore session for {guild_id}: {e}", exc_info=True)


# ====================================
# UI & EMBED MANAGEMENT
# ====================================
class EmbedManager:
    @staticmethod
    def format_time(ms: int) -> str:
        seconds = ms // 1000
        mins, secs = divmod(seconds, 60)
        hours, mins = divmod(mins, 60)
        if hours > 0: return f"{hours:02}:{mins:02}:{secs:02}"
        return f"{mins:02}:{secs:02}"

    @staticmethod
    def create_progress_bar(position: int, length: int, size: int = 10) -> str:
        if length == 0: return f"{Icons.BAR_START}{Icons.BAR_PLAYHEAD}{Icons.BAR_EMPTY * (size - 1)}{Icons.BAR_END}"
        progress = position / length
        filled_count = max(0, min(size - 1, int(progress * size)))
        return f"{Icons.BAR_START}{Icons.BAR_FILLED * filled_count}{Icons.BAR_PLAYHEAD}{Icons.BAR_EMPTY * (size - 1 - filled_count)}{Icons.BAR_END}"

    @staticmethod
    def get_embed(bot: "MusicBot", guild_id: int, player: Optional[wavelink.Player]) -> discord.Embed:
        if player and player.current:
            track = player.current
            if track.is_stream:
                progress_str = f"閥 **LIVE** | `{EmbedManager.format_time(player.position)}`"
            else:
                bar = EmbedManager.create_progress_bar(player.position, track.length)
                progress_str = f"{bar} {EmbedManager.format_time(player.position)} / {EmbedManager.format_time(track.length)}"

            title = f"{Icons.MUSIC} Paused" if player.paused else f"{Icons.MUSIC} Now Playing"
            embed = discord.Embed(title=title, description=f"**{track.title}**\nby {track.author}\n\n{Icons.CD} {progress_str}", color=discord.Color.green())
            
            artwork = track.artwork or (f"https://img.youtube.com/vi/{track.identifier}/maxresdefault.jpg" if track.source == 'youtube' else None)
            if artwork: embed.set_thumbnail(url=artwork)
            return embed
        else:
            settings = bot.persistence.load_settings(guild_id)
            prefix = settings.get("prefix", os.getenv('BOT_PREFIX', 'h!'))
            return discord.Embed(title="Playback Paused", description=f"Ready to play music. Use `/play` or `{prefix}play` to start.", color=discord.Color.greyple())

    @staticmethod
    async def _execute_update(bot: "MusicBot", guild_id: int):
        """The actual function that talks to the Discord API."""
        state = bot.music_manager.get_state(guild_id)

        if not state.channel_id or not state.message_id: return
        guild = bot.get_guild(guild_id)
        if not guild: return
        channel = guild.get_channel(state.channel_id)
        if not channel: return

        player = guild.voice_client
        embed = EmbedManager.get_embed(bot, guild_id, player)
        view = PlaybackControls(state)

        try:
            if state.status_message:
                try:
                    await state.status_message.edit(embed=embed, view=view)
                    return
                except discord.NotFound:
                    state.status_message = None

            message = await channel.fetch_message(state.message_id)
            state.status_message = message
            await message.edit(embed=embed, view=view)
        except (discord.NotFound, discord.HTTPException):
            pass
        except Exception as e: 
            logger.error(f"Failed to update status UI: {e}")

    @staticmethod
    async def update_status_message(bot: "MusicBot", guild_id: int):
        """Gatekeeper that enforces a hard cooldown and discards redundant updates."""
        state = bot.music_manager.get_state(guild_id)
        now = time.time()
        
        # If we updated in the last 3 seconds, discard this request entirely to avoid 429 rate limit bans
        if now - state.last_ui_update < 3.0:
            return

        # If a task is already running, skip this one
        if state.ui_update_pending:
            return

        state.ui_update_pending = True
        try:
            await EmbedManager._execute_update(bot, guild_id)
        finally:
            state.last_ui_update = time.time()
            state.ui_update_pending = False

    @staticmethod
    def start_updater(bot: "MusicBot", guild_id: int):
        state = bot.music_manager.get_state(guild_id)
        EmbedManager.stop_updater(bot, guild_id)
        async def updater():
            try:
                while True:
                    await asyncio.sleep(7)
                    guild = bot.get_guild(guild_id)
                    if not guild or not guild.voice_client: break
                    player = guild.voice_client
                    if player.playing and not player.paused:
                        await EmbedManager.update_status_message(bot, guild_id)
            except asyncio.CancelledError: pass
        state.updater_task = bot.loop.create_task(updater())

    @staticmethod
    def stop_updater(bot: "MusicBot", guild_id: int):
        state = bot.music_manager.get_state(guild_id)
        if state.updater_task and not state.updater_task.done(): state.updater_task.cancel()


async def send_temp_reply(interaction: discord.Interaction, content: str):
    try:
        if not interaction.response.is_done():
            await interaction.response.send_message(content, ephemeral=True)
            msg = await interaction.original_response()
        else:
            msg = await interaction.followup.send(content, ephemeral=True, wait=True)
        await asyncio.sleep(3.0)
        if msg and interaction.message and msg.id != interaction.message.id: await msg.delete()
    except: pass


class PlaybackControls(discord.ui.View):
    def __init__(self, state: Optional[GuildMusicState] = None):
        super().__init__(timeout=None)
        if state: self.sync_buttons(state)

    def sync_buttons(self, state: GuildMusicState):
        for child in self.children:
            if getattr(child, "custom_id", None) == "playback_autoplay":
                child.label = f"Autoplay: {'ON' if state.autoplay_enabled else 'OFF'}"
                child.emoji = Icons.AUTOPLAY
                child.style = discord.ButtonStyle.success if state.autoplay_enabled else discord.ButtonStyle.secondary
            elif getattr(child, "custom_id", None) == "playback_shuffle":
                child.emoji = Icons.SHUFFLE 
                child.style = discord.ButtonStyle.success if state.shuffle_enabled else discord.ButtonStyle.secondary
            elif getattr(child, "custom_id", None) == "playback_loop":
                if state.loop_mode == "off":
                    child.label = "Loop: OFF"
                    child.emoji = Icons.REPEAT_OFF
                    child.style = discord.ButtonStyle.secondary
                elif state.loop_mode == "playlist":
                    child.label = "Loop: Playlist"
                    child.emoji = Icons.REPEAT
                    child.style = discord.ButtonStyle.success
                elif state.loop_mode == "song":
                    child.label = "Loop: Song"
                    child.emoji = Icons.REPEAT_ONE
                    child.style = discord.ButtonStyle.success

    @discord.ui.button(label="Skip", style=discord.ButtonStyle.primary, custom_id="playback_skip", emoji=Icons.SKIP)
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        u_level = get_user_level(bot, interaction.user)
        state = bot.music_manager.get_state(interaction.guild_id)
        
        if state.dj_lockdown and u_level >= 10:
            return await send_temp_reply(interaction, "白 DJ Lockdown Mode is active. Only DJs and Admins can change the music right now.")

        player = interaction.guild.voice_client
        if not player or not player.playing:
            return await send_temp_reply(interaction, "Nothing is playing.")

        if u_level <= 1:
            state.skip_requested = True
            await player.skip(force=True)
            await send_temp_reply(interaction, f"{Icons.SKIP} An Admin skipped the song.")
        else:
            if not interaction.user.voice or interaction.user.voice.channel != interaction.guild.me.voice.channel:
                return await send_temp_reply(interaction, f"{Icons.ERROR} You need to be in my voice channel to vote to skip!")
                
            state.skip_votes.add(interaction.user.id)
            listeners = len([m for m in interaction.guild.me.voice.channel.members if not m.bot])
            settings = bot.persistence.load_settings(interaction.guild_id)
            pct = settings.get("vote_percentage", 75)
            required = max(1, math.ceil(listeners * (pct / 100)))
            
            if len(state.skip_votes) >= required:
                state.skip_requested = True
                await player.skip(force=True)
                await interaction.channel.send(f"{Icons.SKIP} Enough votes reached ({len(state.skip_votes)}/{required}). Skipping!")
            else:
                await send_temp_reply(interaction, f"Voted to skip! ({len(state.skip_votes)}/{required} votes needed).")

    @discord.ui.button(label="Stop", style=discord.ButtonStyle.danger, custom_id="playback_stop", emoji=Icons.STOP)
    async def stop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        u_level = get_user_level(bot, interaction.user)
        if u_level > 0:
            return await send_temp_reply(interaction, f"{Icons.ERROR} Only Administrators can stop the bot.")
            
        state = bot.music_manager.get_state(interaction.guild_id)
        async with state.playback_lock:
            state.is_stopping = True
            state.autoplay_enabled = False
            state.shuffle_enabled = False
            state.loop_mode = "off"
            state.skip_requested = True
            await state.queue.clear()
            state.voice_channel_id = None
            
            p_data = bot.persistence.load_persistence(interaction.guild_id)
            p_data["voice_channel_id"] = None
            p_data["current_track"] = None
            bot.persistence.save_persistence(interaction.guild_id, p_data)
            
            player = interaction.guild.voice_client
            if player:
                try:
                    await player.disconnect()
                    EmbedManager.stop_updater(bot, interaction.guild_id)
                    interaction.client.loop.create_task(send_temp_reply(interaction, f"{Icons.STOP} Stopped playing and cleared the queue."))
                    await update_rich_presence(bot)
                except Exception as e:
                    logger.error(f"Stop Error: {e}", exc_info=True)
            else:
                interaction.client.loop.create_task(send_temp_reply(interaction, "Nothing is currently playing."))
            state.is_stopping = False
        await EmbedManager.update_status_message(bot, interaction.guild_id)

    @discord.ui.button(label="Autoplay", style=discord.ButtonStyle.secondary, custom_id="playback_autoplay", emoji=Icons.AUTOPLAY)
    async def autoplay_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        u_level = get_user_level(bot, interaction.user)
        state = bot.music_manager.get_state(interaction.guild_id)
        
        if state.dj_lockdown and u_level >= 10:
            return await send_temp_reply(interaction, "白 DJ Lockdown Mode is active.")
        if u_level > 2:
            return await send_temp_reply(interaction, f"{Icons.ERROR} Only DJs or Admins can toggle autoplay.")

        async with state.playback_lock:
            state.autoplay_enabled = not state.autoplay_enabled
            if state.autoplay_enabled:
                state.loop_mode = "off"
                
            player = interaction.guild.voice_client
            if player and state.queue.is_empty:
                player.autoplay = wavelink.AutoPlayMode.enabled if state.autoplay_enabled else wavelink.AutoPlayMode.partial

        await EmbedManager.update_status_message(bot, interaction.guild_id)
        await send_temp_reply(interaction, f"Autoplay is now **{'ON' if state.autoplay_enabled else 'OFF'}**.")

    @discord.ui.button(label="Shuffle", style=discord.ButtonStyle.secondary, custom_id="playback_shuffle", emoji=Icons.SHUFFLE)
    async def shuffle_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        u_level = get_user_level(bot, interaction.user)
        state = bot.music_manager.get_state(interaction.guild_id)
        
        if state.dj_lockdown and u_level >= 10:
            return await send_temp_reply(interaction, "白 DJ Lockdown Mode is active.")
        if u_level > 2:
            return await send_temp_reply(interaction, f"{Icons.ERROR} Only DJs or Admins can shuffle.")

        async with state.playback_lock:
            state.shuffle_enabled = not state.shuffle_enabled
            if state.shuffle_enabled: await state.queue.shuffle()

        await EmbedManager.update_status_message(bot, interaction.guild_id)
        await send_temp_reply(interaction, f"Queue Shuffled.")

    @discord.ui.button(label="Loop: OFF", style=discord.ButtonStyle.secondary, custom_id="playback_loop")
    async def loop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        u_level = get_user_level(bot, interaction.user)
        state = bot.music_manager.get_state(interaction.guild_id)
        
        if state.dj_lockdown and u_level >= 10:
            return await send_temp_reply(interaction, "白 DJ Lockdown Mode is active.")
        if u_level > 2:
            return await send_temp_reply(interaction, f"{Icons.ERROR} Only DJs or Admins can toggle loop.")

        async with state.playback_lock:
            if state.loop_mode == "off":
                state.loop_mode = "playlist"
                state.autoplay_enabled = False
            elif state.loop_mode == "playlist":
                state.loop_mode = "song"
                state.autoplay_enabled = False
            else:
                state.loop_mode = "off"
            
            player = interaction.guild.voice_client
            if player and not state.autoplay_enabled:
                player.autoplay = wavelink.AutoPlayMode.partial

        await EmbedManager.update_status_message(bot, interaction.guild_id)
        await send_temp_reply(interaction, f"Loop mode set to **{state.loop_mode.capitalize()}**.")


class QueuePaginator(discord.ui.View):
    def __init__(self, queue: List[TrackRequest], title: str = f"{Icons.MUSIC} Current Queue", is_ephemeral: bool = False):
        super().__init__(timeout=180)
        self.queue = queue
        self.title = title
        self.current_page = 1
        self.per_page = 10
        self.total_pages = max(1, (len(self.queue) - 1) // self.per_page + 1) if self.queue else 1
        
        if is_ephemeral:
            for child in self.children:
                if getattr(child, "custom_id", None) == "queue_close":
                    self.remove_item(child)
                    break
                    
        self.update_buttons()

    def update_buttons(self):
        for child in self.children:
            if child.custom_id in ("queue_first", "queue_prev"): child.disabled = self.current_page <= 1
            elif child.custom_id in ("queue_next", "queue_last"): child.disabled = self.current_page >= self.total_pages

    def generate_embed(self) -> discord.Embed:
        embed = discord.Embed(title=self.title, color=discord.Color.blurple())
        if not self.queue:
            embed.description = f"{Icons.EMPTY} The queue is empty."
            return embed
        start_idx = (self.current_page - 1) * self.per_page
        page_items = self.queue[start_idx:start_idx+self.per_page]
        desc = ""
        for idx, req in enumerate(page_items, start=start_idx + 1):
            link = f"[{req.track.title}]({req.track.uri})" if req.track.uri else req.track.title
            desc += f"`[{req.uid}]` **{idx}.** {link}\n{Icons.USER} {req.track.author} | Added by: {req.requester.mention}\n\n"
        embed.description = desc
        embed.set_footer(text=f"Page {self.current_page}/{self.total_pages} | Total Tracks: {len(self.queue)}")
        return embed

    @discord.ui.button(label="First", style=discord.ButtonStyle.secondary, custom_id="queue_first", emoji=Icons.FIRST)
    async def first_button(self, interaction, button):
        self.current_page = 1
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)

    @discord.ui.button(label="Previous", style=discord.ButtonStyle.secondary, custom_id="queue_prev", emoji=Icons.PREV)
    async def prev_button(self, interaction, button):
        self.current_page -= 1
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)

    @discord.ui.button(label="Close", style=discord.ButtonStyle.danger, custom_id="queue_close", emoji=Icons.CLOSE)
    async def close_button(self, interaction, button):
        try:
            await interaction.message.delete()
        except discord.HTTPException:
            pass
        self.stop()

    @discord.ui.button(label="Next", style=discord.ButtonStyle.secondary, custom_id="queue_next", emoji=Icons.NEXT)
    async def next_button(self, interaction, button):
        self.current_page += 1
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)

    @discord.ui.button(label="Last", style=discord.ButtonStyle.secondary, custom_id="queue_last", emoji=Icons.LAST)
    async def last_button(self, interaction, button):
        self.current_page = self.total_pages
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)

class LyricsPaginator(discord.ui.View):
    """Paginator specifically designed to handle long lyrics split into multiple pages."""
    def __init__(self, pages: List[str], title: str = "Lyrics", source: str = "Unknown", is_ephemeral: bool = False):
        super().__init__(timeout=180)
        self.pages = pages
        self.title = title
        self.source = source
        self.current_page = 1
        self.total_pages = max(1, len(self.pages))
        
        if is_ephemeral:
            for child in self.children:
                if getattr(child, "custom_id", None) == "lyrics_close":
                    self.remove_item(child)
                    break
                    
        self.update_buttons()

    def update_buttons(self):
        for child in self.children:
            if child.custom_id in ("lyrics_prev"): child.disabled = self.current_page <= 1
            elif child.custom_id in ("lyrics_next"): child.disabled = self.current_page >= self.total_pages

    def generate_embed(self) -> discord.Embed:
        embed = discord.Embed(title=self.title, description=self.pages[self.current_page - 1], color=discord.Color.blurple())
        embed.set_footer(text=f"Page {self.current_page}/{self.total_pages} 窶｢ Source: {self.source}")
        return embed

    @discord.ui.button(label="Previous", style=discord.ButtonStyle.secondary, custom_id="lyrics_prev", emoji=Icons.PREV)
    async def prev_button(self, interaction, button):
        self.current_page -= 1
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)

    @discord.ui.button(label="Close", style=discord.ButtonStyle.danger, custom_id="lyrics_close", emoji=Icons.CLOSE)
    async def close_button(self, interaction, button):
        try:
            await interaction.message.delete()
        except discord.HTTPException:
            pass
        self.stop()

    @discord.ui.button(label="Next", style=discord.ButtonStyle.secondary, custom_id="lyrics_next", emoji=Icons.NEXT)
    async def next_button(self, interaction, button):
        self.current_page += 1
        self.update_buttons()
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)


# ====================================
# RICH PRESENCE HANDLER
# ====================================
async def update_rich_presence(bot: commands.Bot):
    try:
        playing_tracks = [vc.current.title for vc in bot.voice_clients if isinstance(vc, wavelink.Player) and vc.playing and vc.current]
        if not playing_tracks:
            await bot.change_presence(activity=None)
            return
        status_text = ", ".join(playing_tracks)
        if len(status_text) > 128: status_text = status_text[:125] + "..."
        await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.listening, name=status_text))
    except Exception as e: logger.error(f"Presence update error: {e}")


# ====================================
# BOT CORE CLASS
# ====================================
class HikariContext(commands.Context):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._invocation_deleted = False

    async def send(self, content=None, **kwargs):
        if self.interaction is None:
            if not self._invocation_deleted and self.message:
                try: await self.message.delete()
                except: pass
                self._invocation_deleted = True
            if kwargs.pop('ephemeral', False) and 'delete_after' not in kwargs:
                kwargs['delete_after'] = 3.0
        return await super().send(content, **kwargs)


async def get_dynamic_prefix(bot: "MusicBot", message: discord.Message):
    if not message.guild: return os.getenv('BOT_PREFIX', 'h!')
    return bot.persistence.load_settings(message.guild.id).get("prefix", os.getenv('BOT_PREFIX', 'h!') )


class MusicBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.voice_states = True
        super().__init__(command_prefix=get_dynamic_prefix, intents=intents, owner_id=639906782658953256)
        self.persistence = PersistenceManager()
        self.music_manager = MusicManager(self)
        self.api_runner = None
        self.db_pool = None

    async def get_context(self, message: discord.Message, *, cls=None):
        return await super().get_context(message, cls=cls or HikariContext)

    async def setup_hook(self):
        host = os.getenv('LAVALINK_HOST', '127.0.0.1')
        node = wavelink.Node(uri=f'http://{host}:2333', password='youshallnotpass')
        await wavelink.Pool.connect(nodes=[node], client=self, cache_capacity=100)
        self.add_view(PlaybackControls())
        logger.info("Wavelink nodes configured and persistent UI views registered.")
        
        # Initialize MariaDB Connection Pool
        try:
            self.db_pool = await aiomysql.create_pool(
                host=os.getenv('DB_HOST', 'db'),
                user=os.getenv('DB_USER', 'hikari_user'),
                password=os.getenv('DB_PASSWORD', 'your_strong_user_password'),
                db=os.getenv('DB_NAME', 'hikari_music'),
                autocommit=True
            )
            logger.info("MariaDB Connection Pool initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize MariaDB Connection Pool: {e}")
            self.db_pool = None

        # Start the REST API cleanly as a parasitic background task
        self.loop.create_task(self._safe_start_api_server())

    async def _safe_start_api_server(self):
        """Safe wrapper to ensure the API Server failing doesn't crash the bot loop."""
        try:
            await self.start_api_server()
        except Exception as e:
            logger.error(f"REST API server failed to start or crashed: {e}", exc_info=True)

    # ---------------------------------------------------------
    # REST API HANDLERS
    # ---------------------------------------------------------
    async def start_api_server(self):
        """Starts the aiohttp web server running alongside the bot loop."""
        app = web.Application()
        
        # Base Data Endpoints
        app.router.add_route('*', '/api/status', self.api_get_global_status)
        app.router.add_route('*', '/api/status/{guild_id}', self.api_get_status)
        app.router.add_route('*', '/api/lyrics', self.api_get_lyrics)
        
        # Authentication Endpoint
        app.router.add_route('*', '/api/token', self.api_token)
        
        # Control Endpoints (Mapped explicitly to bot commands)
        for cmd in ['play', 'playnext', 'forceplay', 'skip', 'stop', 'clearqueue', 'remove', 'shuffle', 'autoplay', 'loop', 'filter', 'movevc', 'seek', 'toggleplayback', 'favadd', 'search', 'favorites']:
            app.router.add_route('*', f'/api/{cmd}', getattr(self, f'api_{cmd}'))
        
        # Handle CORS preflight for all endpoints
        async def cors_handler(request): 
            return web.Response(headers={
                "Access-Control-Allow-Origin": "*", 
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", 
                "Access-Control-Allow-Headers": "Content-Type"
            })
        app.router.add_options('/{tail:.*}', cors_handler)
        
        self.api_runner = web.AppRunner(app)
        await self.api_runner.setup()
        port = int(os.getenv("API_PORT", 8080))
        name = os.getenv("API_NAME", '0.0.0.0')
        site = web.TCPSite(self.api_runner, name, port)
        await site.start()
        logger.info(f"API Server listening on {name}:{port}")

    async def get_api_data(self, request: web.Request) -> dict:
        """Extracts JSON body or query parameters dynamically."""
        data = dict(request.query)
        if request.can_read_body:
            try:
                json_data = await request.json()
                if isinstance(json_data, dict):
                    data.update(json_data)
            except Exception:
                pass
        return data

    async def api_token(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        code = data.get('code')
        
        if not code:
            return web.json_response({"error": "Missing authorization code"}, status=400, headers=headers)

        client_id = os.getenv('DISCORD_CLIENT_ID')
        client_secret = os.getenv('DISCORD_CLIENT_SECRET')

        if not client_id or not client_secret:
            logger.error("Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in environment variables.")
            return web.json_response({"error": "OAuth credentials not configured on server"}, status=500, headers=headers)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://discord.com/api/oauth2/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "authorization_code",
                    "code": code,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            ) as resp:
                token_data = await resp.json()
                
                if "access_token" in token_data:
                    return web.json_response({"access_token": token_data["access_token"]}, headers=headers)
                else:
                    logger.error(f"Failed to exchange token with Discord: {token_data}")
                    return web.json_response({"error": "Failed to exchange token", "details": token_data}, status=400, headers=headers)

    async def api_get_global_status(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        return web.json_response({
            "status": "online",
            "latency_ms": round(self.latency * 1000) if self.latency else 0,
            "guilds_active": len(self.music_manager.states)
        }, headers=headers)

    async def api_get_status(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        guild_id = int(request.match_info.get('guild_id', 0))
        
        if guild_id not in self.music_manager.states:
            return web.json_response({"error": "Guild not active or found."}, status=404, headers=headers)
            
        state = self.music_manager.get_state(guild_id)
        guild = self.get_guild(guild_id)
        player = guild.voice_client if guild else None
        
        queue_data = []
        for req in list(state.queue._queue):
            queue_data.append({
                "title": req.track.title,
                "author": req.track.author,
                "uri": req.track.uri,
                "length": req.track.length,
                "requester": str(req.requester),
                "uid": req.uid
            })
            
        current_data = None
        if player and player.current:
            current_data = {
                "title": player.current.title,
                "author": player.current.author,
                "uri": player.current.uri,
                "length": player.current.length,
                "position": player.position,
                "is_paused": player.paused
            }
            
        return web.json_response({
            "guild_id": guild_id,
            "connected_channel": state.voice_channel_id,
            "volume": player.volume if player else 100,
            "autoplay": state.autoplay_enabled,
            "shuffle": state.shuffle_enabled,
            "loop_mode": state.loop_mode,
            "dj_lockdown": state.dj_lockdown,
            "current_track": current_data,
            "queue": queue_data
        }, headers=headers)

    async def api_get_lyrics(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        query = data.get('q') or data.get('query')
        guild_id = data.get('guild_id')

        if not query and guild_id:
            if int(guild_id) not in self.music_manager.states:
                return web.json_response({"error": "Guild not active."}, status=404, headers=headers)
            guild = self.get_guild(int(guild_id))
            player = guild.voice_client if guild else None
            if not player or not player.current:
                return web.json_response({"error": "No music currently playing."}, status=400, headers=headers)
            query = f"{player.current.title} {player.current.author}"

        if not query:
            return web.json_response({"error": "Provide a query or guild_id."}, status=400, headers=headers)

        result = await self.music_manager.lyrics.get_lyrics(query)
        if not result:
            return web.json_response({"error": "Lyrics not found.", "query": query}, status=404, headers=headers)
            
        lyric_text, source = result
        return web.json_response({"query": query, "source": source, "lyrics": lyric_text}, headers=headers)

    async def api_search(self, request: web.Request):
        """Proxies search requests securely to the internal Lavalink container."""
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        query = data.get('q') or data.get('query')
        
        if not query:
            return web.json_response({"error": "Missing query parameter 'q'"}, status=400, headers=headers)
            
        host = os.getenv('LAVALINK_HOST', '127.0.0.1')
        password = 'youshallnotpass'
        
        async def fetch_lavalink(identifier):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"http://{host}:2333/v4/loadtracks",
                        params={"identifier": identifier},
                        headers={"Authorization": password}
                    ) as resp:
                        if resp.status == 200:
                            return await resp.json()
            except Exception as e:
                logger.error(f"Lavalink fetch error for {identifier}: {e}")
            return None

        def extract_tracks(payload):
            if not payload: return []
            data = payload.get('data')
            if isinstance(data, list): return data
            if isinstance(data, dict) and 'tracks' in data: return data['tracks']
            if isinstance(data, dict) and 'info' in data: return [data] # Single track fallback
            return []

        try:
            # If it's a URL, a direct lavalink prefix, or a recommendation request, pass it straight through
            if query.startswith(('ytsearch:', 'scsearch:', 'ytrec:', 'http://', 'https://')):
                res = await fetch_lavalink(query)
                return web.json_response({"data": extract_tracks(res)}, headers=headers)
            
            # HYBRID SEARCH: Run YouTube and SoundCloud searches simultaneously
            yt_res, sc_res = await asyncio.gather(
                fetch_lavalink(f"ytsearch:{query}"),
                fetch_lavalink(f"scsearch:{query}")
            )
            
            yt_tracks = extract_tracks(yt_res)
            sc_tracks = extract_tracks(sc_res)
            
            # Interleave the results (1 YT, 1 SC, 1 YT, 1 SC...)
            combined = []
            for yt, sc in zip(yt_tracks, sc_tracks):
                combined.extend([yt, sc])
            
            # Append any remaining tracks if one platform returned more than the other
            diff = len(yt_tracks) - len(sc_tracks)
            if diff > 0:
                combined.extend(yt_tracks[-diff:])
            elif diff < 0:
                combined.extend(sc_tracks[diff:])
                
            return web.json_response({"data": combined}, headers=headers)
            
        except Exception as e:
            logger.error(f"Lavalink proxy search error: {e}")
            return web.json_response({"error": str(e)}, status=500, headers=headers)

    async def api_favorites(self, request: web.Request):
        """Handles GET, POST, and DELETE for user favorites mapped via MariaDB."""
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        discord_id = data.get('discord_id')
        
        if not discord_id:
            return web.json_response({"error": "Missing discord_id"}, status=400, headers=headers)
            
        if not self.db_pool:
            return web.json_response({"error": "Database connection pool not configured"}, status=500, headers=headers)

        if request.method == 'GET':
            try:
                async with self.db_pool.acquire() as conn:
                    async with conn.cursor(aiomysql.DictCursor) as cur:
                        await cur.execute('''
                            SELECT t.* FROM tracks t
                            JOIN user_favorites uf ON t.track_id = uf.track_id
                            WHERE uf.discord_id = %s
                            ORDER BY uf.added_at DESC
                        ''', (discord_id,))
                        rows = await cur.fetchall()
                return web.json_response({"favorites": rows}, headers=headers)
            except Exception as e:
                logger.error(f"Error fetching favorites: {e}")
                return web.json_response({"error": str(e)}, status=500, headers=headers)

        elif request.method == 'POST':
            lavalink_identifier = data.get('lavalink_identifier')
            title = data.get('title', 'Unknown Title')
            author = data.get('author', 'Unknown Author')
            duration_ms = data.get('duration_ms', 0)
            
            if not lavalink_identifier:
                return web.json_response({"error": "Missing lavalink_identifier"}, status=400, headers=headers)
                
            try:
                async with self.db_pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        # Insert track if it doesn't exist
                        await cur.execute('''
                            INSERT INTO tracks (lavalink_identifier, title, author, duration_ms)
                            VALUES (%s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE title=VALUES(title)
                        ''', (lavalink_identifier, title, author, duration_ms))
                        
                        # Grab the generated or existing track_id
                        await cur.execute('SELECT track_id FROM tracks WHERE lavalink_identifier = %s', (lavalink_identifier,))
                        track_res = await cur.fetchone()
                        if not track_res:
                            return web.json_response({"error": "Failed to resolve track ID"}, status=500, headers=headers)
                            
                        track_id = track_res[0]
                        
                        # Link favorite to user
                        await cur.execute('''
                            INSERT IGNORE INTO user_favorites (discord_id, track_id)
                            VALUES (%s, %s)
                        ''', (discord_id, track_id))
                        
                return web.json_response({"success": True, "action": "added"}, headers=headers)
            except Exception as e:
                logger.error(f"Error adding favorite: {e}")
                return web.json_response({"error": str(e)}, status=500, headers=headers)

        elif request.method == 'DELETE':
            lavalink_identifier = data.get('lavalink_identifier')
            track_id = data.get('track_id')
            
            if not lavalink_identifier and not track_id:
                return web.json_response({"error": "Missing track identifier"}, status=400, headers=headers)
                
            try:
                async with self.db_pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        if track_id:
                            await cur.execute('DELETE FROM user_favorites WHERE discord_id = %s AND track_id = %s', (discord_id, track_id))
                        else:
                            await cur.execute('''
                                DELETE uf FROM user_favorites uf
                                JOIN tracks t ON uf.track_id = t.track_id
                                WHERE uf.discord_id = %s AND t.lavalink_identifier = %s
                            ''', (discord_id, lavalink_identifier))
                            
                return web.json_response({"success": True, "action": "deleted"}, headers=headers)
            except Exception as e:
                logger.error(f"Error deleting favorite: {e}")
                return web.json_response({"error": str(e)}, status=500, headers=headers)
                
        else:
            return web.json_response({"error": "Method not allowed"}, status=405, headers=headers)

    async def api_play(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        query = data.get('query')
        
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        if not query: return web.json_response({"error": "Missing query"}, status=400, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        
        if self.music_manager.spotify.is_spotify_url(query):
            if not self.music_manager.spotify.enabled:
                return web.json_response({"error": "Spotify support not enabled"}, status=400, headers=headers)
            query = await self.music_manager.spotify.resolve(query)
            
        tracks = await wavelink.Playable.search(query)
        if not tracks: return web.json_response({"error": "No tracks found"}, status=404, headers=headers)
        
        vc_id = data.get('voice_channel_id') or state.voice_channel_id
        if not vc_id: return web.json_response({"error": "No voice channel provided or active"}, status=400, headers=headers)
        
        player = guild.voice_client
        if not player:
            vc = guild.get_channel(int(vc_id))
            if not vc: return web.json_response({"error": "Voice channel not found"}, status=404, headers=headers)
            player = await vc.connect(cls=wavelink.Player)
            state.voice_channel_id = vc.id
            p_data = self.persistence.load_persistence(guild_id)
            p_data["voice_channel_id"] = vc.id
            self.persistence.save_persistence(guild_id, p_data)
            
        # --- Safe Requester Resolution with fetch_user Fallback ---
        requester_id_raw = data.get('requester_id')
        requester = guild.me
        
        if requester_id_raw:
            try:
                requester_id = int(requester_id_raw)
                # Try cache first, fallback to a direct API fetch if not cached
                requester = guild.get_member(requester_id) or await self.fetch_user(requester_id)
            except (ValueError, TypeError, discord.HTTPException) as e:
                logger.error(f"Failed to resolve requester profile: {e}")
                requester = guild.me
        # ----------------------------------------------------------
        
        async with state.playback_lock:
            if isinstance(tracks, wavelink.Playlist):
                for track in tracks.tracks: await state.queue.enqueue(TrackRequest(track, requester))
                res = {"success": True, "added_playlist": tracks.name}
            else:
                await state.queue.enqueue(TrackRequest(tracks[0], requester))
                res = {"success": True, "added_track": tracks[0].title}
                
            if not player.playing:
                next_req = await self.music_manager.get_next_track(state)
                if next_req:
                    player.autoplay = wavelink.AutoPlayMode.partial
                    await player.play(next_req.track)
                    
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response(res, headers=headers)

    async def api_playnext(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        query = data.get('query')
        
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        if not query: return web.json_response({"error": "Missing query"}, status=400, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        
        if self.music_manager.spotify.is_spotify_url(query):
            if not self.music_manager.spotify.enabled:
                return web.json_response({"error": "Spotify support not enabled"}, status=400, headers=headers)
            query = await self.music_manager.spotify.resolve(query)
            
        tracks = await wavelink.Playable.search(query)
        if not tracks: return web.json_response({"error": "No tracks found"}, status=404, headers=headers)
        
        vc_id = data.get('voice_channel_id') or state.voice_channel_id
        if not vc_id: return web.json_response({"error": "No voice channel provided or active"}, status=400, headers=headers)
        
        player = guild.voice_client
        if not player:
            vc = guild.get_channel(int(vc_id))
            if not vc: return web.json_response({"error": "Voice channel not found"}, status=404, headers=headers)
            player = await vc.connect(cls=wavelink.Player)
            state.voice_channel_id = vc.id
            p_data = self.persistence.load_persistence(guild_id)
            p_data["voice_channel_id"] = vc.id
            self.persistence.save_persistence(guild_id, p_data)
            
        # --- Safe Requester Resolution with fetch_user Fallback ---
        requester_id_raw = data.get('requester_id')
        requester = guild.me
        
        if requester_id_raw:
            try:
                requester_id = int(requester_id_raw)
                # Try cache first, fallback to a direct API fetch if not cached
                requester = guild.get_member(requester_id) or await self.fetch_user(requester_id)
            except (ValueError, TypeError, discord.HTTPException) as e:
                logger.error(f"Failed to resolve requester profile: {e}")
                requester = guild.me
        # ----------------------------------------------------------
        
        async with state.playback_lock:
            if isinstance(tracks, wavelink.Playlist):
                for t in reversed(tracks.tracks): await state.queue.add_to_front(TrackRequest(t, requester))
                res = {"success": True, "added_playlist_next": tracks.name}
            else:
                await state.queue.add_to_front(TrackRequest(tracks[0], requester))
                res = {"success": True, "added_track_next": tracks[0].title}
                
            if not player.playing:
                next_req = await self.music_manager.get_next_track(state)
                if next_req:
                    player.autoplay = wavelink.AutoPlayMode.partial
                    await player.play(next_req.track)
                    
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response(res, headers=headers)

    async def api_forceplay(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        query = data.get('query')
        
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        if not query: return web.json_response({"error": "Missing query"}, status=400, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        
        if self.music_manager.spotify.is_spotify_url(query):
            if not self.music_manager.spotify.enabled:
                return web.json_response({"error": "Spotify support not enabled"}, status=400, headers=headers)
            query = await self.music_manager.spotify.resolve(query)
            
        tracks = await wavelink.Playable.search(query)
        if not tracks: return web.json_response({"error": "No tracks found"}, status=404, headers=headers)
        track = tracks.tracks[0] if isinstance(tracks, wavelink.Playlist) else tracks[0]
        
        vc_id = data.get('voice_channel_id') or state.voice_channel_id
        if not vc_id: return web.json_response({"error": "No voice channel active"}, status=400, headers=headers)
        
        player = guild.voice_client
        if not player:
            vc = guild.get_channel(int(vc_id))
            if not vc: return web.json_response({"error": "Voice channel not found"}, status=404, headers=headers)
            player = await vc.connect(cls=wavelink.Player)
            state.voice_channel_id = vc.id
            p_data = self.persistence.load_persistence(guild_id)
            p_data["voice_channel_id"] = vc.id
            self.persistence.save_persistence(guild_id, p_data)
            
        state.skip_requested = True
        await player.play(track, force=True)
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "force_played": track.title}, headers=headers)

    async def api_skip(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        player = guild.voice_client
        if not player or not player.playing:
            return web.json_response({"error": "Nothing is playing"}, status=400, headers=headers)
            
        state = self.music_manager.get_state(guild_id)
        state.skip_requested = True
        await player.skip(force=True)
        return web.json_response({"success": True, "action": "skipped"}, headers=headers)

    async def api_stop(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        async with state.playback_lock:
            state.is_stopping = True
            state.autoplay_enabled = False
            state.shuffle_enabled = False
            state.loop_mode = "off"
            state.skip_requested = True
            await state.queue.clear()
            state.voice_channel_id = None
            
            p_data = self.persistence.load_persistence(guild_id)
            p_data["voice_channel_id"] = None
            p_data["current_track"] = None
            self.persistence.save_persistence(guild_id, p_data)
            
            player = guild.voice_client
            if player:
                try: 
                    await player.disconnect()
                    EmbedManager.stop_updater(self, guild_id)
                    await update_rich_presence(self)
                except Exception: pass
            state.is_stopping = False
            
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "action": "stopped"}, headers=headers)

    async def api_clearqueue(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        await state.queue.clear()
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "action": "cleared"}, headers=headers)

    async def api_remove(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        uid = data.get('uid')
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        if not uid: return web.json_response({"error": "Missing uid"}, status=400, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        removed = await state.queue.remove_by_uid(uid)
        if removed:
            await EmbedManager.update_status_message(self, guild_id)
            return web.json_response({"success": True, "removed": removed.track.title}, headers=headers)
        return web.json_response({"error": "UID not found in queue"}, status=404, headers=headers)

    async def api_shuffle(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        
        if 'boolean' in data:
            val = str(data['boolean']).lower() in ['true', '1', 'y', 'yes']
        elif 'state' in data:
            val = str(data['state']).lower() in ['true', '1', 'y', 'yes']
        else:
            val = not state.shuffle_enabled

        async with state.playback_lock:
            state.shuffle_enabled = val
            if state.shuffle_enabled: 
                await state.queue.shuffle()

        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "shuffle": state.shuffle_enabled}, headers=headers)

    async def api_autoplay(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        
        if 'boolean' in data:
            val = str(data['boolean']).lower() in ['true', '1', 'y', 'yes']
        elif 'state' in data:
            val = str(data['state']).lower() in ['true', '1', 'y', 'yes']
        else:
            val = not state.autoplay_enabled

        async with state.playback_lock:
            state.autoplay_enabled = val
            if state.autoplay_enabled:
                state.loop_mode = "off"
                
            player = guild.voice_client
            if player and state.queue.is_empty:
                player.autoplay = wavelink.AutoPlayMode.enabled if state.autoplay_enabled else wavelink.AutoPlayMode.partial

        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "autoplay": state.autoplay_enabled}, headers=headers)

    async def api_loop(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        mode = data.get('mode', 'off').lower()
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        if mode not in ['off', 'playlist', 'song']:
            return web.json_response({"error": "Invalid mode"}, status=400, headers=headers)
            
        state = self.music_manager.get_state(guild_id)
        async with state.playback_lock:
            state.loop_mode = mode
            if mode != "off":
                state.autoplay_enabled = False
                player = guild.voice_client
                if player:
                    player.autoplay = wavelink.AutoPlayMode.partial
                    
        await EmbedManager.update_status_message(self, guild_id)
        return web.json_response({"success": True, "loop_mode": state.loop_mode}, headers=headers)

    async def api_filter(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        preset = data.get('preset', 'clear').lower()
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        player = guild.voice_client
        if not player:
            return web.json_response({"error": "Nothing playing"}, status=400, headers=headers)
            
        try:
            filters: wavelink.Filters = player.filters
            filters.reset()
            
            if preset == "bassboost":
                filters.equalizer.set(bands=[
                    {"band": 0, "gain": 0.8}, {"band": 1, "gain": 0.7}, {"band": 2, "gain": 0.5},
                    {"band": 3, "gain": 0.3}, {"band": 4, "gain": 0.1}
                ])
            elif preset == "nightcore":
                filters.timescale.set(speed=1.25, pitch=1.25)
            elif preset == "8d":
                filters.rotation.set(rotation_hz=0.2)
            elif preset == "vaporwave":
                filters.timescale.set(speed=0.8, pitch=0.8)
            elif preset != "clear":
                return web.json_response({"error": "Invalid preset"}, status=400, headers=headers)
                
            await player.set_filters(filters)
            return web.json_response({"success": True, "filter": preset}, headers=headers)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500, headers=headers)

    async def api_movevc(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        channel_id = int(data.get('channel_id', 0))
        
        guild = self.get_guild(guild_id)
        if not guild: return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
        
        if not guild.voice_client:
            return web.json_response({"error": "Not playing music"}, status=400, headers=headers)
            
        channel = guild.get_channel(channel_id)
        if not channel: return web.json_response({"error": "Channel not found"}, status=404, headers=headers)
        
        state = self.music_manager.get_state(guild_id)
        await channel.connect(cls=wavelink.Player)
        state.voice_channel_id = channel.id
        
        p_data = self.persistence.load_persistence(guild_id)
        p_data["voice_channel_id"] = channel.id
        self.persistence.save_persistence(guild_id, p_data)
        
        return web.json_response({"success": True, "moved_to": channel.name}, headers=headers)

    async def api_seek(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        position = data.get('position')
        
        guild = self.get_guild(guild_id)
        if not guild: 
            return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
            
        if position is None:
            return web.json_response({"error": "Missing position parameter"}, status=400, headers=headers)
            
        try:
            position_ms = int(position)
        except ValueError:
            return web.json_response({"error": "Position must be an integer (milliseconds)"}, status=400, headers=headers)
            
        player = guild.voice_client
        if not player or not player.playing or not player.current:
            return web.json_response({"error": "Nothing is playing right now"}, status=400, headers=headers)
            
        if position_ms < 0 or position_ms > player.current.length:
            return web.json_response({"error": "Invalid seek position (out of bounds)"}, status=400, headers=headers)
            
        try:
            await player.seek(position_ms)
            await EmbedManager.update_status_message(self, guild_id)
            return web.json_response({"success": True, "action": "seeked", "position": position_ms}, headers=headers)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500, headers=headers)

    async def api_toggleplayback(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        
        guild = self.get_guild(guild_id)
        if not guild: 
            return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
            
        player = guild.voice_client
        if not player or not player.current:
            return web.json_response({"error": "Nothing is playing"}, status=400, headers=headers)
            
        try:
            new_state = not player.paused
            await player.pause(new_state)
            await EmbedManager.update_status_message(self, guild_id)
            
            action_str = "paused" if new_state else "resumed"
            return web.json_response({"success": True, "action": action_str, "is_paused": new_state}, headers=headers)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500, headers=headers)

    async def api_favadd(self, request: web.Request):
        headers = {"Access-Control-Allow-Origin": "*"}
        data = await self.get_api_data(request)
        guild_id = int(data.get('guild_id', 0))
        
        guild = self.get_guild(guild_id)
        if not guild: 
            return web.json_response({"error": "Guild not found"}, status=404, headers=headers)
            
        state = self.music_manager.get_state(guild_id)
        vc_id = data.get('voice_channel_id') or state.voice_channel_id
        if not vc_id: 
            return web.json_response({"error": "No voice channel provided or active"}, status=400, headers=headers)
            
        requester_id_raw = data.get('requester_id')
        requester = guild.me
        if requester_id_raw:
            try:
                requester_id = int(requester_id_raw)
                requester = guild.get_member(requester_id) or await self.fetch_user(requester_id)
            except Exception:
                pass

        count = await self.fill_queue_from_vc_favorites(guild_id, int(vc_id), requester)
        return web.json_response({"success": True, "added_count": count}, headers=headers)


    # ---------------------------------------------------------
    # CORE DISCORD EVENT HANDLERS
    # ---------------------------------------------------------
    async def on_ready(self):
        logger.info(f'Logged in as {self.user}')
        if os.path.exists(self.persistence.base_dir):
            for g_str in os.listdir(self.persistence.base_dir):
                if g_str.isdigit():
                    try: await EmbedManager.update_status_message(self, int(g_str))
                    except: pass
            self.loop.create_task(self._safe_restore_sessions())
        await update_rich_presence(self)
        
    async def _safe_restore_sessions(self):
        logger.info("Waiting for Wavelink nodes to initialize before restoring sessions...")
        while not wavelink.Pool.nodes: await asyncio.sleep(1)
        logger.info("Wavelink nodes detected. Applying 3-second buffer for Discord cache...")
        await asyncio.sleep(3) 
        await restore_sessions(self)

    async def on_command_error(self, ctx: commands.Context, error: commands.CommandError):
        if isinstance(error, commands.CheckFailure):
            try: await ctx.send(f"{Icons.ERROR} {str(error)}", ephemeral=True, delete_after=5.0)
            except: pass
        elif isinstance(error, commands.CommandNotFound): pass
        else: super().on_command_error(ctx, error)

    async def close(self):
        logger.info("Initiating shutdown loop...")
        
        # Cleanly shutdown the API server if it is running
        if self.api_runner:
            await self.api_runner.cleanup()

        # Cleanly shutdown MariaDB pool if it exists
        if self.db_pool:
            self.db_pool.close()
            await self.db_pool.wait_closed()
            
        for s in self.music_manager.states.values():
            if s.updater_task and not s.updater_task.done(): s.updater_task.cancel()
        
        if os.path.exists(self.persistence.base_dir):
            for g_str in os.listdir(self.persistence.base_dir):
                if not g_str.isdigit(): continue
                g_id = int(g_str)
                guild = self.get_guild(g_id)
                if guild and guild.voice_client:
                    try: await guild.voice_client.disconnect()
                    except: pass
                p_data = self.persistence.load_persistence(g_id)
                ch_id, msg_id = p_data.get("channel_id"), p_data.get("message_id")
                if ch_id and msg_id:
                    try:
                        chan = self.get_channel(ch_id) or await self.fetch_channel(ch_id)
                        if chan:
                            embed = discord.Embed(title=f"{Icons.STOP} System Offline", description="Hikari is currently offline or restarting.\nControls disabled.", color=discord.Color.red())
                            await chan.get_partial_message(msg_id).edit(embed=embed, view=discord.ui.View())
                    except: pass
        
        logger.info("Graceful shutdown complete. Closing connection.")
        root_logger = logging.getLogger()
        for handler in root_logger.handlers[:]:
            if isinstance(handler, logging.FileHandler):
                handler.close()
                root_logger.removeHandler(handler)

        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        if os.path.exists("bot.log"):
            os.rename("bot.log", f"bot-{timestamp}.log")
            logger.info(f"Log file renamed to bot-{timestamp}.log")
        await super().close()

    async def fill_queue_from_vc_favorites(self, guild_id: int, voice_channel_id: int, requester: Union[discord.Member, discord.User]) -> int:
        guild = self.get_guild(guild_id)
        if not guild:
            return 0
        vc = guild.get_channel(voice_channel_id)
        if not vc or not isinstance(vc, (discord.VoiceChannel, discord.StageChannel)):
            return 0
        
        member_ids = [str(m.id) for m in vc.members if not m.bot]
        if not member_ids:
            return 0
            
        state = self.music_manager.get_state(guild_id)
        tracks_to_add = []
        
        if self.db_pool:
            async with self.db_pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    format_strings = ','.join(['%s'] * len(member_ids))
                    query = f"""
                        SELECT DISTINCT t.lavalink_identifier, t.title
                        FROM tracks t
                        JOIN user_favorites uf ON t.track_id = uf.track_id
                        WHERE uf.discord_id IN ({format_strings})
                    """
                    await cur.execute(query, tuple(member_ids))
                    rows = await cur.fetchall()
                    for row in rows:
                        tracks_to_add.append(row)
        
        if not tracks_to_add:
            return 0
            
        random.shuffle(tracks_to_add)
        
        player = guild.voice_client
        if not player:
            player = await vc.connect(cls=wavelink.Player)
            state.voice_channel_id = vc.id
            p_data = self.persistence.load_persistence(guild_id)
            p_data["voice_channel_id"] = vc.id
            self.persistence.save_persistence(guild_id, p_data)
            
        count = 0
        for t_info in tracks_to_add:
            try:
                resolved_tracks = await wavelink.Playable.search(t_info['lavalink_identifier'])
                if resolved_tracks:
                    await state.queue.enqueue(TrackRequest(resolved_tracks[0], requester))
                    count += 1
            except Exception as e:
                logger.error(f"Failed to load user favorite '{t_info['title']}' into queue: {e}")
                
        if count > 0 and not player.playing:
            next_req = await self.music_manager.get_next_track(state)
            if next_req:
                player.autoplay = wavelink.AutoPlayMode.partial
                await player.play(next_req.track)
                
        await EmbedManager.update_status_message(self, guild_id)
        return count


bot = MusicBot()


# ====================================
# CONFIGURATION COMMANDS (LEVEL 0 ADMINS)
# ====================================
@bot.command(name='sync')
@commands.is_owner()
async def sync_commands(ctx: commands.Context):
    """Hidden text command to manually sync slash commands to Discord."""
    try:
        synced = await bot.tree.sync()
        await ctx.send(f"{Icons.SUCCESS} Synced {len(synced)} commands to Discord.")
    except Exception as e:
        await ctx.send(f"{Icons.ERROR} Failed to sync commands: {e}")

@bot.hybrid_group(name="settings", invoke_without_command=True)
@is_authorized(level=0)
@app_commands.default_permissions(administrator=True)
async def settings_cmd(ctx: commands.Context):
    """Manage bot settings. Only server admins can see this."""
    if ctx.invoked_subcommand is None:
        await ctx.send(f"{Icons.ERROR} Missing configuration target. Try `/settings help`.", ephemeral=True)

@settings_cmd.command(name="help", description="Show a guide on how to configure the bot.")
@is_authorized(level=0)
async def settings_help(ctx: commands.Context):
    embed = discord.Embed(
        title=f"{Icons.TOOLS} Settings Commands",
        description="Here are all the available configuration commands:",
        color=discord.Color.blurple()
    )
    embed.add_field(name="`/settings setrole <@role> <level>`", value="Assign a role to be a Music Admin (Level 1) or DJ (Level 2).", inline=False)
    embed.add_field(name="`/settings lockdown <True/False>`", value="Lock the bot so only DJs and Admins can control the music.", inline=False)
    embed.add_field(name="`/settings votepercentage <number>`", value="Set the percentage of listeners needed to skip a song.", inline=False)
    embed.add_field(name="`/settings prefix <prefix>`", value="Change the bot's legacy text command prefix.", inline=False)
    embed.add_field(name="`/settings setup`", value="Set up the permanent music player panel in this text channel.", inline=False)
    await ctx.send(embed=embed, ephemeral=True)

@settings_cmd.command(name="prefix", description="Change the bot's legacy prefix for this server.")
@is_authorized(level=0)
async def settings_prefix(ctx: commands.Context, new_prefix: str):
    settings = bot.persistence.load_settings(ctx.guild.id)
    settings["prefix"] = new_prefix
    bot.persistence.save_settings(ctx.guild.id, settings)
    await ctx.send(f"{Icons.SUCCESS} Legacy text prefix updated to `{new_prefix}`", ephemeral=True)

@settings_cmd.command(name="setrole", description="Assign a role to be a Music Admin (Level 1) or DJ (Level 2).")
@is_authorized(level=0)
async def settings_setrole(ctx: commands.Context, role: discord.Role, level: int):
    if level not in (1, 2):
        return await ctx.send(f"{Icons.ERROR} Level must be exactly 1 (Music Admin) or 2 (DJ).", ephemeral=True)
    settings = bot.persistence.load_settings(ctx.guild.id)
    if "roles" not in settings: settings["roles"] = {}
    settings["roles"][str(role.id)] = level
    bot.persistence.save_settings(ctx.guild.id, settings)
    await ctx.send(f"{Icons.SUCCESS} Successfully made {role.mention} a Level {level} user.", ephemeral=True)

@settings_cmd.command(name="lockdown", description="Lock the bot so only DJs and Admins can control the music.")
@is_authorized(level=1)  # Levels 0 and 1 are allowed to toggle
async def settings_lockdown(ctx: commands.Context, toggle: bool):
    settings = bot.persistence.load_settings(ctx.guild.id)
    settings["dj_lockdown"] = toggle
    bot.persistence.save_settings(ctx.guild.id, settings)
    await ctx.send(f"{Icons.SUCCESS} DJ Lockdown mode set to **{'ENABLED' if toggle else 'DISABLED'}**.", ephemeral=True)

@settings_cmd.command(name="votepercentage", description="Set the percentage of listeners needed to skip a song.")
@is_authorized(level=0)
async def settings_vote_pct(ctx: commands.Context, percentage: int):
    if not (1 <= percentage <= 100):
        return await ctx.send(f"{Icons.ERROR} Please provide a number between 1 and 100.", ephemeral=True)
    settings = bot.persistence.load_settings(ctx.guild.id)
    settings["vote_percentage"] = percentage
    bot.persistence.save_settings(ctx.guild.id, settings)
    await ctx.send(f"{Icons.SUCCESS} Users now need **{percentage}%** of the voice channel to agree to skip a song.", ephemeral=True)

@settings_cmd.command(name="setup", description="Set up the permanent music player in this channel.")
@is_authorized(level=0)
async def settings_setup(ctx: commands.Context):
    await ctx.defer(ephemeral=True)
    state = bot.music_manager.get_state(ctx.guild.id)
    state.channel_id = ctx.channel.id
    embed = EmbedManager.get_embed(bot, ctx.guild.id, ctx.guild.voice_client)
    view = PlaybackControls(state)
    message = await ctx.channel.send(embed=embed, view=view)
    state.message_id = message.id
    state.status_message = message
    
    p_data = bot.persistence.load_persistence(ctx.guild.id)
    p_data["channel_id"] = message.channel.id
    p_data["message_id"] = message.id
    bot.persistence.save_persistence(ctx.guild.id, p_data)
    await ctx.send(f"{Icons.SUCCESS} Music player panel created!", ephemeral=True)


# ====================================
# SYSTEM & PLAYBACK MANAGEMENT COMMANDS
# ====================================
@bot.hybrid_command(name="stop", description="Stop the music, clear the queue, and make the bot leave. (Admins only)")
@is_authorized(level=0)
@app_commands.default_permissions(administrator=True)
async def stop(ctx: commands.Context):
    state = bot.music_manager.get_state(ctx.guild.id)
    async with state.playback_lock:
        state.is_stopping = True
        state.autoplay_enabled = False
        state.shuffle_enabled = False
        state.loop_mode = "off"
        state.skip_requested = True
        await state.queue.clear()
        state.voice_channel_id = None
        
        p_data = bot.persistence.load_persistence(ctx.guild.id)
        p_data["voice_channel_id"] = None
        p_data["current_track"] = None
        bot.persistence.save_persistence(ctx.guild.id, p_data)
        
        if ctx.voice_client:
            await ctx.voice_client.disconnect()
            EmbedManager.stop_updater(bot, ctx.guild.id)
            await ctx.send(f"{Icons.STOP} Stopped the music and cleared the queue.", ephemeral=True)
            await update_rich_presence(bot)
        else:
            await ctx.send("Nothing is currently playing.", ephemeral=True)
        state.is_stopping = False
    await EmbedManager.update_status_message(bot, ctx.guild.id)

@bot.hybrid_command(name="forceplay", description="Instantly stop the current song and play a new one. (Admins only)")
@is_authorized(level=0)
@app_commands.default_permissions(administrator=True)
async def forceplay(ctx: commands.Context, *, query: str):
    if not ctx.author.voice or not ctx.author.voice.channel:
        return await ctx.send("You need to enter a voice channel.", ephemeral=True)
    await ctx.defer(ephemeral=True)
    
    if bot.music_manager.spotify.is_spotify_url(query):
        if not bot.music_manager.spotify.enabled: return await ctx.send("Spotify support not enabled.", ephemeral=True)
        query = await bot.music_manager.spotify.resolve(query)
    
    tracks = await wavelink.Playable.search(query)
    if not tracks: return await ctx.send(f"{Icons.EMPTY} Could not find any songs matching your search.", ephemeral=True)
    track = tracks.tracks[0] if isinstance(tracks, wavelink.Playlist) else tracks[0]
    
    state = bot.music_manager.get_state(ctx.guild.id)
    
    if not ctx.voice_client:
        player = await ctx.author.voice.channel.connect(cls=wavelink.Player)
        p_data = bot.persistence.load_persistence(ctx.guild.id)
        p_data["voice_channel_id"] = ctx.author.voice.channel.id
        bot.persistence.save_persistence(ctx.guild.id, p_data)
    else: player = ctx.voice_client

    state.skip_requested = True
    await player.play(track, force=True)
    await ctx.send(f"{Icons.PLAY} Interrupting to play: **{track.title}**", ephemeral=True)

@bot.hybrid_command(name="movevc", description="Move the bot to a different voice channel without stopping the music.")
@is_authorized(level=1)  # Level 0 and Level 1 commands
async def movevc(ctx: commands.Context, channel: discord.VoiceChannel):
    if not ctx.voice_client:
        return await ctx.send(f"{Icons.ERROR} I'm not playing music in a voice channel right now.", ephemeral=True)
    
    state = bot.music_manager.get_state(ctx.guild.id)
    await channel.connect(cls=wavelink.Player)
    state.voice_channel_id = channel.id
    
    p_data = bot.persistence.load_persistence(ctx.guild.id)
    p_data["voice_channel_id"] = channel.id
    bot.persistence.save_persistence(ctx.guild.id, p_data)
    
    await ctx.send(f"{Icons.SUCCESS} Moved the music over to `{channel.name}`.", ephemeral=True)


# ====================================
# INTERMEDIARY & STANDARD COMMANDS
# ====================================
@bot.hybrid_command(name="playnext", description="Add a song to play immediately after the current one finishes.")
@is_authorized(level=2)
async def playnext(ctx: commands.Context, *, query: str):
    if not ctx.author.voice or not ctx.author.voice.channel:
        return await ctx.send("Enter a voice channel first.", ephemeral=True)
    await ctx.defer(ephemeral=True)
    
    if bot.music_manager.spotify.is_spotify_url(query):
        if not bot.music_manager.spotify.enabled: return await ctx.send("Spotify support not enabled.", ephemeral=True)
        query = await bot.music_manager.spotify.resolve(query)
    
    tracks = await wavelink.Playable.search(query)
    if not tracks: return await ctx.send("No songs found matching your search.", ephemeral=True)
    
    state = bot.music_manager.get_state(ctx.guild.id)
    if not ctx.voice_client:
        player = await ctx.author.voice.channel.connect(cls=wavelink.Player)
        p_data = bot.persistence.load_persistence(ctx.guild.id)
        p_data["voice_channel_id"] = ctx.author.voice.channel.id
        bot.persistence.save_persistence(ctx.guild.id, p_data)
    else: player = ctx.voice_client

    if isinstance(tracks, wavelink.Playlist):
        for t in reversed(tracks.tracks):
            await state.queue.add_to_front(TrackRequest(t, ctx.author))
        await ctx.send(f"{Icons.ADDED} Added the playlist to play next.", ephemeral=True)
    else:
        await state.queue.add_to_front(TrackRequest(tracks[0], ctx.author))
        await ctx.send(f"{Icons.ADDED} Playing next: **{tracks[0].title}**", ephemeral=True)
        
    if not player.playing:
        req = await bot.music_manager.get_next_track(state)
        if req: await player.play(req.track)
    await EmbedManager.update_status_message(bot, ctx.guild.id)

@bot.hybrid_command(name="clearqueue", description="Remove all songs from the current queue.")
@is_authorized(level=2)
async def clearqueue(ctx: commands.Context):
    state = bot.music_manager.get_state(ctx.guild.id)
    await state.queue.clear()
    await ctx.send(f"{Icons.SUCCESS} The queue has been completely cleared.", ephemeral=True)
    await EmbedManager.update_status_message(bot, ctx.guild.id)

@bot.hybrid_command(name="remove", description="Remove a specific song from the queue using its 5-letter ID.")
@is_authorized(level=2)
async def remove(ctx: commands.Context, uid: str):
    state = bot.music_manager.get_state(ctx.guild.id)
    removed = await state.queue.remove_by_uid(uid)
    if removed:
        await ctx.send(f"{Icons.SUCCESS} Removed track `[{removed.uid}]`: **{removed.track.title}**", ephemeral=True)
        await EmbedManager.update_status_message(bot, ctx.guild.id)
    else:
        await ctx.send(f"{Icons.ERROR} Could not find a song with the ID `{uid.upper()}` in the queue.", ephemeral=True)

@bot.hybrid_command(name="play", description="Play a song or playlist from a search or link.")
@is_authorized(level=1000)
async def play(ctx: commands.Context, *, query: str):
    if not ctx.author.voice or not ctx.author.voice.channel:
        return await ctx.send("You need to join a voice channel first.", ephemeral=True)
    await ctx.defer(ephemeral=True)
    
    if bot.music_manager.spotify.is_spotify_url(query):
        if not bot.music_manager.spotify.enabled: return await ctx.send("Spotify support not enabled.", ephemeral=True)
        query = await bot.music_manager.spotify.resolve(query)

    state = bot.music_manager.get_state(ctx.guild.id)
    should_update = False
    
    async with state.playback_lock:
        if not ctx.voice_client:
            player = await ctx.author.voice.channel.connect(cls=wavelink.Player)
            state.voice_channel_id = ctx.author.voice.channel.id
            p_data = bot.persistence.load_persistence(ctx.guild.id)
            p_data["voice_channel_id"] = state.voice_channel_id
            bot.persistence.save_persistence(ctx.guild.id, p_data)
        else: player = ctx.voice_client

        tracks = await wavelink.Playable.search(query)
        if not tracks: return await ctx.send("Could not find any songs matching your search.", ephemeral=True)

        if isinstance(tracks, wavelink.Playlist):
            for track in tracks.tracks: await state.queue.enqueue(TrackRequest(track, ctx.author))
            await ctx.send(f"{Icons.ADDED} Added playlist **{tracks.name}** to the queue.", ephemeral=True)
        else:
            await state.queue.enqueue(TrackRequest(tracks[0], ctx.author))
            if player.playing: await ctx.send(f"{Icons.ADDED} Added to queue: **{tracks[0].title}**", ephemeral=True)
            
        if not player.playing:
            next_req = await bot.music_manager.get_next_track(state)
            if next_req:
                player.autoplay = wavelink.AutoPlayMode.partial
                await player.play(next_req.track)
            should_update = True
            
    if should_update: await EmbedManager.update_status_message(bot, ctx.guild.id)

@bot.hybrid_command(name="skip", description="Vote to skip the current song.")
@is_authorized(level=1000)
async def skip(ctx: commands.Context):
    player = ctx.voice_client
    if not player or not player.playing: return await ctx.send("Nothing is currently playing.", ephemeral=True)
    
    u_level = get_user_level(bot, ctx.author)
    state = bot.music_manager.get_state(ctx.guild.id)
    
    # Levels 0 and 1 skip instantly. Everyone else relies on the vote threshold
    if u_level <= 1:
        state.skip_requested = True
        await player.skip(force=True)
        await ctx.send(f"{Icons.SKIP} An Admin skipped the song.", ephemeral=True)
    else:
        if not ctx.author.voice or ctx.author.voice.channel != ctx.guild.me.voice.channel:
            return await ctx.send(f"{Icons.ERROR} You need to be in my voice channel to vote to skip!", ephemeral=True)
            
        state.skip_votes.add(ctx.author.id)
        listeners = len([m for m in ctx.guild.me.voice.channel.members if not m.bot])
        settings = bot.persistence.load_settings(ctx.guild.id)
        pct = settings.get("vote_percentage", 75)
        required = max(1, math.ceil(listeners * (pct / 100)))
        
        if len(state.skip_votes) >= required:
            state.skip_requested = True
            await player.skip(force=True)
            await ctx.send(f"{Icons.SKIP} Enough votes reached ({len(state.skip_votes)}/{required}). Skipping!")
        else:
            await ctx.send(f"Voted to skip! ({len(state.skip_votes)}/{required} votes needed).", ephemeral=True)

@bot.hybrid_command(name="toggleplayback", description="Pause or resume the current playing track.")
@is_authorized(level=2)
async def toggleplayback(ctx: commands.Context):
    player: wavelink.Player = ctx.voice_client
    if not player or not player.current:
        return await ctx.send(f"{Icons.ERROR} Nothing is playing right now.", ephemeral=True)
        
    new_state = not player.paused
    await player.pause(new_state)
    
    await EmbedManager.update_status_message(bot, ctx.guild.id)
    
    state_str = "Paused" if new_state else "Resumed"
    await ctx.send(f"{Icons.SUCCESS} **{state_str}** playback.", ephemeral=True)

@bot.hybrid_command(name="queue", description="Show the list of songs waiting to play.")
@is_authorized(level=1000)
async def queue_cmd(ctx: commands.Context):
    state = bot.music_manager.get_state(ctx.guild.id)
    queue_list = await state.queue.get_all()
    if not queue_list: return await ctx.send(f"{Icons.EMPTY} The queue is empty.", ephemeral=True)
    
    is_ephemeral = ctx.interaction is not None
    view = QueuePaginator(queue_list, is_ephemeral=is_ephemeral)
    
    if is_ephemeral:
        await ctx.send(embed=view.generate_embed(), view=view, ephemeral=True)
    else:
        await ctx.send(embed=view.generate_embed(), view=view, delete_after=60.0)

@bot.hybrid_command(name="shuffle", description="Turn queue shuffling on or off.")
@is_authorized(level=2)
async def shuffle(ctx: commands.Context):
    state = bot.music_manager.get_state(ctx.guild.id)
    async with state.playback_lock:
        state.shuffle_enabled = not state.shuffle_enabled
        if state.shuffle_enabled: await state.queue.shuffle()
    await EmbedManager.update_status_message(bot, ctx.guild.id)
    await ctx.send(f"{Icons.SHUFFLE} Shuffle set to **{'ON' if state.shuffle_enabled else 'OFF'}**.", ephemeral=True)

@bot.hybrid_command(name="autoplay", description="Toggle automatic playback of similar songs.")
@is_authorized(level=2)
async def autoplay(ctx: commands.Context):
    player: wavelink.Player = ctx.voice_client
    if not player:
        return await ctx.send("I need to be playing music before you can enable autoplay!", ephemeral=True)
    
    state = bot.music_manager.get_state(ctx.guild.id)
    async with state.playback_lock:
        state.autoplay_enabled = not state.autoplay_enabled
        if state.autoplay_enabled:
            state.loop_mode = "off"
            
        if state.queue.is_empty:
            if state.autoplay_enabled:
                player.autoplay = wavelink.AutoPlayMode.enabled
            else:
                player.autoplay = wavelink.AutoPlayMode.partial
                
    await EmbedManager.update_status_message(bot, ctx.guild.id)
    await ctx.send(f"{Icons.AUTOPLAY} Autoplay is now **{'ON' if state.autoplay_enabled else 'OFF'}**.", ephemeral=True)

@bot.hybrid_command(name="loop", description="Change the loop mode to off, playlist, or song.")
@is_authorized(level=2)
@app_commands.choices(mode=[
    app_commands.Choice(name="Off", value="off"),
    app_commands.Choice(name="Playlist", value="playlist"),
    app_commands.Choice(name="Song", value="song")
])
async def loop_cmd(ctx: commands.Context, mode: str):
    if hasattr(mode, 'value'):
        mode = mode.value
        
    state = bot.music_manager.get_state(ctx.guild.id)
    async with state.playback_lock:
        state.loop_mode = mode
        if mode != "off":
            state.autoplay_enabled = False
            player = ctx.voice_client
            if player:
                player.autoplay = wavelink.AutoPlayMode.partial
                
    await EmbedManager.update_status_message(bot, ctx.guild.id)
    await ctx.send(f"{Icons.SUCCESS} Loop mode set to **{mode.capitalize()}**.", ephemeral=True)

@bot.hybrid_command(name="lyrics", description="Fetch lyrics for the current song or search for a specific one.")
@is_authorized(level=1000)
async def lyrics_cmd(ctx: commands.Context, *, query: Optional[str] = None):
    # This command uses an explicit ephemeral=False, so it is never ephemeral.
    await ctx.defer(ephemeral=False)
    
    if not query:
        player: wavelink.Player = ctx.voice_client
        if not player or not player.current:
            return await ctx.send(f"{Icons.ERROR} There is no music playing right now. Please provide a song to search.", ephemeral=True)
        query = f"{player.current.title} {player.current.author}"
        
    msg = await ctx.send(f"Looking up the lyrics for you, please wait a moment...")
    
    result = await bot.music_manager.lyrics.get_lyrics(query)
    
    if not result:
        return await msg.edit(content=f"{Icons.EMPTY} I couldn't find lyrics for that track.")
        
    lyric_text, source = result
    pages = chunk_text(lyric_text, 1500)
    
    # Explicitly False because the message deferred is public
    view = LyricsPaginator(pages, title=f"Lyrics: {query}", source=source, is_ephemeral=False)
    
    await msg.edit(content=None, embed=view.generate_embed(), view=view)

@bot.hybrid_command(name="filter", description="Change how the music sounds with fun audio presets.")
@is_authorized(level=2)
@app_commands.choices(preset=[
    app_commands.Choice(name="Clear (Normal Studio Sound)", value="clear"),
    app_commands.Choice(name="Bass Boost (Heavy Lows)", value="bassboost"),
    app_commands.Choice(name="Nightcore (Fast & High)", value="nightcore"),
    app_commands.Choice(name="8D (Spinning Audio)", value="8d"),
    app_commands.Choice(name="Vaporwave (Slow & Deep)", value="vaporwave")
])
async def audio_filter(ctx: commands.Context, preset: str):
    await ctx.defer(ephemeral=True)
    
    # Safely extract the choice value if invoked dynamically via Hybrid command
    if hasattr(preset, 'value'):
        preset = preset.value

    player: wavelink.Player = ctx.voice_client
    if not player:
        return await ctx.send(f"{Icons.ERROR} I'm not playing music in a voice channel right now.")
        
    try:
        filters: wavelink.Filters = player.filters
        filters.reset()
        
        if preset == "bassboost":
            # Wavelink 3.5.2 uses raw dictionaries for Equalizer bands
            filters.equalizer.set(bands=[
                {"band": 0, "gain": 0.8},
                {"band": 1, "gain": 0.7},
                {"band": 2, "gain": 0.5},
                {"band": 3, "gain": 0.3},
                {"band": 4, "gain": 0.1}
            ])
        elif preset == "nightcore":
            filters.timescale.set(speed=1.25, pitch=1.25)
        elif preset == "8d":
            # Wavelink 3.5.2 explicitly recommends 0.2 for Rotation 
            filters.rotation.set(rotation_hz=0.2)
        elif preset == "vaporwave":
            filters.timescale.set(speed=0.8, pitch=0.8)
            
        await player.set_filters(filters)
        
        preset_names = {
            "clear": "Clear (Normal Studio Sound)",
            "bassboost": "Bass Boost",
            "nightcore": "Nightcore",
            "8d": "8D Audio",
            "vaporwave": "Vaporwave"
        }
        
        await ctx.send(f"{Icons.SUCCESS} Audio filter applied: **{preset_names.get(preset, 'Clear')}**")
    except Exception as e:
        logger.error(f"Failed to apply audio filter '{preset}': {e}", exc_info=True)
        await ctx.send(f"{Icons.ERROR} Something went wrong while applying the audio filter.")

@bot.hybrid_command(name="favadd", description="Scrape your voice channel and load all active members' favorited songs shuffled.")
@is_authorized(level=1000)
async def favadd(ctx: commands.Context):
    if not ctx.author.voice or not ctx.author.voice.channel:
        return await ctx.send("You need to enter a voice channel first.", ephemeral=True)
        
    await ctx.defer(ephemeral=True)
    count = await bot.fill_queue_from_vc_favorites(ctx.guild.id, ctx.author.voice.channel.id, ctx.author)
    
    if count > 0:
        await ctx.send(f"{Icons.SUCCESS} Successfully added {count} favorited songs from active members to the queue!", ephemeral=True)
    else:
        await ctx.send(f"{Icons.EMPTY} No favorited songs found for the active users in this voice channel.", ephemeral=True)


# ====================================
# WAVELINK TRACK SYSTEM EVENTS
# ====================================
@bot.event
async def on_wavelink_track_start(payload: wavelink.TrackStartEventPayload):
    guild_id = payload.player.guild.id
    p_data = bot.persistence.load_persistence(guild_id)
    p_data["last_track"] = f"{payload.track.title} by {payload.track.author}"
    bot.persistence.save_persistence(guild_id, p_data)
    await EmbedManager.update_status_message(bot, guild_id)
    EmbedManager.start_updater(bot, guild_id)
    await update_rich_presence(bot)

@bot.event
async def on_wavelink_track_end(payload: wavelink.TrackEndEventPayload):
    if not payload.player or not payload.player.guild: return
    guild_id = payload.player.guild.id
    state = bot.music_manager.get_state(guild_id)
    player = payload.player

    async with state.playback_lock:
        if state.is_stopping:
            await update_rich_presence(bot)
            return
            
        is_skipped = getattr(state, "skip_requested", False)
        state.skip_requested = False
        
        if state.loop_mode == "song" and state.current_track_req and not is_skipped:
            # Single song loop: replay the exact same track request
            next_req = state.current_track_req
            await player.play(next_req.track)
        else:
            if state.loop_mode == "playlist" and state.current_track_req and not is_skipped:
                # Playlist loop: append the finished song back to the very end of the queue
                new_req = TrackRequest(track=state.current_track_req.track, requester=state.current_track_req.requester)
                await state.queue.enqueue(new_req)
                
            next_req = await bot.music_manager.get_next_track(state)
            if next_req:
                player.autoplay = wavelink.AutoPlayMode.partial
                await player.play(next_req.track)
            else:
                player.autoplay = wavelink.AutoPlayMode.enabled if state.autoplay_enabled else wavelink.AutoPlayMode.partial

    await EmbedManager.update_status_message(bot, guild_id)
    await update_rich_presence(bot)

@bot.event
async def on_wavelink_node_ready(payload: wavelink.NodeReadyEventPayload):
    logger.info(f"Lavalink Node '{payload.node.identifier}' connection verified.")
    
@bot.event
async def on_wavelink_websocket_closed(payload: wavelink.WebsocketClosedEventPayload):
    if not payload.player or not payload.player.guild:
        return

    logger.warning(f"Voice WebSocket closed in guild {payload.player.guild.id}: Reason '{payload.reason}' (Code {payload.code})")
    await update_rich_presence(bot)


if __name__ == '__main__':
    TOKEN = os.getenv('DISCORD_TOKEN')
    if TOKEN: bot.run(TOKEN)
    else: logger.error("No DISCORD_TOKEN found.")