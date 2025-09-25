# main.py (full working file with autoplay history, Added-by hyperlink, and seek bar)
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

g_spotify_tracks = []
g_status_message = None
g_currently_playing_info = {}
g_last_sync_time = None
g_autoplay_enabled = False
g_manual_stop = False
g_recently_played = deque(maxlen=20)  # keep track of last 20 songs
g_spotify_user_cache = {}  # cache for resolved Spotify user display names & urls
genius = Genius(GENIUS_API_TOKEN) if GENIUS_API_TOKEN else None

# --- Set up Clients & Intents ---
intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
bot = commands.Bot(command_prefix="!", intents=intents)

try:
    sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(client_id=SPOTIPY_CLIENT_ID, client_secret=SPOTIPY_CLIENT_SECRET))
    print("Successfully connected to Spotify API.")
except Exception as e:
    sp = None
    print(f"Error connecting to Spotify API: {e}")

# --- Helper Functions ---
def sanitize_filename(name):
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name)
    return sanitized.strip().rstrip(' .')

# Helper function to find a custom emoji by name
def get_emoji(name: str):
    if not bot.guilds:
        return "🎵"
    guild = bot.guilds[0]
    emoji = discord.utils.get(guild.emojis, name=name)
    return str(emoji) if emoji else "🎵"

def update_now_playing(info, loop):
    """Callback function to update the global playing flag and status message."""
    global g_currently_playing_info
    g_currently_playing_info = info or {}

    coro = update_status_message()
    # schedule the status update on the bot loop
    asyncio.run_coroutine_threadsafe(coro, loop)


def format_time(seconds: int) -> str:
    if seconds is None:
        return "--:--"
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"

def make_seek_bar(start_time: datetime.datetime, duration: int) -> str:
    """Return a small textual seek-bar using filled/empty blocks and times."""
    if not start_time or not duration:
        return ""
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    elapsed = max(0, min(duration, elapsed))
    total_blocks = 12
    filled = int((elapsed / duration) * total_blocks) if duration > 0 else 0
    bar = "▓" * filled + "▒" * (total_blocks - filled)
    return f"\n{bar} {format_time(elapsed)} / {format_time(duration)}"

async def update_status_message():
    """Edits the global status message with the current song info or an idle state."""
    global g_status_message, g_last_sync_time
    if not g_status_message:
        return

    timestamp_str = ""
    if g_last_sync_time:
        timestamp = int(g_last_sync_time.timestamp())
        timestamp_str = f"\n\n*Last Synced: <t:{timestamp}:R>*"

    if g_currently_playing_info:
        await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.listening, name=g_currently_playing_info.get('name', '')))
        # Build description including 'Added by' hyperlink (if available) and seek bar
        desc = f"**{g_currently_playing_info.get('name','Unknown')}**\nby {g_currently_playing_info.get('artist','Unknown')}"
        added_name = g_currently_playing_info.get("added_by_name")
        added_url = g_currently_playing_info.get("added_by_url")
        if added_name and added_url:
            # Discord embed supports markdown-style links in description
            desc += f"\n*Added by [{added_name}]({added_url})*"
        elif g_currently_playing_info.get("added_by"):
            desc += f"\n*Added by {g_currently_playing_info.get('added_by')}*"

        # seek bar
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
        await bot.change_presence(activity=discord.Activity(type=discord.ActivityType.listening, name="your playlist"))
        embed = discord.Embed(
            title="Playback Paused",
            description=f"Ready to play music. Use `/play` to start.{timestamp_str}",
            color=discord.Color.greyple()
        )

    embed.set_footer(text="Hikari Melody")

    try:
        await g_status_message.edit(content=None, embed=embed)
    except discord.NotFound:
        print("Status message not found, will recreate on next startup.")
        g_status_message = None

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
        # call blocking sp.user in executor
        user_info = await loop.run_in_executor(None, lambda: sp.user(user_id))
        name = user_info.get("display_name") or user_info.get("id") or user_id
        url = user_info.get("external_urls", {}).get("spotify", f"https://open.spotify.com/user/{user_id}")
    except Exception:
        name = user_id
        url = f"https://open.spotify.com/user/{user_id}"
    g_spotify_user_cache[user_id] = (name, url)
    return name, url

# --- Core Logic: Combined "Safe Rename" and "Staging" Sync ---
async def sync_playlist(channel=None):
    global g_spotify_tracks, g_last_sync_time
    if g_currently_playing_info:
        print("Playback in progress. Sync postponed to avoid file conflicts.")
        if channel:
            await channel.send("🎧 A song is playing. Sync will automatically run later.")
        return
    if not sp:
        if channel:
            await channel.send("❌ Spotify connection is down. Cannot sync.")
        return

    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    if os.path.exists(SONGS_DIR):
        shutil.copytree(SONGS_DIR, TEMP_DIR)
    else:
        os.makedirs(TEMP_DIR, exist_ok=True)

    try:
        if channel:
            await channel.send("🔄 Starting intelligent background sync...")
        print("\n--- Starting Playlist Sync ---")
        playlist_id = PLAYLIST_URL.split('playlist/')[1].split('?')[0]
        spotify_tracks_raw, results = [], sp.playlist_tracks(playlist_id)
        spotify_tracks_raw.extend(results['items'])
        while results['next']:
            results = sp.next(results)
            spotify_tracks_raw.extend(results['items'])
        g_spotify_tracks = spotify_tracks_raw

        content_names = [sanitize_filename(item['track']['name']) + ".mp3" for item in g_spotify_tracks if item.get('track')]
        name_counts = Counter(content_names)
        duplicate_content_names = {name for name, count in name_counts.items() if count > 1}

        ideal_state_unique = {
            f"{i+1} - {sanitize_filename(item['track']['name'])}.mp3": sanitize_filename(item['track']['name']) + ".mp3"
            for i, item in enumerate(g_spotify_tracks)
            if item.get('track') and (sanitize_filename(item['track']['name']) + ".mp3") not in duplicate_content_names
        }

        local_state_unique = {
            filename: filename.split(" - ", 1)[1]
            for filename in os.listdir(TEMP_DIR)
            if " - " in filename and filename.split(" - ", 1)[1] not in duplicate_content_names
        }

        deleted_count, renamed_count, downloaded_count = 0, 0, 0

        for full_filename, content_name in local_state_unique.items():
            if content_name not in ideal_state_unique.values():
                os.remove(os.path.join(TEMP_DIR, full_filename))
                deleted_count += 1

        for ideal_full, ideal_content in ideal_state_unique.items():
            for local_full, local_content in local_state_unique.items():
                if ideal_content == local_content and ideal_full != local_full:
                    os.rename(os.path.join(TEMP_DIR, local_full), os.path.join(TEMP_DIR, ideal_full))
                    renamed_count += 1

        ideal_filenames_duplicates = [
            f"{i+1} - {sanitize_filename(item['track']['name'])}.mp3"
            for i, item in enumerate(g_spotify_tracks)
            if item.get('track') and (sanitize_filename(item['track']['name']) + ".mp3") in duplicate_content_names
        ]
        temp_files = os.listdir(TEMP_DIR)
        for temp_file in temp_files:
            if " - " in temp_file and temp_file.split(" - ", 1)[1] in duplicate_content_names:
                if temp_file not in ideal_filenames_duplicates:
                    os.remove(os.path.join(TEMP_DIR, temp_file))
                    deleted_count += 1

        current_temp_files = os.listdir(TEMP_DIR)
        for i, track_item in enumerate(g_spotify_tracks):
            track_info = track_item.get('track')
            if not track_info:
                continue
            ideal_filename = f"{i+1} - {sanitize_filename(track_info['name'])}.mp3"
            if ideal_filename not in current_temp_files:
                track_name, artist_name = track_info['name'], track_info['artists'][0]['name']
                search_query = f"{track_name} by {artist_name} audio"
                filepath_base = os.path.splitext(os.path.join(TEMP_DIR, ideal_filename))[0]
                # Important: ensure outtmpl produces a file with extension so postprocessor creates mp3 properly
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
                    'outtmpl': filepath_base + '.%(ext)s',  # <- fixed
                    'default_search': 'ytsearch1',
                    'quiet': True,
                    'no_warnings': True,
                    'sponsorblock_remove': ['sponsor', 'selfpromo', 'intro', 'outro', 'music_offtopic']
                }
                loop = asyncio.get_event_loop()
                # run blocking download in executor so it doesn't block async loop
                await loop.run_in_executor(None, lambda: yt_dlp.YoutubeDL(ydl_opts).download([search_query]))
                downloaded_count += 1

        # Replace the old songs directory atomically
        if os.path.exists(SONGS_DIR):
            shutil.rmtree(SONGS_DIR)
        os.rename(TEMP_DIR, SONGS_DIR)

        g_last_sync_time = datetime.datetime.now()
        await update_status_message()

        summary = f"✅ Sync complete! Downloaded: **{downloaded_count}**, Renamed: **{renamed_count}**, Deleted: **{deleted_count}**."
        if channel:
            await channel.send(summary)
        print(f"--- Sync Summary ---\n{summary.replace('**','')}\n--------------------")
    except Exception as e:
        print(f"FATAL ERROR during playlist sync: {e}")
        if channel:
            await channel.send(f"❌ A fatal error occurred during background sync. Check console logs.")
    finally:
        if os.path.exists(TEMP_DIR):
            shutil.rmtree(TEMP_DIR, ignore_errors=True)

# --- Autoplay Callback & Slash Commands ---
async def play_next_song(guild: discord.Guild):
    """
    Plays the next song (random) in the given guild if autoplay is enabled.
    Called by the after callback of FFmpeg playback and from the autoplay toggle.
    """
    global g_manual_stop, g_autoplay_enabled, g_recently_played

    # If a manual stop was requested previously, consume that flag and do not autoplay once.
    if g_manual_stop:
        g_manual_stop = False
        print("Manual stop flagged; skipping autoplay for this transition.")
        return

    # Clear now-playing UI promptly
    update_now_playing(None, bot.loop)

    if not g_autoplay_enabled:
        print("Autoplay is disabled; not continuing playback.")
        return

    voice_client = guild.voice_client
    if not voice_client or not voice_client.is_connected():
        # If the bot isn't in a voice channel, disable autoplay to avoid repeated errors
        g_autoplay_enabled = False
        print("Bot is not connected in guild; disabling autoplay.")
        return

    try:
        if not os.path.exists(SONGS_DIR):
            print("No songs directory for autoplay.")
            g_autoplay_enabled = False
            return
        song_list = [f for f in os.listdir(SONGS_DIR) if f.lower().endswith('.mp3')]
        if not song_list:
            print("No songs found for autoplay.")
            g_autoplay_enabled = False
            return

        # Pick a random song not in recently played (if possible)
        found_song_filename = None
        attempts = 0
        while attempts < 50:  # cap retries to avoid infinite loop
            candidate = random.choice(song_list)
            if candidate not in g_recently_played or len(set(song_list)) <= len(g_recently_played):
                found_song_filename = candidate
                break
            attempts += 1

        if not found_song_filename:
            # fallback if somehow nothing picked
            found_song_filename = random.choice(song_list)

        # record this song into history
        g_recently_played.append(found_song_filename)

        # get the track number safely and metadata including added_by/duration
        try:
            song_number = int(found_song_filename.split(' - ')[0])
            track_item = g_spotify_tracks[song_number - 1]
            track_info = track_item['track']
            raw_added_by = track_item.get("added_by", {}).get("id") if track_item.get("added_by") else None
            added_by_name, added_by_url = await resolve_added_by(raw_added_by) if raw_added_by else (None, None)
            duration = int(track_info['duration_ms'] / 1000) if track_info and track_info.get('duration_ms') else None
        except Exception:
            # If spotify metadata is unavailable, fallback to filename-only info
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
        print(f"Error during autoplay: {e}")

async def play_file(guild: discord.Guild, song_info: dict):
    """
    Centralised helper to start playback of a given song_info dict in the specified guild.
    Sets presence, updates status message, and registers the proper after callback.
    """
    voice_client = guild.voice_client
    if not voice_client or not voice_client.is_connected():
        print(f"Not connected to voice channel in guild {guild.id}; cannot play.")
        return

    update_now_playing(song_info, bot.loop)

    # ensure path exists
    path = song_info.get('path')
    if not path or not os.path.exists(path):
        print(f"Requested file doesn't exist: {path}")
        # clear now playing
        update_now_playing(None, bot.loop)
        return

    # Use FFmpeg to play and schedule next song using guild context
    def _after(err):
        if err:
            print(f"Playback error: {err}")
        # schedule next song on bot loop with the guild object
        asyncio.run_coroutine_threadsafe(play_next_song(guild), bot.loop)

    try:
        voice_client.play(discord.FFmpegPCMAudio(executable="ffmpeg", source=path), after=_after)
    except Exception as e:
        print(f"Error starting playback: {e}")
        update_now_playing(None, bot.loop)

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

    # Stop current playback if any; mark manual stop to suppress the old after-callback autoplay
    if voice_client.is_playing() or voice_client.is_paused():
        g_manual_stop = True
        voice_client.stop()

    found_song_filename = song
    if not found_song_filename:
        return await interaction.response.send_message("You must select a song.", ephemeral=True)

    # Validate songs directory and file
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
        # If Spotify metadata is missing or index fails, fallback to filename-only info
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

    # record manual play too
    g_recently_played.append(found_song_filename)

    # Start playing the requested file
    await play_file(interaction.guild, song_info)

    # Notify the user (ephemeral)
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
    global g_autoplay_enabled
    g_autoplay_enabled = not g_autoplay_enabled
    status = "ON" if g_autoplay_enabled else "OFF"
    await interaction.response.send_message(f"🔀 Autoplay is now **{status}**.", ephemeral=True)
    voice_client = interaction.guild.voice_client
    # If enabling autoplay and nothing is playing, start playback
    if g_autoplay_enabled:
        if not (voice_client and voice_client.is_playing()):
            # schedule immediately to start a random song in this guild
            await play_next_song(interaction.guild)

@bot.tree.command(name="stop", description="Stops the current song and disables autoplay.")
async def stop(interaction: discord.Interaction):
    global g_autoplay_enabled, g_manual_stop
    g_autoplay_enabled = False
    voice_client = interaction.guild.voice_client
    if voice_client and (voice_client.is_playing() or voice_client.is_paused()):
        g_manual_stop = True
        voice_client.stop()
        await interaction.response.send_message("⏹️ Playback stopped and autoplay disabled.", ephemeral=True)
    else:
        await interaction.response.send_message("Nothing is currently playing.", ephemeral=True)

@bot.tree.command(name="lyrics", description="Fetches lyrics for the currently playing song.")
async def lyrics(interaction: discord.Interaction):
    if not g_currently_playing_info:
        return await interaction.response.send_message("❌ No song is currently playing.", ephemeral=True)

    if not genius:
        return await interaction.response.send_message("❌ Genius API not configured. Please set GENIUS_API_TOKEN in .env.", ephemeral=True)

    song_name = g_currently_playing_info.get("name")
    artist_name = g_currently_playing_info.get("artist")

    await interaction.response.defer(ephemeral=True)  # acknowledge, since it might take a second

    try:
        song = await asyncio.get_event_loop().run_in_executor(
            None, lambda: genius.search_song(song_name, artist_name)
        )
        if not song or not song.lyrics:
            return await interaction.followup.send("❌ Lyrics not found.", ephemeral=True)

        # Genius often adds boilerplate ("Embed", etc). Clean that up.
        lyrics_text = song.lyrics
        lyrics_text = re.sub(r'(\d*Embed.*)', '', lyrics_text).strip()

        # Discord has a 2000 char message limit; split if needed
        chunks = [lyrics_text[i:i+1900] for i in range(0, len(lyrics_text), 1900)]
        for i, chunk in enumerate(chunks):
            header = f"🎤 **Lyrics for {song_name} — {artist_name}** (part {i+1}/{len(chunks)})\n\n" if i == 0 else ""
            await interaction.followup.send(header + chunk, ephemeral=True)
    except Exception as e:
        print(f"Error fetching lyrics: {e}")
        await interaction.followup.send("⚠️ Error fetching lyrics. Try again later.", ephemeral=True)


# --- Background Task & Discord Events ---
@tasks.loop(seconds=15)
async def refresh_seek_bar():
    # Refresh the status message (seek bar) every 5 seconds for smooth updates
    if g_currently_playing_info:
        await update_status_message()

@tasks.loop(minutes=5)
async def scheduled_sync():
    await sync_playlist()

@bot.event
async def on_ready():
    global g_status_message
    print(f'Logged in as {bot.user} (ID: {bot.user.id})')
    await bot.tree.sync()
    print("Command tree synced.")

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
            g_status_message = await status_channel.send(embed=idle_embed)
            with open(STATUS_MESSAGE_ID_FILE, 'w') as f:
                f.write(str(g_status_message.id))
        await update_status_message()
    else:
        print("WARNING: Text channel 'hikari' not found. Status message feature disabled.")

    for guild in bot.guilds:
        general_vc = discord.utils.get(guild.voice_channels, name='General')
        if general_vc:
            try:
                await general_vc.connect()
            except Exception as e:
                print(f"Error joining 'General' voice channel: {e}")
            break

    refresh_seek_bar.start()
    scheduled_sync.start()

# --- Run the Bot ---
if __name__ == "__main__":
    if not all([TOKEN, SPOTIPY_CLIENT_ID, SPOTIPY_CLIENT_SECRET]):
        print("ERROR: Missing required environment variables in .env file.")
    else:
        bot.run(TOKEN)
