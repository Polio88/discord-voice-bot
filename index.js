
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
const express = require("express");

// ====== Codec detection (logs informativos) ======
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

// ====== Mini servidor HTTP para Replit (keep-alive) ======
const app = express();
app.get("/", (_, res) => res.send("Bot de voz corriendo ✅"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Keep-alive web en http://localhost:${PORT}`));

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

// ====== Configura aquí tu archivo de audio ======
const AUDIO_FILE = path.resolve(__dirname, "audio", "Templar.mp3");

// ====== Estado ======
let loopActive = false;
let connection = null;
let currentResource = null; // para control de volumen

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play },
});

// ====== Log detallado de estados y errores ======
player.on("stateChange", (oldState, newState) => {
  console.log(`🎛️ AudioPlayer state: ${oldState.status} -> ${newState.status}`);
});
player.on("error", (err) => {
  console.error("AudioPlayer error:", err);
});
const watchConnection = (conn) => {
  conn.on("stateChange", (oldState, newState) => {
    console.log(`📡 VoiceConnection: ${oldState.status} -> ${newState.status}`);
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn("⚠️ Desconectado de voz. Intentando reconectar…");
    }
  });
};

client.on("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  console.log(`FFmpeg path: ${ffmpegPath || "⚠️ ffmpeg-static devolvió null (no encontrado)"}`);
});

// ====== Helper: esperar conexión lista ======
async function waitConnectionReady(conn, timeoutMs = 6000) {
  await entersState(conn, VoiceConnectionStatus.Ready, timeoutMs);
}

// ====== Helper: crear recurso desde FFmpeg ======
function createFfmpegResource() {
  if (!fs.existsSync(AUDIO_FILE)) {
    throw new Error(`Audio no encontrado en: ${AUDIO_FILE}`);
  }

  // Si ffmpegPath es null, prism usará "ffmpeg" del sistema (probablemente no existe en Replit).
  if (!ffmpegPath) {
    console.warn("⚠️ ffmpeg-static no proporcionó ruta. Intentaré usar 'ffmpeg' del sistema (posible fallo en Replit).");
  }

  const ffmpeg = new prism.FFmpeg({
    args: [
      "-analyzeduration", "0",
      "-loglevel", "0",
      "-i", AUDIO_FILE,
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
    ],
    executable: ffmpegPath || undefined,
  });

  const resource = createAudioResource(ffmpeg, { inlineVolume: true });
  if (resource.volume) resource.volume.setVolume(0.8); // 80% por defecto
  return resource;
}

// ====== Helper: recurso de tono 440Hz sin FFmpeg ======
function create440HzToneResource(durationMs = 5000) {
  // Genera PCM 16-bit, 48kHz, estéreo con seno de 440Hz
  const sampleRate = 48000;
  const channels = 2;
  const seconds = durationMs / 1000;
  const totalSamples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(totalSamples * channels * 2); // 2 bytes por muestra

  const freq = 440;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t);
    const intSample = Math.max(-1, Math.min(1, sample)) * 32767; // int16
    const s = intSample | 0;
    // estéreo: L y R
    buffer.writeInt16LE(s, i * channels * 2);
    buffer.writeInt16LE(s, i * channels * 2 + 2);
  }

  const resource = createAudioResource(buffer, {
    inputType: undefined, // Discord.js detecta PCM s16le
    inlineVolume: true,
  });
  if (resource.volume) resource.volume.setVolume(0.8);
  return resource;
}

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim().toLowerCase();

  // ====== Comando Play ======
  if (content.startsWith("!lauda")) {
    if (!message.member?.voice?.channel) {
      return message.reply("Debes estar en un canal de voz para usar este comando, Maestro.");
    }

    if (message.member.voice.channel.type === ChannelType.GuildStageVoice) {
      message.reply("Estás en un **canal de Escenario**. El bot puede entrar suprimido; promuévelo a **ponente** o usa un canal de voz normal.");
    }

    if (!fs.existsSync(AUDIO_FILE)) {
      return message.reply(`No encuentro el audio en: \`${AUDIO_FILE}\`. Verifica la ruta y el nombre del archivo.`);
    }

    try {
      // Conecta sin ensordecer ni mutear
      connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      watchConnection(connection);

      // Espera a que la conexión esté lista
      await waitConnectionReady(connection, 8000);
      console.log("✅ VoiceConnection Ready");

      // Crea recurso y reproduce
      currentResource = createFfmpegResource();
      connection.subscribe(player);
      player.play(currentResource);

      loopActive = true;
      await message.reply(`▶️ Reproduciendo en bucle: **${path.basename(AUDIO_FILE)}**`);
    } catch (error) {
      console.error("Error al reproducir:", error);
      message.reply("❌ Error al reproducir el audio. Prueba `!testtone` para diagnosticar si la conexión de voz funciona.");
    }
  }

  // ====== Comando Stop ======
  if (content.startsWith("!peccatum")) {
    try {
      loopActive = false;
      player.stop(true);
      if (connection) {
        connection.destroy();
        connection = null;
      }
      currentResource = null;
      await message.reply("⏹️ Reproducción detenida.");
    } catch (e) {
      console.error(e);
      await message.reply("⚠️ Ocurrió un error al detener la reproducción.");
    }
  }

  // ====== Comando Volumen ======
  if (content.startsWith("!vol")) {
    const parts = message.content.trim().split(/\s+/);
    const val = Number(parts[1]);
    if (!currentResource || !currentResource.volume) {
      return message.reply("No hay reproducción activa o no se puede ajustar el volumen ahora.");
    }
    if (Number.isNaN(val) || val < 0 || val > 100) {
      return message.reply("Uso: `!vol 0-100` (por ejemplo, `!vol 80`).");
    }
    const normalized = val / 100;
    currentResource.volume.setVolume(normalized);
    return message.reply(`🔊 Volumen ajustado a **${val}%**.`);
  }

  // ====== Comando Status ======
  if (content.startsWith("!status")) {
    const status =
      player.state?.status === AudioPlayerStatus.Playing ? "Reproduciendo" :
      player.state?.status === AudioPlayerStatus.Idle ? "Inactivo" :
      player.state?.status || "Desconocido";

    return message.reply([
      `🎚️ Codec: ${codec}`,
      `🎵 Archivo: ${fs.existsSync(AUDIO_FILE) ? path.basename(AUDIO_FILE) : "No encontrado"}`,
      `🔁 Bucle: ${loopActive ? "Sí" : "No"}`,
      `📡 Estado: ${status}`,
      `🧰 FFmpeg: ${ffmpegPath ? ffmpegPath : "No encontrado por ffmpeg-static"}`,
    ].join("\n"));
  }

  // ====== Comando de diagnóstico: tono 440Hz ======
  if (content.startsWith("!testtone")) {
    if (!message.member?.voice?.channel) {
      return message.reply("Debes estar en un canal de voz para usar este comando, Maestro.");
    }

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
      console.log("✅ VoiceConnection Ready (testtone)");

      currentResource = create440HzToneResource(5000); // 5s tono
      connection.subscribe(player);
      player.play(currentResource);

      loopActive = false; // el tono NO hace bucle
      await message.reply("🔔 Reproduciendo tono de prueba 440Hz durante 5 segundos.");
    } catch (err) {
      console.error("Error en testtone:", err);
      message.reply("❌ Falló el tono de prueba. Posible problema de conexión de voz/UDP/permisos.");
    }
  }
});

// ====== Loop al terminar ======
player.on(AudioPlayerStatus.Idle, () => {
  if (!loopActive) return;
  try {
    currentResource = createFfmpegResource();
    player.play(currentResource);
  } catch (err) {
    console.error("Error reiniciando el bucle:", err);
  }
});

// ====== Shutdown limpio ======
process.on("SIGINT", () => {
  try {
    player.stop(true);
    if (connection) connection.destroy();
  } finally {
    process.exit(0);
  }
});

client.login(process.env.TOKEN);
