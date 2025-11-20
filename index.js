

const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const fs = require("fs");
const path = require("path");
const prism = require("prism-media");
const ffmpegPath = require("ffmpeg-static");

// ====== Codec detection ======
let codec = "❌ Ningún codificador Opus detectado";
try {
  require("@discordjs/opus");
  codec = "🔊 Usando @discordjs/opus (nativo)";
} catch {
  try {
    require("opusscript");
    codec = "🔊 Usando opusscript (JS)";
  } catch {}
}
console.log(codec);

// ====== Discord client ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const AUDIO_FILE = path.join(__dirname, "Templario.mp3");
let loopActive = false;
let connection = null;
let currentResource = null;

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play },
});

player.on("stateChange", (oldState, newState) => {
  console.log(`🎛️ AudioPlayer: ${oldState.status} -> ${newState.status}`);
});
player.on("error", (err) => console.error("AudioPlayer error:", err));

const watchConnection = (conn) => {
  conn.on("stateChange", (oldState, newState) => {
    console.log(`📡 VoiceConnection: ${oldState.status} -> ${newState.status}`);
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn("⚠️ Desconectado. Intentando reconectar...");
      tryReconnect(conn);
    }
  });
};

async function tryReconnect(conn) {
  try {
    await entersState(conn, VoiceConnectionStatus.Connecting, 5000);
    console.log("Reconexión exitosa");
  } catch {
    console.error("No se pudo reconectar. Cerrando conexión.");
    conn.destroy();
    connection = null;
    loopActive = false;
  }
}

client.on("ready", () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`FFmpeg path: ${ffmpegPath || "⚠️ No encontrado"}`);
});

async function waitConnectionReady(conn, timeoutMs = 6000) {
  await entersState(conn, VoiceConnectionStatus.Ready, timeoutMs);
}

function createFfmpegResource() {
  if (!fs.existsSync(AUDIO_FILE)) throw new Error(`Audio no encontrado: ${AUDIO_FILE}`);
  const ffmpeg = new prism.FFmpeg({
    args: ["-analyzeduration", "0", "-loglevel", "0", "-i", AUDIO_FILE, "-f", "s16le", "-ar", "48000", "-ac", "2"],
    executable: ffmpegPath || undefined,
  });
  const resource = createAudioResource(ffmpeg, { inlineVolume: true });
  resource.volume?.setVolume(0.8);
  return resource;
}

function create440HzToneResource(durationMs = 5000) {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.floor(sampleRate * (durationMs / 1000));
  const buffer = Buffer.alloc(totalSamples * channels * 2);
  const freq = 440;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t);
    const s = (sample * 32767) | 0;
    buffer.writeInt16LE(s, i * channels * 2);
    buffer.writeInt16LE(s, i * channels * 2 + 2);
  }
  const resource = createAudioResource(buffer, { inlineVolume: true });
  resource.volume?.setVolume(0.8);
  return resource;
}

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim().toLowerCase();

  if (content.startsWith("!lauda")) {
    if (!message.member?.voice?.channel) return message.reply("Debes estar en un canal de voz, Maestro.");
    if (!fs.existsSync(AUDIO_FILE)) return message.reply(`No encuentro el audio: ${AUDIO_FILE}`);
    try {
      connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      watchConnection(connection);
      await waitConnectionReady(connection, 8000);
      currentResource = createFfmpegResource();
      connection.subscribe(player);
      player.play(currentResource);
      loopActive = true;
      await message.reply(`▶️ Reproduciendo en bucle: ${path.basename(AUDIO_FILE)}`);
    } catch (error) {
      console.error("Error al reproducir:", error);
      message.reply("❌ Error al reproducir. Prueba !testtone.");
    }
  }

  if (content.startsWith("!peccatum")) {
    loopActive = false;
    player.stop(true);
    connection?.destroy();
    connection = null;
    currentResource = null;
    await message.reply("⏹️ Reproducción detenida.");
  }

  if (content.startsWith("!vol")) {
    const parts = message.content.trim().split(/\s+/);
    const val = Number(parts[1]);
    if (!currentResource?.volume) return message.reply("No hay reproducción activa.");
    if (Number.isNaN(val) || val < 0 || val > 100) return message.reply("Uso: !vol 0-100");
    currentResource.volume.setVolume(val / 100);
    return message.reply(`🔊 Volumen ajustado a ${val}%`);
  }

  if (content.startsWith("!status")) {
    const status = player.state?.status || "Desconocido";
    return message.reply([
      `🎚️ Codec: ${codec}`,
      `🎵 Archivo: ${fs.existsSync(AUDIO_FILE) ? path.basename(AUDIO_FILE) : "No encontrado"}`,
      `🔁 Bucle: ${loopActive ? "Sí" : "No"}`,
      `📡 Estado: ${status}`,
      `🧰 FFmpeg: ${ffmpegPath || "No encontrado"}`,
    ].join("\n"));
  }

  if (content.startsWith("!testtone")) {
    if (!message.member?.voice?.channel) return message.reply("Debes estar en un canal de voz, Maestro.");
    try {
      connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      watchConnection(connection);
      await waitConnectionReady(connection, 8000);
      currentResource = create440HzToneResource(5000);
      connection.subscribe(player);
      player.play(currentResource);
      loopActive = false;
      await message.reply("🔔 Tono de prueba 440Hz durante 5s.");
    } catch (err) {
      console.error("Error en testtone:", err);
      message.reply("❌ Falló el tono de prueba.");
    }
  }
});

player.on(AudioPlayerStatus.Idle, () => {
  if (!loopActive) return;
  try {
    currentResource = createFfmpegResource();
    player.play(currentResource);
  } catch (err) {
    console.error("Error reiniciando bucle:", err);
    loopActive = false;
  }
});

process.on("SIGINT", () => {
  player.stop(true);
  connection?.destroy();
  process.exit(0);
});

client.login(process.env.TOKEN);
