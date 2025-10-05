# main.py
# Enhanced Hikari Melody bot with:
# - Audio normalization (FFmpeg loudnorm)
# - Silence trimming
# - Parallelized downloads
# - Edit queue (processes queued edit tasks every 5 seconds)
# - Autoplay memory (persisted)
# - Lyrics caching
# - Unified logging format and general optimizations
#
# NOTE: This single-file approach keeps behavior inline with your existing bot features.
# Requirements: ffmpeg available on PATH, yt_dlp, spotipy, lyricsgenius, python-dotenv, discord.py

import discord
from discord import app_commands
from discord.ext import tasks, commands
import os
import shutil
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from dotenv import load_dotenv
import asyncio
import re
import yt_dlp
from collections import Counter, deque
import datetime
import random
import time
from lyricsgenius import Genius
import subprocess
import json
import logging
from concurrent.futures import ThreadPoolExecutor

# --- Logging (unified format) ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("hikari")

# --- Load Environment Variables ---
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
GENIUS_API_TOKEN = os.getenv('GENIUS_API_TOKEN')
SPOTIPY_CLIENT_ID = os.getenv('SPOTIPY_CLIENT_ID')
SPOTIPY_CLIENT_SECRET = os.getenv('SPOTIPY_CLIENT_SECRET')

# --- Constants & Global State ---
PLAYLIST_URL = "https://open.spotify.com/playlist/6oOWU4Pfv8IKJTC90bH0Qm?si=bf6cbf28e4864ecf"
SONGS_DIR = "songs"
TEMP_DIR = "songs_temp"
STATUS_MESSAGE_ID_FILE = "status_message_id.txt"
AUTOPLAY_STATE_FILE = "autoplay_state.json"
LYRICS_CACHE_DIR = "lyrics_cache"

g_spotify_tracks = []
g_status_message = None
g_currently_playing_info = {}
g_last_sync_time = None
g_last_edit_time = 0
g_autoplay_enabled = False
g_manual_stop = False
g_recently_played = deque(maxlen=20)  # keep track of last 20 songs
g_spotify_user_cache = {}  # cache for resolved Spotify user display names & urls
genius = Genius(GENIUS_API_TOKEN) if GENIUS_API_TOKEN else None

# Edit queue: tasks that perform "edits" (status message edits, filesystem renames/deletes, etc.)
# All queued edits will be processed by a background task every 5 seconds
edit_queue: asyncio.Queue | None = None

# ThreadPoolExecutor for downloads and blocking blocking calls
download_executor: ThreadPoolExecutor | None = None

# Lyrics cache directory ensure exists
os.makedirs(LYRICS_CACHE_DIR, exist_ok=True)

# Autoplay state file: load persisted state (last played file, autoplay toggle)
autoplay_state = {
    "last_played": None,
    "autoplay_enabled": False
}
if os.path.exists(AUTOPLAY_STATE_FILE):
    try:
        with open(AUTOPLAY_STATE_FILE, "r", encoding="utf-8") as f:
            autoplay_state.update(json.load(f))
            g_autoplay_enabled = autoplay_state.get("autoplay_enabled", False)
            log.info("Loaded autoplay state from disk.")
    except Exception as e:
        log.warning(f"Failed to load autoplay state: {e}")

# --- Set up Clients & Intents ---
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
bot = commands.Bot(command_prefix="!", intents=intents)

try:
    sp = spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(client_id=SPOTIPY_CLIENT_ID, client_secret=SPOTIPY_CLIENT_SECRET)
    )
    log.info("Successfully connected to Spotify API.")
except Exception as e:
    sp = None
    log.warning(f"Error connecting to Spotify API: {e}")

# --- Helper Functions ---
def sanitize_filename(name: str) -> str:
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name)
    return sanitized.strip().rstrip(' .')

def get_emoji(name: str):
    if not bot.guilds:
        return "🎵"
    guild = bot.guilds[0]
    emoji = discord.utils.get(guild.emojis, name=name)
    return str(emoji) if emoji else "🎵"

def format_time(seconds: int) -> str:
    if seconds is None:
        return "--:--"
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"

def make_seek_bar(start_time: datetime.datetime, duration: int) -> str:
    if not start_time or not duration:
        return ""
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    elapsed = max(0, min(duration, elapsed))
    total_blocks = 12
    filled = int((elapsed / duration) * total_blocks) if duration > 0 else 0
    bar = "▓" * filled + "▒" * (total_blocks - filled)
    return f"\n{bar} {format_time(elapsed)} / {format_time(duration)}"

# --- Audio Processing Helpers ---
def ffmpeg_normalize_and_trim(input_path: str, target_i: float = -14.0, tp: float = -1.5, lra: float = 11.0) -> bool:
    """
    Trim leading/trailing silence and normalize loudness using FFmpeg's loudnorm and silenceremove.
    Produces a temporary file and replaces the original if successful.
    Returns True on success.
    """
    try:
        tmp_path = input_path + ".processing.mp3"
        # The filter first trims silence, then applies loudnorm.
        # silenceremove params: start_periods=1:start_threshold=-50dB:start_silence=0.1
        ffmpeg_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path,
            "-af",
            f"silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.2,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.2,areverse,loudnorm=I={target_i}:TP={tp}:LRA={lra}",
            "-ar", "44100",
            tmp_path
        ]
        log.info(f"Running ffmpeg processing: {' '.join(ffmpeg_cmd[:3])} ...")
        res = subprocess.run(ffmpeg_cmd, check=False)
        if res.returncode != 0:
            log.warning(f"ffmpeg processing failed for {input_path} with return code {res.returncode}")
            # Attempt single-step loudnorm only as fallback (without silenceremove)
            tmp_path2 = input_path + ".processing2.mp3"
            ffmpeg_cmd2 = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", input_path,
                "-af", f"loudnorm=I={target_i}:TP={tp}:LRA={lra}",
                "-ar", "44100",
                tmp_path2
            ]
            res2 = subprocess.run(ffmpeg_cmd2, check=False)
            if res2.returncode == 0:
                os.replace(tmp_path2, input_path)
                return True
            else:
                log.error(f"Fallback ffmpeg loudnorm also failed for {input_path}.")
                return False
        # Replace original file atomically
        os.replace(tmp_path, input_path)
        log.info(f"Processed audio: {input_path}")
        return True
    except Exception as e:
        log.exception(f"Exception during ffmpeg processing for {input_path}: {e}")
        return False

# --- Scheduling edits into the edit queue ---
async def enqueue_edit(coro):
    """
    Add a coroutine function (callable returning a coroutine) to the edit queue.
    The processing background task will call it (await coro()).
    """
    global edit_queue
    if edit_queue is None:
        log.warning("Edit queue not initialized; running coroutine immediately.")
        try:
            await coro()
        except Exception as e:
            log.exception(f"Error running edit coro immediately: {e}")
        return
    await edit_queue.put(coro)

def enqueue_edit_threadsafe(coro, loop):
    """
    Thread-safe helper to enqueue an edit from non-async contexts.
    """
    if edit_queue is None:
        # If no queue, run directly on given loop
        try:
            asyncio.run_coroutine_threadsafe(coro(), loop)
        except Exception as e:
            log.exception(f"Failed to run edit coro thread-safe: {e}")
    else:
        try:
            asyncio.run_coroutine_threadsafe(edit_queue.put(coro), loop)
        except Exception as e:
            log.exception(f"Failed to enqueue edit thread-safe: {e}")

# --- Playback Controls UI (persistent view) ---
class PlaybackControls(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="⏭️ Skip", style=discord.ButtonStyle.primary, custom_id="playback_skip")
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        voice_client = interaction.guild.voice_client
        if not voice_client or not (voice_client.is_playing() or voice_client.is_paused()):
            await interaction.response.send_message("Nothing is currently playing.", ephemeral=True)
            return

        global g_manual_stop
        g_manual_stop = True
        voice_client.stop()
        await interaction.response.send_message("⏭️ Skipped.", ephemeral=True)

        if g_autoplay_enabled:
            await play_next_song(interaction.guild)

    @discord.ui.button(label="⏹️ Stop", style=discord.ButtonStyle.danger, custom_id="playback_stop")
    async def stop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        global g_autoplay_enabled, g_manual_stop
        g_autoplay_enabled = False
        voice_client = interaction.guild.voice_client
        if voice_client and (voice_client.is_playing() or voice_client.is_paused()):
            g_manual_stop = True
            voice_client.stop()
            await interaction.response.send_message("⏹️ Playback stopped and autoplay disabled.", ephemeral=True)
        else:
            await interaction.response.send_message("Nothing is currently playing.", ephemeral=True)
        await enqueue_edit(update_status_message)

    @discord.ui.button(label="🔁 Autoplay: OFF", style=discord.ButtonStyle.secondary, custom_id="playback_autoplay")
    async def autoplay_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        global g_autoplay_enabled, autoplay_state
        g_autoplay_enabled = not g_autoplay_enabled
        autoplay_state['autoplay_enabled'] = g_autoplay_enabled
        # persist autoplay state
        try:
            with open(AUTOPLAY_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(autoplay_state, f)
        except Exception as e:
            log.warning(f"Failed to persist autoplay state: {e}")

        button.label = f"🔁 Autoplay: {'ON' if g_autoplay_enabled else 'OFF'}"
        button.style = discord.ButtonStyle.success if g_autoplay_enabled else discord.ButtonStyle.secondary

        await interaction.response.send_message(f"🔁 Autoplay is now **{'ON' if g_autoplay_enabled else 'OFF'}**.", ephemeral=True)

        await enqueue_edit(update_status_message)

        if g_autoplay_enabled:
            vc = interaction.guild.voice_client
            if vc and not vc.is_playing():
                await play_next_song(interaction.guild)

# instantiate a single view used for the status message
playback_controls: PlaybackControls | None = None

async def update_status_message():
    """
    Edits the global status message with the current song info or an idle state,
    and attaches the playback control view. Buttons are dynamically enabled/disabled
    depending on whether they are usable.

    This function is intended to be scheduled via the edit queue, not called directly
    many times per second.
    """
    global g_status_message, g_last_sync_time, playback_controls, g_last_edit_time
    if not g_status_message:
        return

    now = time.time()
    # small additional guard vs extremely tight edits (but edit queue should manage frequency)
    if now - g_last_edit_time < 1:
        return
    g_last_edit_time = now

    timestamp_str = ""
    if g_last_sync_time:
        timestamp = int(g_last_sync_time.timestamp())
        timestamp_str = f"\n\n*Last Synced: <t:{timestamp}:R>*"

    guild = bot.guilds[0] if bot.guilds else None
    voice_client = guild.voice_client if guild else None
    playing_or_paused = bool(voice_client and (voice_client.is_playing() or voice_client.is_paused()))

    if g_currently_playing_info:
        try:
            await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.listening, name=g_currently_playing_info.get('name', '')[:128]))
        except Exception:
            pass

        desc = f"**{g_currently_playing_info.get('name','Unknown')}**\nby {g_currently_playing_info.get('artist','Unknown')}"
        added_name = g_currently_playing_info.get("added_by_name")
        added_url = g_currently_playing_info.get("added_by_url")
        if added_name and added_url:
            desc += f"\n*Added by [{added_name}]({added_url})*"
        elif g_currently_playing_info.get("added_by"):
            desc += f"\n*Added by {g_currently_playing_info.get('added_by')}*"

        desc += make_seek_bar(
            g_currently_playing_info.get("start_time"),
            g_currently_playing_info.get("duration")
        )

        desc += timestamp_str
        embed = discord.Embed(
            title=f"{get_emoji('spinningcd')} Now Playing",
            description=desc,
            color=discord.Color.green()
        )
        art_url = g_currently_playing_info.get('art_url')
        if art_url:
            embed.set_thumbnail(url=art_url)
    else:
        try:
            await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.listening, name="your playlist"))
        except Exception:
            pass
        embed = discord.Embed(
            title="Playback Paused",
            description=f"Ready to play music. Use `/play` to start.{timestamp_str}",
            color=discord.Color.greyple()
        )

    embed.set_footer(text="Hikari Melody")

    # Update playback_controls buttons: label, style, and disabled state.
    for child in playback_controls.children:
        if isinstance(child, discord.ui.Button):
            if child.custom_id == "playback_autoplay":
                child.label = f"🔁 Autoplay: {'ON' if g_autoplay_enabled else 'OFF'}"
                child.style = discord.ButtonStyle.success if g_autoplay_enabled else discord.ButtonStyle.secondary
                child.disabled = False
            elif child.custom_id == "playback_skip":
                child.disabled = not playing_or_paused
            elif child.custom_id == "playback_stop":
                child.disabled = not playing_or_paused

    try:
        await g_status_message.edit(content=None, embed=embed, view=playback_controls)
    except discord.NotFound:
        log.warning("Status message not found, will recreate on next startup.")
        g_status_message = None
    except Exception as e:
        log.exception(f"Failed editing status message: {e}")

def update_now_playing(info, loop):
    """
    Update the global playing info and enqueue a status update in a thread-safe way.
    Pass the bot loop when calling from non-async contexts.
    """
    global g_currently_playing_info, autoplay_state
    g_currently_playing_info = info or {}
    autoplay_state['last_played'] = g_currently_playing_info.get('path')
    try:
        with open(AUTOPLAY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(autoplay_state, f)
    except Exception as e:
        log.debug(f"Failed to persist autoplay last_played: {e}")

    # Enqueue update_status_message to run via edit queue, thread-safe
    enqueue_edit_threadsafe(update_status_message, loop)

async def resolve_added_by(user_id: str):
    """
    Resolve a Spotify user ID into (display_name, profile_url) and cache it.
    Returns (name, url) or (user_id, profile_url) fallback.
    """
    global g_spotify_user_cache, sp
    if not sp or not user_id:
        return None, None
    if user_id in g_spotify_user_cache:
        return g_spotify_user_cache[user_id]
    loop = asyncio.get_event_loop()
    try:
        user_info = await loop.run_in_executor(None, lambda: sp.user(user_id))
        name = user_info.get("display_name") or user_info.get("id") or user_id
        url = user_info.get("external_urls", {}).get("spotify", f"https://open.spotify.com/user/{user_id}")
    except Exception:
        name = user_id
        url = f"https://open.spotify.com/user/{user_id}"
    g_spotify_user_cache[user_id] = (name, url)
    return name, url

# --- Core Logic: Sync with improved parallel downloads and post-processing ---
async def sync_playlist(channel=None):
    """
    Sync Spotify playlist with local songs directory.
    - Uses a staging temp dir
    - Downloads missing tracks in parallel
    - After each download, trims & normalizes audio
    - All filesystem edits (rename/delete) are queued via edit_queue and applied by the edit processor
    """
    global g_spotify_tracks, g_last_sync_time, download_executor

    if g_currently_playing_info:
        log.info("Playback in progress. Sync postponed to avoid file conflicts.")
        if channel:
            await channel.send("🎧 A song is playing. Sync will automatically run later.")
        return
    if not sp:
        if channel:
            await channel.send("❌ Spotify connection is down. Cannot sync.")
        log.warning("Spotify client not available for sync.")
        return

    # Prepare executors
    if download_executor is None:
        # Limit number of threads to a safe number
        download_executor = ThreadPoolExecutor(max_workers=4)

    try:
        if channel:
            await channel.send("🔄 Starting intelligent background sync...")
        log.info("Starting playlist sync...")

        # Fetch all playlist tracks
        playlist_id = PLAYLIST_URL.split('playlist/')[1].split('?')[0]
        spotify_tracks_raw = []
        results = sp.playlist_tracks(playlist_id)
        spotify_tracks_raw.extend(results['items'])
        while results['next']:
            results = sp.next(results)
            spotify_tracks_raw.extend(results['items'])
        g_spotify_tracks = spotify_tracks_raw

        # Build ideal filenames
        content_names = [sanitize_filename(item['track']['name']) + ".mp3" for item in g_spotify_tracks if item.get('track')]
        name_counts = Counter(content_names)
        duplicate_content_names = {name for name, count in name_counts.items() if count > 1}

        ideal_state_unique = {
            f"{i+1} - {sanitize_filename(item['track']['name'])}.mp3": sanitize_filename(item['track']['name']) + ".mp3"
            for i, item in enumerate(g_spotify_tracks)
            if item.get('track') and (sanitize_filename(item['track']['name']) + ".mp3") not in duplicate_content_names
        }

        # Create temp staging directory
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR)
        if os.path.exists(SONGS_DIR):
            shutil.copytree(SONGS_DIR, TEMP_DIR)
        else:
            os.makedirs(TEMP_DIR, exist_ok=True)

        # Map local filenames that are "index - name.mp3" -> content name
        local_state_unique = {
            filename: filename.split(" - ", 1)[1]
            for filename in os.listdir(TEMP_DIR)
            if " - " in filename and filename.split(" - ", 1)[1] not in duplicate_content_names
        }

        # Deleted & renamed actions queued so they execute via edit processor
        deleted_count, renamed_count, downloaded_count = 0, 0, 0

        # Queue deletes for files not in ideal playlist
        for full_filename, content_name in local_state_unique.items():
            if content_name not in ideal_state_unique.values():
                file_path = os.path.join(TEMP_DIR, full_filename)
                async def _del(p=file_path):
                    try:
                        os.remove(p)
                        log.info(f"Deleted: {p}")
                    except FileNotFoundError:
                        pass
                    except Exception as e:
                        log.exception(f"Failed to delete {p}: {e}")
                await enqueue_edit(_del)
                deleted_count += 1

        # Queue renames for files that need reindexing
        for ideal_full, ideal_content in ideal_state_unique.items():
            for local_full, local_content in local_state_unique.items():
                if ideal_content == local_content and ideal_full != local_full:
                    src = os.path.join(TEMP_DIR, local_full)
                    dst = os.path.join(TEMP_DIR, ideal_full)
                    async def _rename(s=src, d=dst):
                        try:
                            os.rename(s, d)
                            log.info(f"Renamed {s} -> {d}")
                        except FileNotFoundError:
                            pass
                        except Exception as e:
                            log.exception(f"Failed rename {s} -> {d}: {e}")
                    await enqueue_edit(_rename)
                    renamed_count += 1

        # Remove duplicates: files in temp that are duplicate content names but not part of ideal list
        ideal_filenames_duplicates = [
            f"{i+1} - {sanitize_filename(item['track']['name'])}.mp3"
            for i, item in enumerate(g_spotify_tracks)
            if item.get('track') and (sanitize_filename(item['track']['name']) + ".mp3") in duplicate_content_names
        ]
        temp_files = os.listdir(TEMP_DIR)
        for temp_file in temp_files:
            if " - " in temp_file and temp_file.split(" - ", 1)[1] in duplicate_content_names:
                if temp_file not in ideal_filenames_duplicates:
                    file_path = os.path.join(TEMP_DIR, temp_file)
                    async def _deldup(p=file_path):
                        try:
                            os.remove(p)
                            log.info(f"Deleted duplicate: {p}")
                        except FileNotFoundError:
                            pass
                        except Exception as e:
                            log.exception(f"Failed to delete duplicate {p}: {e}")
                    await enqueue_edit(_deldup)
                    deleted_count += 1

        # Determine missing files to download
        current_temp_files = os.listdir(TEMP_DIR)
        missing_tracks = []
        for i, track_item in enumerate(g_spotify_tracks):
            track_info = track_item.get('track')
            if not track_info:
                continue
            ideal_filename = f"{i+1} - {sanitize_filename(track_info['name'])}.mp3"
            if ideal_filename not in current_temp_files:
                missing_tracks.append((i, track_item, ideal_filename))

        # Download missing tracks in parallel using executor
        if missing_tracks:
            log.info(f"Downloading {len(missing_tracks)} missing tracks (parallel)...")
            loop = asyncio.get_event_loop()
            download_futures = []

            def _download_and_process(search_query, filepath):
                """
                Blocking function to download via yt_dlp and post-process audio.
                Returns True on success.
                """
                try:
                    # Ensure parent directory exists
                    os.makedirs(os.path.dirname(filepath), exist_ok=True)
                    ydl_opts = {
                        'format': 'bestaudio/best',
                        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
                        'outtmpl': filepath + '.%(ext)s',
                        'default_search': 'ytsearch1',
                        'quiet': True,
                        'no_warnings': True,
                        'sponsorblock_remove': ['sponsor', 'selfpromo', 'intro', 'outro', 'music_offtopic']
                    }
                    log.info(f"Downloading '{search_query}' -> {filepath}")
                    yt_dlp.YoutubeDL(ydl_opts).download([search_query])
                    # Post-process: trim silence & normalize
                    success = ffmpeg_normalize_and_trim(filepath)
                    if not success:
                        log.warning(f"Post-processing failed for {filepath}")
                    return True
                except Exception as e:
                    log.exception(f"Download failed for {search_query}: {e}")
                    return False

            for (idx, track_item, ideal_filename) in missing_tracks:
                track_info = track_item.get('track')
                track_name, artist_name = track_info['name'], track_info['artists'][0]['name']
                search_query = f"{track_name} by {artist_name} audio"
                filepath_base = os.path.splitext(os.path.join(TEMP_DIR, ideal_filename))[0]
                filepath = filepath_base + '.mp3'
                # schedule download in executor
                fut = loop.run_in_executor(download_executor, _download_and_process, search_query, filepath)
                download_futures.append(fut)

            # Wait for all downloads to complete
            results = await asyncio.gather(*download_futures, return_exceptions=True)
            for r in results:
                if isinstance(r, Exception):
                    log.exception(f"Exception in download: {r}")
                elif r:
                    downloaded_count += 1

        # After queueing deletes/renames and finishing downloads, replace old songs dir atomically.
        # To avoid race conditions, we wait a short moment for the edit queue to flush pending filesystem ops.
        # We'll enqueue a final step that swaps directories (this will run as an edit).
        async def _swap_dirs():
            try:
                if os.path.exists(SONGS_DIR):
                    shutil.rmtree(SONGS_DIR)
                os.rename(TEMP_DIR, SONGS_DIR)
                log.info("Swapped in new songs directory.")
            except Exception as e:
                log.exception(f"Failed to swap songs directory: {e}")
        await enqueue_edit(_swap_dirs)

        g_last_sync_time = datetime.datetime.now()
        # schedule status update via edit queue
        await enqueue_edit(update_status_message)

        summary = f"✅ Sync queued! Downloaded: **{downloaded_count}**, Renamed (queued): **{renamed_count}**, Deleted (queued): **{deleted_count}**."
        if channel:
            await channel.send(summary)
        log.info(f"Sync summary (queued): {summary}")
    except Exception as e:
        log.exception(f"FATAL ERROR during playlist sync: {e}")
        if channel:
            await channel.send(f"❌ A fatal error occurred during background sync. Check console logs.")
    finally:
        # If TEMP_DIR still exists (because swap_dirs hasn't happened yet), we'll leave it for the edit processor to handle.
        pass

# --- Autoplay & Playback ---
async def play_next_song(guild: discord.Guild):
    """
    Plays the next song (random) in the given guild if autoplay is enabled.
    Called by the after callback of FFmpeg playback and from the autoplay toggle.
    """
    global g_manual_stop, g_autoplay_enabled, g_recently_played

    if g_manual_stop:
        g_manual_stop = False
        log.info("Manual stop flagged; skipping autoplay for this transition.")
        return

    # Clear now-playing UI promptly
    update_now_playing(None, bot.loop)

    if not g_autoplay_enabled:
        log.info("Autoplay is disabled; not continuing playback.")
        return

    voice_client = guild.voice_client
    if not voice_client or not voice_client.is_connected():
        g_autoplay_enabled = False
        autoplay_state['autoplay_enabled'] = False
        try:
            with open(AUTOPLAY_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(autoplay_state, f)
        except Exception:
            pass
        log.info("Bot is not connected in guild; disabling autoplay.")
        await enqueue_edit(update_status_message)
        return

    try:
        if not os.path.exists(SONGS_DIR):
            log.info("No songs directory for autoplay.")
            g_autoplay_enabled = False
            autoplay_state['autoplay_enabled'] = False
            await enqueue_edit(update_status_message)
            return
        song_list = [f for f in os.listdir(SONGS_DIR) if f.lower().endswith('.mp3')]
        if not song_list:
            log.info("No songs found for autoplay.")
            g_autoplay_enabled = False
            autoplay_state['autoplay_enabled'] = False
            await enqueue_edit(update_status_message)
            return

        # Pick a random song not in recently played (if possible)
        found_song_filename = None
        attempts = 0
        while attempts < 50:
            candidate = random.choice(song_list)
            if candidate not in g_recently_played or len(set(song_list)) <= len(g_recently_played):
                found_song_filename = candidate
                break
            attempts += 1

        if not found_song_filename:
            found_song_filename = random.choice(song_list)

        g_recently_played.append(found_song_filename)

        # get metadata safely
        try:
            song_number = int(found_song_filename.split(' - ')[0])
            track_item = g_spotify_tracks[song_number - 1]
            track_info = track_item['track']
            raw_added_by = track_item.get("added_by", {}).get("id") if track_item.get("added_by") else None
            added_by_name, added_by_url = await resolve_added_by(raw_added_by) if raw_added_by else (None, None)
            duration = int(track_info['duration_ms'] / 1000) if track_info and track_info.get('duration_ms') else None
        except Exception:
            track_info = None
            song_number = None
            added_by_name, added_by_url, duration = None, None, None

        song_info = {
            'path': os.path.join(SONGS_DIR, found_song_filename),
            'name': (track_info['name'] if track_info else os.path.splitext(found_song_filename)[0]),
            'artist': (track_info['artists'][0]['name'] if track_info else 'Unknown'),
            'art_url': (track_info['album']['images'][0]['url'] if (track_info and track_info.get('album') and track_info['album'].get('images')) else None),
            'added_by_name': added_by_name,
            'added_by_url': added_by_url,
            'duration': duration,
            'start_time': datetime.datetime.now()
        }

        await play_file(guild, song_info)
    except Exception as e:
        log.exception(f"Error during autoplay: {e}")

async def play_file(guild: discord.Guild, song_info: dict):
    """
    Central helper to start playback of a given song_info dict.
    """
    voice_client = guild.voice_client
    if not voice_client or not voice_client.is_connected():
        log.info(f"Not connected to voice channel in guild {guild.id}; cannot play.")
        return

    update_now_playing(song_info, bot.loop)

    path = song_info.get('path')
    if not path or not os.path.exists(path):
        log.warning(f"Requested file doesn't exist: {path}")
        update_now_playing(None, bot.loop)
        return

    def _after(err):
        if err:
            log.exception(f"Playback error: {err}")
        asyncio.run_coroutine_threadsafe(play_next_song(guild), bot.loop)

    try:
        # Use FFmpegPCMAudio; if you want to apply global volume multiplier you can add before_options or filter here.
        voice_client.play(discord.FFmpegPCMAudio(executable="ffmpeg", source=path), after=_after)
        log.info(f"Started playback: {path}")
    except Exception as e:
        log.exception(f"Error starting playback: {e}")
        update_now_playing(None, bot.loop)

# --- Autocomplete & Slash Commands ---
async def play_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    choices = []
    try:
        sorted_files = sorted(
            [f for f in os.listdir(SONGS_DIR) if f.lower().endswith('.mp3')],
            key=lambda x: int(x.split(' - ')[0]) if ' - ' in x else 0
        )
    except Exception:
        return []
    for filename in sorted_files:
        if current.lower() in filename.lower():
            choices.append(app_commands.Choice(name=filename.replace('.mp3', ''), value=filename))
    return choices[:25]

@bot.tree.command(name="play", description="Plays a song from the playlist.")
@app_commands.autocomplete(song=play_autocomplete)
async def play(interaction: discord.Interaction, song: str):
    global g_manual_stop, g_recently_played
    voice_client = interaction.guild.voice_client
    if not voice_client or not voice_client.is_connected():
        return await interaction.response.send_message("I'm not in a voice channel!", ephemeral=True)

    if voice_client.is_playing() or voice_client.is_paused():
        g_manual_stop = True
        voice_client.stop()

    found_song_filename = song
    if not found_song_filename:
        return await interaction.response.send_message("You must select a song.", ephemeral=True)

    if not os.path.exists(SONGS_DIR):
        return await interaction.response.send_message("No songs are available. Please run `/sync` first.", ephemeral=True)

    if not os.path.exists(os.path.join(SONGS_DIR, found_song_filename)):
        return await interaction.response.send_message("Could not find that song file. Playlist might be syncing.", ephemeral=True)

    try:
        song_number = int(found_song_filename.split(' - ')[0])
        track_item = g_spotify_tracks[song_number - 1]
        track_info = track_item['track']
        raw_added_by = track_item.get("added_by", {}).get("id") if track_item.get("added_by") else None
        added_by_name, added_by_url = await resolve_added_by(raw_added_by) if raw_added_by else (None, None)
        duration = int(track_info['duration_ms'] / 1000) if track_info and track_info.get('duration_ms') else None
    except Exception:
        track_info = None
        added_by_name, added_by_url, duration = None, None, None

    song_info = {
        'path': os.path.join(SONGS_DIR, found_song_filename),
        'name': (track_info['name'] if track_info else os.path.splitext(found_song_filename)[0]),
        'artist': (track_info['artists'][0]['name'] if track_info else 'Unknown'),
        'art_url': (track_info['album']['images'][0]['url'] if (track_info and track_info.get('album') and track_info['album'].get('images')) else None),
        'added_by_name': added_by_name,
        'added_by_url': added_by_url,
        'duration': duration,
        'start_time': datetime.datetime.now()
    }

    g_recently_played.append(found_song_filename)

    await play_file(interaction.guild, song_info)
    await interaction.response.send_message(f"🎵 Now playing: **{song_info['name']}**", ephemeral=True)

@bot.tree.command(name="set", description="Moves the bot to your current voice channel.")
async def set_channel(interaction: discord.Interaction):
    if interaction.user.voice and interaction.user.voice.channel:
        user_channel = interaction.user.voice.channel
        if interaction.guild.voice_client:
            await interaction.guild.voice_client.move_to(user_channel)
        else:
            await user_channel.connect()
        await interaction.response.send_message(f"✅ Joined/Moved to **{user_channel.name}**.", ephemeral=True)
    else:
        await interaction.response.send_message("You need to be in a voice channel to use this command.", ephemeral=True)

@bot.tree.command(name="sync", description="Manually triggers a playlist sync.")
async def sync(interaction: discord.Interaction):
    await interaction.response.send_message("Manual sync initiated. See console for progress.", ephemeral=True)
    asyncio.create_task(sync_playlist(interaction.channel))

@bot.tree.command(name="autoplay", description="Toggles random automated playback of the playlist.")
async def autoplay(interaction: discord.Interaction):
    global g_autoplay_enabled, autoplay_state
    g_autoplay_enabled = not g_autoplay_enabled
    autoplay_state['autoplay_enabled'] = g_autoplay_enabled
    try:
        with open(AUTOPLAY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(autoplay_state, f)
    except Exception as e:
        log.warning(f"Failed to persist autoplay state: {e}")

    status = "ON" if g_autoplay_enabled else "OFF"
    await interaction.response.send_message(f"🔀 Autoplay is now **{status}**.", ephemeral=True)
    voice_client = interaction.guild.voice_client
    if g_autoplay_enabled:
        if not (voice_client and voice_client.is_playing()):
            await play_next_song(interaction.guild)
    await enqueue_edit(update_status_message)

@bot.tree.command(name="stop", description="Stops the current song and disables autoplay.")
async def stop(interaction: discord.Interaction):
    global g_autoplay_enabled, g_manual_stop, autoplay_state
    g_autoplay_enabled = False
    autoplay_state['autoplay_enabled'] = False
    try:
        with open(AUTOPLAY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(autoplay_state, f)
    except Exception:
        pass
    voice_client = interaction.guild.voice_client
    if voice_client and (voice_client.is_playing() or voice_client.is_paused()):
        g_manual_stop = True
        voice_client.stop()
        await interaction.response.send_message("⏹️ Playback stopped and autoplay disabled.", ephemeral=True)
    else:
        await interaction.response.send_message("Nothing is currently playing.", ephemeral=True)
    await enqueue_edit(update_status_message)

@bot.tree.command(name="skip", description="Skips the current song and rerolls if autoplay is on.")
async def skip(interaction: discord.Interaction):
    voice_client = interaction.guild.voice_client
    if not voice_client or not (voice_client.is_playing() or voice_client.is_paused()):
        return await interaction.response.send_message("Nothing is currently playing.", ephemeral=True)

    global g_manual_stop
    g_manual_stop = True
    voice_client.stop()
    await interaction.response.send_message("⏭️ Skipped the current song.", ephemeral=True)
    if g_autoplay_enabled:
        await play_next_song(interaction.guild)

@bot.tree.command(name="lyrics", description="Fetches lyrics for the currently playing song.")
async def lyrics(interaction: discord.Interaction):
    if not g_currently_playing_info:
        return await interaction.response.send_message("❌ No song is currently playing.", ephemeral=True)

    if not genius:
        return await interaction.response.send_message("❌ Genius API not configured. Please set GENIUS_API_TOKEN in .env.", ephemeral=True)

    song_name = g_currently_playing_info.get("name")
    artist_name = g_currently_playing_info.get("artist")
    safe_name = sanitize_filename(f"{song_name} - {artist_name}")
    cache_path = os.path.join(LYRICS_CACHE_DIR, safe_name + ".txt")

    await interaction.response.defer(ephemeral=True)

    # Return cached lyrics if available
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                lyrics_text = f.read()
            chunks = [lyrics_text[i:i+1900] for i in range(0, len(lyrics_text), 1900)]
            for i, chunk in enumerate(chunks):
                header = f"🎤 **Lyrics for {song_name} — {artist_name}** (part {i+1}/{len(chunks)})\n\n" if i == 0 else ""
                await interaction.followup.send(header + chunk, ephemeral=True)
            return
        except Exception as e:
            log.warning(f"Failed to read lyrics cache {cache_path}: {e}")

    try:
        # Use executor for blocking Genius call
        loop = asyncio.get_event_loop()
        song = await loop.run_in_executor(None, lambda: genius.search_song(song_name, artist_name))
        if not song or not song.lyrics:
            return await interaction.followup.send("❌ Lyrics not found.", ephemeral=True)

        lyrics_text = song.lyrics
        lyrics_text = re.sub(r'(\d*Embed.*)', '', lyrics_text).strip()

        # Cache lyrics to disk for future
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                f.write(lyrics_text)
            log.info(f"Cached lyrics: {cache_path}")
        except Exception as e:
            log.warning(f"Failed to write lyrics cache: {e}")

        chunks = [lyrics_text[i:i+1900] for i in range(0, len(lyrics_text), 1900)]
        for i, chunk in enumerate(chunks):
            header = f"🎤 **Lyrics for {song_name} — {artist_name}** (part {i+1}/{len(chunks)})\n\n" if i == 0 else ""
            await interaction.followup.send(header + chunk, ephemeral=True)
    except Exception as e:
        log.exception(f"Error fetching lyrics: {e}")
        await interaction.followup.send("⚠️ Error fetching lyrics. Try again later.", ephemeral=True)

# --- Background Tasks ---
@tasks.loop(seconds=15)
async def refresh_seek_bar():
    if g_currently_playing_info:
        await enqueue_edit(update_status_message)

@tasks.loop(minutes=5)
async def scheduled_sync():
    await sync_playlist()

async def _edit_queue_processor():
    """
    Background coroutine: every 5 seconds, process all queued 'edit' tasks sequentially.
    This ensures edits (status message edits, filesystem renames/deletes, dir swaps) respect a controlled rate
    and are applied in a batch every 5 seconds.
    """
    global edit_queue
    while True:
        try:
            # Gather all items currently in queue
            tasks_to_run = []
            while not edit_queue.empty():
                coro_callable = await edit_queue.get()
                tasks_to_run.append(coro_callable)
            if tasks_to_run:
                log.info(f"Processing {len(tasks_to_run)} queued edit(s)...")
            for coro_callable in tasks_to_run:
                try:
                    # coro_callable should be an async function (callable that returns coroutine)
                    await coro_callable()
                except Exception as e:
                    log.exception(f"Error executing queued edit: {e}")
            # small sleep until next processing batch
            await asyncio.sleep(5)
        except Exception as e:
            log.exception(f"Edit queue processor crashed: {e}")
            await asyncio.sleep(5)

@bot.event
async def on_ready():
    global g_status_message, playback_controls, edit_queue, download_executor

    if playback_controls is None:
        playback_controls = PlaybackControls()

    if edit_queue is None:
        edit_queue = asyncio.Queue()

    if download_executor is None:
        download_executor = ThreadPoolExecutor(max_workers=4)

    log.info(f'Logged in as {bot.user} (ID: {bot.user.id})')
    await bot.tree.sync()
    log.info("Command tree synced.")

    status_channel = discord.utils.get(bot.guilds[0].text_channels, name="hikari") if bot.guilds else None
    if status_channel:
        message_id = None
        try:
            with open(STATUS_MESSAGE_ID_FILE, 'r') as f:
                message_id = int(f.read())
        except (FileNotFoundError, ValueError):
            pass
        if message_id:
            try:
                g_status_message = await status_channel.fetch_message(message_id)
            except discord.NotFound:
                message_id = None
        if not message_id:
            idle_embed = discord.Embed(title="Bot Initializing...", description="Please wait.", color=discord.Color.orange())
            g_status_message = await status_channel.send(embed=idle_embed, view=playback_controls)
            with open(STATUS_MESSAGE_ID_FILE, 'w') as f:
                f.write(str(g_status_message.id))
        await enqueue_edit(update_status_message)
    else:
        log.warning("Text channel 'hikari' not found. Status message feature disabled.")

    for guild in bot.guilds:
        general_vc = discord.utils.get(guild.voice_channels, name='General')
        if general_vc:
            try:
                await general_vc.connect()
            except Exception as e:
                log.warning(f"Error joining 'General' voice channel: {e}")
            break

    # Start background tasks
    refresh_seek_bar.start()
    scheduled_sync.start()

    # Start the edit queue processor as a background task
    bot.loop.create_task(_edit_queue_processor())

    # If autoplay state has a last played file and autoplay is enabled, optionally resume presence (no autoplay auto-play to avoid surprise)
    if autoplay_state.get("last_played"):
        log.info(f"Autoplay last played: {autoplay_state.get('last_played')}")

# --- Run the Bot ---
if __name__ == "__main__":
    if not all([TOKEN, SPOTIPY_CLIENT_ID, SPOTIPY_CLIENT_SECRET]):
        log.error("ERROR: Missing required environment variables in .env file.")
    else:
        try:
            bot.run(TOKEN)
        except Exception as e:
            log.exception(f"Bot crashed: {e}")
