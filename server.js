const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const BIN_DIR = path.join(__dirname, 'bin');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const MERGED_DIR = path.join(DOWNLOADS_DIR, 'merged');
const DATA_DIR = path.join(__dirname, 'data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

// Ensure bin is in PATH for any child processes
process.env.PATH = `${BIN_DIR};${process.env.PATH}`;

const YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp.exe');
const FFMPEG_PATH = path.join(BIN_DIR, 'ffmpeg.exe');
const FFPROBE_PATH = path.join(BIN_DIR, 'ffprobe.exe');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure folders exist
[BIN_DIR, DOWNLOADS_DIR, MERGED_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(LIBRARY_FILE)) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify([], null, 2));
}

// Helpers for Library Storage
function getLibrary() {
  try {
    const raw = fs.readFileSync(LIBRARY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading library:', err);
    return [];
  }
}

function saveLibrary(data) {
  try {
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving library:', err);
  }
}

// Server-Sent Events (SSE) for Real-Time Updates
let sseClients = [];
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n');
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(client => client.write(data));
}

// Stream audio with HTTP 206 Range Support
app.get('/media/:folder/:filename', (req, res) => {
  const folder = req.params.folder === 'merged' ? MERGED_DIR : DOWNLOADS_DIR;
  const filePath = path.join(folder, path.basename(req.params.filename));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = (end - start) + 1;

    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Download attachment
app.get('/api/download-file/:folder/:filename', (req, res) => {
  const folder = req.params.folder === 'merged' ? MERGED_DIR : DOWNLOADS_DIR;
  const filePath = path.join(folder, path.basename(req.params.filename));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  res.download(filePath, path.basename(req.params.filename));
});

// Open downloads folder in Windows Explorer
app.post('/api/open-folder', (req, res) => {
  const target = req.body.folder === 'merged' ? MERGED_DIR : DOWNLOADS_DIR;
  exec(`explorer "${target}"`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Get tracks stack
app.get('/api/tracks', (req, res) => {
  const library = getLibrary();
  res.json(library);
});

// Save updated track order
app.post('/api/tracks/reorder', (req, res) => {
  const { trackIds } = req.body;
  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ error: 'trackIds array required' });
  }

  const library = getLibrary();
  const map = new Map(library.map(t => [t.id, t]));
  const reordered = [];

  for (const id of trackIds) {
    if (map.has(id)) {
      reordered.push(map.get(id));
      map.delete(id);
    }
  }
  for (const remaining of map.values()) {
    reordered.push(remaining);
  }

  saveLibrary(reordered);
  res.json({ success: true, tracks: reordered });
});

// Update track trim, selection, title, or silence settings
app.post('/api/tracks/update', (req, res) => {
  const { id, trimStart, trimEnd, selected, title, silenceAfter } = req.body;
  const library = getLibrary();
  const track = library.find(t => t.id === id);

  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  if (typeof trimStart === 'number') track.trimStart = Math.max(0, trimStart);
  if (typeof trimEnd === 'number') track.trimEnd = Math.min(track.duration, trimEnd);
  if (typeof selected === 'boolean') track.selected = selected;
  if (typeof title === 'string' && title.trim()) track.title = title.trim();
  if (silenceAfter !== undefined) {
    track.silenceAfter = (silenceAfter === null || silenceAfter === -1) ? undefined : Math.max(0, Number(silenceAfter));
  }

  saveLibrary(library);
  res.json({ success: true, track });
});

// DELETE track — removes from library AND deletes file from disk
app.delete('/api/tracks/:id', (req, res) => {
  const { id } = req.params;
  let library = getLibrary();
  const track = library.find(t => t.id === id);

  if (!track) {
    return res.status(404).json({ error: 'Track not found' });
  }

  // Try to delete the audio file
  const filePath = path.join(DOWNLOADS_DIR, path.basename(track.filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Could not delete file:', e.message);
    }
  }

  library = library.filter(t => t.id !== id);
  saveLibrary(library);
  broadcast('track_deleted', { id });

  res.json({ success: true });
});

// Clear all tracks
app.post('/api/tracks/clear', (req, res) => {
  const library = getLibrary();
  library.forEach(track => {
    const filePath = path.join(DOWNLOADS_DIR, path.basename(track.filename));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
  });
  saveLibrary([]);
  broadcast('tracks_cleared', {});
  res.json({ success: true });
});

// List all merged/created audio files
app.get('/api/merged', (req, res) => {
  try {
    if (!fs.existsSync(MERGED_DIR)) return res.json([]);
    const files = fs.readdirSync(MERGED_DIR)
      .filter(f => f.endsWith('.mp3') || f.endsWith('.m4a'))
      .map(filename => {
        const filePath = path.join(MERGED_DIR, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
          createdAt: stats.mtimeMs,
          streamUrl: `/media/merged/${encodeURIComponent(filename)}`,
          downloadUrl: `/api/download-file/merged/${encodeURIComponent(filename)}`
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a merged audio file
app.delete('/api/merged/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filePath = path.join(MERGED_DIR, filename);

  console.log('Attempting to delete merged file:', filePath);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado: ' + filename });
  }
  try {
    fs.unlinkSync(filePath);
    console.log('Deleted merged file:', filename);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting merged file:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Fetch YouTube Metadata
app.post('/api/fetch-info', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const args = ['--dump-single-json', '--no-warnings', '--no-playlist', url];
  const ytdlp = spawn(YTDLP_PATH, args);
  let stdoutData = '';
  let stderrData = '';

  ytdlp.stdout.on('data', data => { stdoutData += data.toString(); });
  ytdlp.stderr.on('data', data => { stderrData += data.toString(); });

  ytdlp.on('close', code => {
    if (code !== 0) {
      return res.status(400).json({ error: stderrData || 'Could not fetch video info' });
    }
    try {
      const info = JSON.parse(stdoutData);
      res.json({
        id: info.id,
        title: info.title,
        artist: info.uploader || info.channel || 'Desconocido',
        duration: Math.round(info.duration || 0),
        thumbnail: info.thumbnail,
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// Get real duration of a file using ffprobe
function getFileDuration(filePath) {
  return new Promise((resolve) => {
    const probe = spawn(FFPROBE_PATH, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ]);
    let out = '';
    probe.stdout.on('data', d => { out += d.toString(); });
    probe.on('close', () => {
      try {
        const info = JSON.parse(out);
        resolve(Math.round(parseFloat(info.format.duration) || 0));
      } catch (e) {
        resolve(0);
      }
    });
  });
}

// Download Audio and convert to MP3
app.post('/api/download', async (req, res) => {
  const { url, customBitrate } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const tempJobId = crypto.randomUUID().slice(0, 8);
  res.json({ success: true, jobId: tempJobId, message: 'Descarga iniciada' });

  broadcast('download_start', { jobId: tempJobId, url });

  // 1. Get metadata quickly via --print
  const infoProcess = spawn(YTDLP_PATH, [
    '--no-warnings',
    '--no-playlist',
    '--print', '%(id)s\t%(title)s\t%(uploader)s\t%(duration)s\t%(thumbnail)s',
    url
  ]);
  let infoOut = '';
  infoProcess.stdout.on('data', d => infoOut += d.toString());

  await new Promise(resolve => infoProcess.on('close', resolve));

  let meta = {
    id: `yt_${Date.now()}`,
    title: 'Audio descargado',
    artist: 'YouTube',
    duration: 0,
    thumbnail: ''
  };

  try {
    const parts = infoOut.trim().split('\t');
    if (parts.length >= 4 && parts[0]) {
      meta.id = parts[0].trim();
      meta.title = parts[1] ? parts[1].trim() : 'Audio descargado';
      meta.artist = parts[2] ? parts[2].trim() : 'YouTube';
      meta.duration = Math.round(parseFloat(parts[3]) || 0);
      meta.thumbnail = parts[4] ? parts[4].trim() : '';
    }
  } catch (e) {
    console.warn('Could not parse metadata, using defaults.');
  }

  // 2. Download and convert to MP3
  const outputTemplate = path.join(DOWNLOADS_DIR, `${meta.id}.%(ext)s`);
  const finalFilename = `${meta.id}.mp3`;
  const finalPath = path.join(DOWNLOADS_DIR, finalFilename);

  const downloadArgs = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', customBitrate || '0',
    '-o', outputTemplate,
    '--ffmpeg-location', BIN_DIR,
    '--no-playlist',
    '--newline',
    url
  ];

  const dlProcess = spawn(YTDLP_PATH, downloadArgs);

  dlProcess.stdout.on('data', data => {
    const text = data.toString();
    const match = text.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/);
    if (match) {
      broadcast('download_progress', {
        jobId: tempJobId,
        id: meta.id,
        percent: parseFloat(match[1]),
        size: match[2],
        speed: match[3],
        eta: match[4]
      });
    } else if (text.includes('[ExtractAudio]')) {
      broadcast('download_progress', {
        jobId: tempJobId,
        id: meta.id,
        percent: 98,
        statusText: 'Extrayendo audio MP3...'
      });
    }
  });

  dlProcess.stderr.on('data', data => {
    console.error('yt-dlp stderr:', data.toString());
  });

  dlProcess.on('close', async (code) => {
    if (code === 0) {
      // Get actual duration from the file
      let duration = meta.duration;
      if (!duration && fs.existsSync(finalPath)) {
        duration = await getFileDuration(finalPath);
      }
      if (!duration) duration = 0;

      const library = getLibrary();
      const existingIdx = library.findIndex(t => t.id === meta.id);
      const trackData = {
        id: meta.id,
        title: meta.title,
        artist: meta.artist,
        duration,
        thumbnail: meta.thumbnail,
        filename: finalFilename,
        trimStart: 0,
        trimEnd: duration,
        selected: true,
        createdAt: Date.now()
      };

      if (existingIdx >= 0) {
        library[existingIdx] = trackData;
      } else {
        library.push(trackData);
      }
      saveLibrary(library);

      broadcast('download_complete', {
        jobId: tempJobId,
        track: trackData
      });
    } else {
      broadcast('download_error', {
        jobId: tempJobId,
        error: 'Error durante la descarga o extracción de audio'
      });
    }
  });
});

// Merge selected tracks
app.post('/api/merge', (req, res) => {
  const { trackConfigs, silenceDuration = 0, crossfade, crossfadeDuration = 2, outputName } = req.body;
  if (!Array.isArray(trackConfigs) || trackConfigs.length === 0) {
    return res.status(400).json({ error: 'Se requiere al menos 1 pista para juntar' });
  }

  const library = getLibrary();
  const tracksToMerge = [];

  for (const cfg of trackConfigs) {
    const track = library.find(t => t.id === cfg.id);
    if (track) {
      const fullPath = path.join(DOWNLOADS_DIR, path.basename(track.filename));
      if (fs.existsSync(fullPath)) {
        const trackSilence = typeof cfg.silenceAfter === 'number' ? cfg.silenceAfter : (track.silenceAfter !== undefined ? track.silenceAfter : Number(silenceDuration || 0));
        tracksToMerge.push({
          ...track,
          trimStart: typeof cfg.trimStart === 'number' ? cfg.trimStart : (track.trimStart || 0),
          trimEnd: typeof cfg.trimEnd === 'number' ? cfg.trimEnd : (track.trimEnd || track.duration),
          silenceAfter: Math.max(0, trackSilence),
          fullPath
        });
      }
    }
  }

  if (tracksToMerge.length === 0) {
    return res.status(400).json({ error: 'Ningún archivo de audio encontrado en disco' });
  }

  const mergeJobId = crypto.randomUUID().slice(0, 8);
  const cleanName = (outputName || 'obra_teatro').trim()
    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 80);
  const outFilename = `${Date.now()}_${cleanName}.mp3`;
  const outPath = path.join(MERGED_DIR, outFilename);

  res.json({ success: true, jobId: mergeJobId, outFilename, message: 'Proceso de unión iniciado' });

  let totalDuration = 0;
  tracksToMerge.forEach((t, i) => {
    totalDuration += Math.max(0, t.trimEnd - t.trimStart);
    if (i < tracksToMerge.length - 1 && t.silenceAfter > 0) {
      totalDuration += t.silenceAfter;
    }
  });

  broadcast('merge_start', { jobId: mergeJobId, totalTracks: tracksToMerge.length, totalDuration: Math.round(totalDuration) });

  const ffmpegArgs = [];
  tracksToMerge.forEach(t => { ffmpegArgs.push('-i', t.fullPath); });

  const filterParts = [];
  const concatLabels = [];

  tracksToMerge.forEach((t, i) => {
    const label = `a${i}`;
    const start = Math.max(0, t.trimStart);
    const end = Math.min(t.duration, t.trimEnd);
    filterParts.push(`[${i}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${label}]`);
    concatLabels.push(`[${label}]`);

    if (i < tracksToMerge.length - 1 && t.silenceAfter > 0) {
      const silLabel = `sil${i}`;
      filterParts.push(`aevalsrc=0:d=${t.silenceAfter}:s=44100,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${silLabel}]`);
      concatLabels.push(`[${silLabel}]`);
    }
  });

  const hasAnySilence = tracksToMerge.some((t, i) => i < tracksToMerge.length - 1 && t.silenceAfter > 0);

  if (crossfade && tracksToMerge.length > 1 && !hasAnySilence) {
    const xfDuration = Math.min(5, Math.max(1, crossfadeDuration));
    let lastOut = concatLabels[0];
    for (let i = 1; i < concatLabels.length; i++) {
      const mixLabel = i === concatLabels.length - 1 ? '[outa]' : `[xf${i}]`;
      filterParts.push(`${lastOut}${concatLabels[i]}acrossfade=d=${xfDuration}:c1=tri:c2=tri${mixLabel}`);
      lastOut = mixLabel;
    }
  } else {
    filterParts.push(`${concatLabels.join('')}concat=n=${concatLabels.length}:v=0:a=1[outa]`);
  }

  ffmpegArgs.push(
    '-filter_complex', filterParts.join('; '),
    '-map', '[outa]',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    '-y',
    outPath
  );

  console.log('Merging', tracksToMerge.length, 'tracks into', outFilename);

  const ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs);
  let stderrLog = '';

  ffmpegProcess.stderr.on('data', data => {
    const str = data.toString();
    stderrLog += str;
    const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const mins = parseInt(timeMatch[2], 10);
      const secs = parseFloat(timeMatch[3]);
      const currentSecs = (hours * 3600) + (mins * 60) + secs;
      const pct = Math.min(99, Math.round((currentSecs / (totalDuration || 1)) * 100));
      broadcast('merge_progress', {
        jobId: mergeJobId,
        percent: pct,
        currentSeconds: Math.round(currentSecs),
        totalSeconds: Math.round(totalDuration)
      });
    }
  });

  ffmpegProcess.on('close', code => {
    if (code === 0 && fs.existsSync(outPath)) {
      const stats = fs.statSync(outPath);
      broadcast('merge_complete', {
        jobId: mergeJobId,
        filename: outFilename,
        title: cleanName,
        totalDuration: Math.round(totalDuration),
        size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
        streamUrl: `/media/merged/${encodeURIComponent(outFilename)}`,
        downloadUrl: `/api/download-file/merged/${encodeURIComponent(outFilename)}`
      });
    } else {
      console.error('FFmpeg merge error:', stderrLog.slice(-2000));
      broadcast('merge_error', {
        jobId: mergeJobId,
        error: 'Error al unir los audios con FFmpeg. Verifica los tiempos seleccionados.'
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎭 MP3 STUDIO TEATRO - LISTO`);
  console.log(`🚀 Servidor en: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
