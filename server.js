const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const ftp = require('basic-ftp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration file path
const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  downloadDir: path.join(__dirname, 'downloads'),
  pkgDecTool: 'pkg2zip.exe',
  pkgDecParams: '-x "{pkgFile}" "{zRifKey}"',
  hmacKey: 'E5E278AA1EE34082A088279C83F9BBC806821C52F2AB5D2B4ABD995450355114',
  compPackUrl: 'https://gitlab.com/nopaystation_repos/nps_compati_packs/raw/master/entries.txt',
  compPackPatchUrl: 'https://gitlab.com/nopaystation_repos/nps_compati_packs/raw/master/entries_patch.txt',
  tsvUrls: {
    PSV_GAMES: 'http://nopaystation.com/tsv/PSV_GAMES.tsv',
    PSM_GAMES: 'http://nopaystation.com/tsv/PSM_GAMES.tsv',
    PSX_GAMES: 'http://nopaystation.com/tsv/PSX_GAMES.tsv',
    PSP_GAMES: 'http://nopaystation.com/tsv/PSP_GAMES.tsv',
    PS3_GAMES: 'http://nopaystation.com/tsv/PS3_GAMES.tsv',
    PSV_DLCS: 'http://nopaystation.com/tsv/PSV_DLCS.tsv',
    PSP_DLCS: 'http://nopaystation.com/tsv/PSP_DLCS.tsv',
    PS3_DLCS: 'http://nopaystation.com/tsv/PS3_DLCS.tsv',
    PSV_THEMES: 'http://nopaystation.com/tsv/PSV_THEMES.tsv'
  }
};

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...DEFAULT_CONFIG, ...data };
    } catch (e) {
      console.error('Error loading config, using default:', e);
    }
  }
  return DEFAULT_CONFIG;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

let currentConfig = loadConfig();
if (!fs.existsSync(currentConfig.downloadDir)) {
  fs.mkdirSync(currentConfig.downloadDir, { recursive: true });
}

// In-Memory Games Database
let gamesCatalog = [];
let catalogStats = {
  total: 0,
  byPlatform: {},
  byCategory: {},
  lastRefreshed: null,
  isRefreshing: false
};

// Download Queue System
let downloadQueue = [];
let activeDownloads = new Map(); // id -> http request / subprocess handle

// Genre classifier helper
const GENRE_KEYWORDS = {
  'Action & Adventure': ['action', 'adventure', 'warrior', 'hero', 'battle', 'quest', 'chronicles', 'legend', 'blade', 'sword', 'hunter', 'god of war', 'uncharted', 'assassin', 'tomb raider', 'batman', 'spider', 'monster', 'dynasty'],
  'RPG & Strategy': ['rpg', 'fantasy', 'tactics', 'strategy', 'final fantasy', 'persona', 'tales of', 'disgaea', 'kingdom', 'dungeon', 'valkyria', 'fire emblem', 'arcana', 'ys', 'atelier', 'monster hunter', 'chronicle', 'valkyrie', 'soul', 'demon'],
  'Shooter & Sci-Fi': ['shooter', 'killzone', 'call of duty', 'resistance', 'unit 13', 'metal gear', 'sniper', 'gun', 'strike', 'space', 'alien', 'cyber', 'battlefield', 'borderlands'],
  'Fighting & Anime': ['fighting', 'tekken', 'street fighter', 'blazblue', 'guilty gear', 'naruto', 'dragon ball', 'one piece', 'fate', 'bleach', 'j-stars', 'soulcalibur', 'mortal kombat', 'brawl', 'versus', 'versus'],
  'Racing & Sports': ['racing', 'sports', 'fifa', 'nba', 'mlb', 'golf', 'wrc', 'gran turismo', 'ridge racer', 'wipeout', 'motorstorm', 'modnation', 'formula', 'drive', 'asphalt', 'speed', 'turbo', 'moto', 'bike', 'soccer'],
  'Platformer & Arcade': ['rayman', 'littlebigplanet', 'sonic', 'mario', 'crash', 'spyro', 'sly', 'ratchet', 'jak', 'limbo', 'fez', ' Guacamelee', 'patapon', 'locoroco', 'lumines', 'tetris', 'arcade', 'pinball'],
  'Puzzle & Casual': ['puzzle', 'casual', 'party', 'brain', 'chess', 'mahjong', 'sudoku', 'touch', 'smart', 'quiz', 'dance', 'sing', 'hatsune', 'miku', 'taiko', 'rhythm', 'sound shapes', 'escape plan', 'deviants']
};

function determineGenre(name, titleId) {
  const lowerName = (name || '').toLowerCase();
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some(kw => lowerName.includes(kw))) {
      return genre;
    }
  }
  // Deterministic genre based on TitleID hash for unclassified games to allow diversity in filtering
  const genres = Object.keys(GENRE_KEYWORDS);
  let hash = 0;
  for (let i = 0; i < titleId.length; i++) {
    hash = (hash << 5) - hash + titleId.charCodeAt(i);
    hash |= 0;
  }
  return genres[Math.abs(hash) % genres.length];
}

function parseTSV(text, platformKey, categoryKey) {
  const lines = text.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Title ID') && lines[i].includes('PKG direct link')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return [];

  const headers = lines[headerIndex].split('\t').map(h => h.trim());
  const idxTitleId = headers.indexOf('Title ID');
  const idxRegion = headers.indexOf('Region');
  const idxName = headers.indexOf('Name');
  const idxPkgLink = headers.indexOf('PKG direct link');
  const idxZRif = headers.indexOf('zRIF');
  const idxContentId = headers.indexOf('Content ID');
  const idxLastMod = headers.indexOf('Last Modification Date');
  const idxOriginalName = headers.indexOf('Original Name');
  const idxFileSize = headers.indexOf('File Size');
  const idxSha256 = headers.indexOf('SHA256');
  const idxRequiredFw = headers.indexOf('Required FW');
  const idxAppVer = headers.indexOf('App Version');

  const items = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = lines[i].split('\t');

    const titleId = parts[idxTitleId] ? parts[idxTitleId].trim() : '';
    const pkgUrl = parts[idxPkgLink] ? parts[idxPkgLink].trim() : '';

    if (!titleId || !pkgUrl || pkgUrl === 'MISSING') continue;

    const name = parts[idxName] ? parts[idxName].trim() : titleId;
    const region = parts[idxRegion] ? parts[idxRegion].trim() : 'UNKNOWN';
    const zRif = idxZRif !== -1 && parts[idxZRif] ? parts[idxZRif].trim() : '';
    const contentId = idxContentId !== -1 && parts[idxContentId] ? parts[idxContentId].trim() : '';
    const lastMod = idxLastMod !== -1 && parts[idxLastMod] ? parts[idxLastMod].trim() : '';
    const originalName = idxOriginalName !== -1 && parts[idxOriginalName] ? parts[idxOriginalName].trim() : '';
    const fileSizeStr = idxFileSize !== -1 && parts[idxFileSize] ? parts[idxFileSize].trim() : '0';
    const fileSize = parseInt(fileSizeStr, 10) || 0;
    const sha256 = idxSha256 !== -1 && parts[idxSha256] ? parts[idxSha256].trim() : '';
    const requiredFw = idxRequiredFw !== -1 && parts[idxRequiredFw] ? parts[idxRequiredFw].trim() : '';
    const appVersion = idxAppVer !== -1 && parts[idxAppVer] ? parts[idxAppVer].trim() : '';

    const id = `${platformKey}_${categoryKey}_${titleId}_${i}`;
    const genre = determineGenre(name, titleId);

    items.push({
      id,
      titleId,
      platform: platformKey,
      category: categoryKey,
      name,
      originalName,
      region,
      pkgUrl,
      zRif,
      contentId,
      lastMod,
      fileSize,
      fileSizeFormatted: formatBytes(fileSize),
      sha256,
      requiredFw,
      appVersion,
      genre
    });
  }

  return items;
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function fetchUrlText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrlText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

async function refreshCatalog() {
  if (catalogStats.isRefreshing) return;
  catalogStats.isRefreshing = true;
  console.log('Refreshing NoPayStation TSV feeds...');

  const allItems = [];
  const entries = Object.entries(currentConfig.tsvUrls);

  for (const [key, url] of entries) {
    const [platformKey, categoryKey] = key.split('_'); // e.g. PSV, GAMES
    try {
      const text = await fetchUrlText(url);
      const items = parseTSV(text, platformKey, categoryKey);
      allItems.push(...items);
      console.log(`Loaded ${items.length} entries for ${key}`);
    } catch (e) {
      console.error(`Failed to fetch TSV for ${key}:`, e.message);
    }
  }

  gamesCatalog = allItems;

  const byPlatform = {};
  const byCategory = {};
  allItems.forEach(item => {
    byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  });

  catalogStats = {
    total: allItems.length,
    byPlatform,
    byCategory,
    lastRefreshed: new Date().toISOString(),
    isRefreshing: false
  };

  console.log(`Catalog refresh completed! Total items: ${gamesCatalog.length}`);
}

// Initial catalog refresh on startup
refreshCatalog().catch(err => console.error('Initial refresh error:', err));

// Download Processor Loop
function processDownloadQueue() {
  const activeCount = Array.from(activeDownloads.values()).filter(d => d.status === 'downloading' || d.status === 'extracting').length;
  if (activeCount >= 2) return; // Max 2 concurrent downloads

  const nextItem = downloadQueue.find(item => item.status === 'pending');
  if (!nextItem) return;

  startDownload(nextItem);
}

function startDownload(item) {
  item.status = 'downloading';
  item.startedAt = new Date().toISOString();
  item.downloadedBytes = 0;
  item.speed = 0;
  item.error = null;

  const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const fileName = `${item.titleId}_${sanitizeFilename(item.name)}.pkg`;
  const targetPkgPath = path.join(currentConfig.downloadDir, fileName);
  item.pkgPath = targetPkgPath;

  const fileStream = fs.createWriteStream(targetPkgPath);
  const client = item.pkgUrl.startsWith('https') ? https : http;

  let lastTime = Date.now();
  let lastBytes = 0;

  const req = client.get(item.pkgUrl, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      // Follow redirect
      item.pkgUrl = res.headers.location;
      startDownload(item);
      return;
    }

    if (res.statusCode !== 200) {
      item.status = 'failed';
      item.error = `HTTP Server returned status ${res.statusCode}`;
      activeDownloads.delete(item.id);
      processDownloadQueue();
      return;
    }

    const totalBytes = parseInt(res.headers['content-length'] || item.fileSize || 0, 10);
    if (totalBytes > 0) item.fileSize = totalBytes;

    res.on('data', (chunk) => {
      item.downloadedBytes += chunk.length;
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 0.5) {
        const bytesDiff = item.downloadedBytes - lastBytes;
        item.speed = Math.round(bytesDiff / timeDiff);
        lastTime = now;
        lastBytes = item.downloadedBytes;
      }
      if (item.fileSize > 0) {
        item.progress = Math.min(100, Math.round((item.downloadedBytes / item.fileSize) * 100));
      }
    });

    res.pipe(fileStream);

    fileStream.on('finish', () => {
      fileStream.close();
      item.progress = 100;
      item.speed = 0;
      console.log(`Finished downloading PKG: ${fileName}`);

      // Start Extraction phase if pkg2zip is available
      triggerExtraction(item);
    });
  });

  req.on('error', (err) => {
    fs.unlink(targetPkgPath, () => {});
    item.status = 'failed';
    item.error = err.message;
    activeDownloads.delete(item.id);
    processDownloadQueue();
  });

  activeDownloads.set(item.id, { req, item, status: 'downloading' });
}

function resolvePkgToolPath(toolSetting) {
  if (path.isAbsolute(toolSetting) && fs.existsSync(toolSetting)) {
    return toolSetting;
  }
  const appRootPath = path.join(__dirname, toolSetting);
  if (fs.existsSync(appRootPath)) return appRootPath;

  const npsSubfolder = path.join(__dirname, 'NoPayStation', toolSetting);
  if (fs.existsSync(npsSubfolder)) return npsSubfolder;

  const downloadsPath = path.join(currentConfig.downloadDir, toolSetting);
  if (fs.existsSync(downloadsPath)) return downloadsPath;

  return toolSetting;
}

function triggerExtraction(item) {
  item.status = 'extracting';
  item.extractLog = 'Starting extraction with pkg2zip...';

  const rawTool = currentConfig.pkgDecTool || 'pkg2zip.exe';
  const pkgDecTool = resolvePkgToolPath(rawTool);
  const rawParams = currentConfig.pkgDecParams || '-x "{pkgFile}" "{zRifKey}"';

  // Format parameters
  const zRifKey = item.zRif || '';
  const paramString = rawParams
    .replace('{pkgFile}', item.pkgPath)
    .replace('{zRifKey}', zRifKey);

  const command = `"${pkgDecTool}" ${paramString}`;
  item.extractCommand = command;
  console.log(`Executing extraction command: ${command}`);

  exec(command, { cwd: currentConfig.downloadDir }, (error, stdout, stderr) => {
    if (error) {
      console.warn(`pkg2zip extraction note/warning for ${item.name}:`, error.message);
      item.extractLog = stdout + '\n' + stderr + '\n' + error.message;
      // Note: If zRIF is missing (e.g. some free themes/demos), pkg2zip will exit with notice, but PKG is downloaded.
      if (!zRifKey && !stdout) {
        item.status = 'completed';
        item.extractLog = 'PKG Downloaded successfully. (No zRIF required/provided for extraction)';
      } else {
        item.status = 'completed'; // Mark completed so user has access to PKG regardless
      }
    } else {
      console.log(`Extraction completed for ${item.name}`);
      item.status = 'completed';
      item.extractLog = stdout || 'Extracted successfully!';
    }

    item.completedAt = new Date().toISOString();
    activeDownloads.delete(item.id);
    processDownloadQueue();
  });
}

// REST API Endpoints
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.post('/api/config', (req, res) => {
  currentConfig = { ...currentConfig, ...req.body };
  saveConfig(currentConfig);
  if (!fs.existsSync(currentConfig.downloadDir)) {
    fs.mkdirSync(currentConfig.downloadDir, { recursive: true });
  }
  res.json({ success: true, config: currentConfig });
});

app.get('/api/stats', (req, res) => {
  res.json(catalogStats);
});

app.post('/api/refresh-tsv', async (req, res) => {
  try {
    refreshCatalog();
    res.json({ success: true, message: 'TSV Feed refresh initiated.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/games', (req, res) => {
  let { platform, category, region, genre, search, page = 1, pageSize = 24, sortBy = 'name' } = req.query;
  page = parseInt(page, 10) || 1;
  pageSize = parseInt(pageSize, 10) || 24;

  let results = gamesCatalog;

  if (platform && platform !== 'ALL') {
    results = results.filter(g => g.platform.toUpperCase() === platform.toUpperCase());
  }

  if (category && category !== 'ALL') {
    results = results.filter(g => g.category.toUpperCase() === category.toUpperCase());
  }

  if (region && region !== 'ALL') {
    results = results.filter(g => g.region.toUpperCase() === region.toUpperCase());
  }

  if (genre && genre !== 'ALL') {
    results = results.filter(g => g.genre === genre);
  }

  if (search) {
    const q = search.toLowerCase().trim();
    results = results.filter(g => 
      g.name.toLowerCase().includes(q) ||
      g.titleId.toLowerCase().includes(q) ||
      (g.originalName && g.originalName.toLowerCase().includes(q))
    );
  }

  // Sorting
  if (sortBy === 'name') {
    results.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'titleId') {
    results.sort((a, b) => a.titleId.localeCompare(b.titleId));
  } else if (sortBy === 'sizeDesc') {
    results.sort((a, b) => b.fileSize - a.fileSize);
  } else if (sortBy === 'sizeAsc') {
    results.sort((a, b) => a.fileSize - b.fileSize);
  }

  const total = results.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedItems = results.slice(startIndex, startIndex + pageSize);

  res.json({
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages,
    genres: Object.keys(GENRE_KEYWORDS)
  });
});

app.get('/api/downloads', (req, res) => {
  res.json(downloadQueue);
});

app.post('/api/downloads/enqueue', (req, res) => {
  const { id, titleId, name, platform, pkgUrl, zRif, fileSize } = req.body;
  if (!pkgUrl || !titleId) {
    return res.status(400).json({ error: 'Missing required game download parameters.' });
  }

  const existing = downloadQueue.find(d => d.id === id || (d.titleId === titleId && d.platform === platform));
  if (existing) {
    return res.json({ success: true, message: 'Item already in download queue.', item: existing });
  }

  const queueItem = {
    id: id || `${platform}_${titleId}_${Date.now()}`,
    titleId,
    name: name || titleId,
    platform,
    pkgUrl,
    zRif: zRif || '',
    fileSize: fileSize || 0,
    fileSizeFormatted: formatBytes(fileSize || 0),
    progress: 0,
    status: 'pending',
    addedAt: new Date().toISOString()
  };

  downloadQueue.push(queueItem);
  processDownloadQueue();

  res.json({ success: true, item: queueItem });
});

app.post('/api/downloads/cancel', (req, res) => {
  const { id } = req.body;
  const itemIndex = downloadQueue.findIndex(d => d.id === id);
  if (itemIndex !== -1) {
    const item = downloadQueue[itemIndex];
    if (activeDownloads.has(id)) {
      const active = activeDownloads.get(id);
      if (active.req) active.req.destroy();
      activeDownloads.delete(id);
    }
    item.status = 'cancelled';
    if (item.pkgPath && fs.existsSync(item.pkgPath)) {
      fs.unlink(item.pkgPath, () => {});
    }
    processDownloadQueue();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Download task not found' });
});

app.post('/api/downloads/clear', (req, res) => {
  downloadQueue = downloadQueue.filter(d => d.status === 'downloading' || d.status === 'extracting' || d.status === 'pending');
  res.json({ success: true, queue: downloadQueue });
});

// PSP Automatic Drive Detection & File Transfer Engine
app.get('/api/psp/detect', (req, res) => {
  const cmd = `powershell -Command "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, FreeSpace, Size, DriveType | ConvertTo-Json"`;
  exec(cmd, (err, stdout) => {
    if (err || !stdout || !stdout.trim()) {
      return res.json({ success: true, drives: [] });
    }
    try {
      let disks = JSON.parse(stdout.trim());
      if (!Array.isArray(disks)) disks = [disks];

      const pspDrives = [];
      disks.forEach(disk => {
        const driveLetter = disk.DeviceID; // e.g. "E:"
        const freeSpace = parseInt(disk.FreeSpace || 0, 10);
        const totalSize = parseInt(disk.Size || 0, 10);
        const volumeName = disk.VolumeName || 'Removable Disk';
        
        const pspPath = path.join(driveLetter, '\\PSP');
        const isoPath = path.join(driveLetter, '\\ISO');
        const pspEmuPath = path.join(driveLetter, '\\pspemu');

        const hasPspFolder = fs.existsSync(pspPath);
        const hasIsoFolder = fs.existsSync(isoPath);
        const hasPspEmuFolder = fs.existsSync(pspEmuPath);
        const isRemovable = disk.DriveType === 2 || (volumeName && volumeName.toUpperCase().includes('PSP'));

        if (hasPspFolder || hasIsoFolder || hasPspEmuFolder || isRemovable) {
          pspDrives.push({
            drive: driveLetter,
            volumeName: volumeName || 'PSP Storage',
            freeSpace,
            freeSpaceFormatted: formatBytes(freeSpace),
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            hasPspFolder,
            hasIsoFolder,
            hasPspEmuFolder,
            isRemovable,
            isoDir: hasIsoFolder ? isoPath : path.join(driveLetter, '\\ISO'),
            gameDir: hasPspFolder ? path.join(driveLetter, '\\PSP\\GAME') : (hasPspEmuFolder ? path.join(driveLetter, '\\pspemu\\PSP\\GAME') : path.join(driveLetter, '\\PSP\\GAME'))
          });
        }
      });

      res.json({ success: true, drives: pspDrives });
    } catch (e) {
      res.json({ success: false, error: e.message, drives: [] });
    }
  });
});

app.post('/api/psp/transfer', (req, res) => {
  const { downloadId, targetDrive, targetType } = req.body;
  const item = downloadQueue.find(d => d.id === downloadId);

  if (!item) {
    return res.status(404).json({ error: 'Download item not found in queue.' });
  }

  if (!targetDrive) {
    return res.status(400).json({ error: 'Target PSP drive is required.' });
  }

  const spaceCheckCmd = `powershell -Command "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${targetDrive}'\\").FreeSpace"`;
  exec(spaceCheckCmd, (err, stdout) => {
    const freeSpace = parseInt((stdout || '').trim() || '0', 10);
    const requiredSize = item.fileSize || 0;

    if (freeSpace > 0 && freeSpace < requiredSize) {
      return res.status(400).json({
        error: `Insufficient storage space on PSP drive ${targetDrive}! Required: ${formatBytes(requiredSize)}, Available: ${formatBytes(freeSpace)}`
      });
    }

    let destDir = targetType === 'GAME' 
      ? path.join(targetDrive, '\\PSP\\GAME')
      : path.join(targetDrive, '\\ISO');

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let filesToMove = [];
    if (item.pkgPath && fs.existsSync(item.pkgPath)) {
      filesToMove.push(item.pkgPath);
    }

    if (fs.existsSync(currentConfig.downloadDir)) {
      const filesInDownloadDir = fs.readdirSync(currentConfig.downloadDir);
      filesInDownloadDir.forEach(f => {
        if (f.includes(item.titleId) || (item.name && f.includes(item.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_')))) {
          const fullP = path.join(currentConfig.downloadDir, f);
          if (!filesToMove.includes(fullP)) filesToMove.push(fullP);
        }
      });
    }

    if (filesToMove.length === 0) {
      return res.status(404).json({ error: 'No downloaded files found for this title to transfer.' });
    }

    try {
      const transferredNames = [];
      filesToMove.forEach(src => {
        const dest = path.join(destDir, path.basename(src));
        fs.copyFileSync(src, dest);
        transferredNames.push(path.basename(src));
      });

      item.transferredToPsp = true;
      item.pspTransferPath = destDir;

      res.json({
        success: true,
        message: `Transferred ${item.name} to ${destDir}`,
        transferredFiles: transferredNames
      });
    } catch (copyErr) {
      res.status(500).json({ error: 'File copy to PSP failed: ' + copyErr.message });
    }
  });
});

app.post('/api/vita/transfer', async (req, res) => {
  const { downloadId, ip, type } = req.body;
  
  if (!downloadId || !ip || !type) {
    return res.status(400).json({ error: 'Missing downloadId, ip, or type.' });
  }

  const item = downloadQueue.find(d => d.id === downloadId);
  if (!item) {
    return res.status(404).json({ error: 'Download item not found in queue.' });
  }

  let destDir = type === 'adrenaline' 
    ? '/ux0:/pspemu/PSP/GAME'
    : '/ux0:'; // Base dir for NoNpDrm is /ux0:/

  let filesToMove = [];
  
  if (fs.existsSync(currentConfig.downloadDir)) {
    // 1. If it's a PSP game, pkg2zip might have extracted an ISO or EBOOT
    if (type === 'adrenaline') {
      const pspIsoDir = path.join(currentConfig.downloadDir, 'pspemu', 'ISO');
      if (fs.existsSync(pspIsoDir)) {
        const isos = fs.readdirSync(pspIsoDir);
        isos.forEach(iso => {
          if (iso.includes(item.titleId) || (item.name && iso.includes(item.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_')))) {
            filesToMove.push({ local: path.join(pspIsoDir, iso), remote: `/ux0:/pspemu/ISO/${iso}`, isDir: false });
          }
        });
      }
      
      const pspGameDir = path.join(currentConfig.downloadDir, 'pspemu', 'PSP', 'GAME', item.titleId);
      if (fs.existsSync(pspGameDir)) {
        filesToMove.push({ local: pspGameDir, remote: `/ux0:/pspemu/PSP/GAME/${item.titleId}`, isDir: true });
      }
    } else {
      // 2. Vita games. Check for NoNpDrm folders (app, addcont, patch, bgdl)
      let foundFolder = false;
      const subDirs = ['app', 'addcont', 'patch', 'bgdl'];
      subDirs.forEach(sub => {
        const potentialPath = path.join(currentConfig.downloadDir, sub, item.titleId);
        if (fs.existsSync(potentialPath)) {
          filesToMove.push({ local: potentialPath, remote: `/ux0:/${sub}/${item.titleId}`, isDir: true });
          foundFolder = true;
        }
      });
      
      // 3. Fallback to PKG only if NO extracted folder was found.
      if (!foundFolder && item.pkgPath && fs.existsSync(item.pkgPath)) {
         filesToMove.push({ local: item.pkgPath, remote: `/ux0:/downloads/${path.basename(item.pkgPath)}`, isDir: false });
      }
    }
  }

  if (filesToMove.length === 0) {
    return res.status(404).json({ error: 'No extracted folders or files found for this title to transfer.' });
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ip,
      port: 1337,
      secure: false
    });

    const transferredNames = [];
    for (const move of filesToMove) {
      if (move.isDir) {
        const parentDir = path.posix.dirname(move.remote);
        await client.ensureDir(parentDir); // e.g. /ux0:/app
        await client.ensureDir(move.remote); // e.g. /ux0:/app/TITLE_ID
        await client.uploadFromDir(move.local, move.remote);
        transferredNames.push(path.basename(move.remote) + ' (Folder)');
      } else {
        const parentDir = path.posix.dirname(move.remote);
        await client.ensureDir(parentDir);
        await client.uploadFrom(move.local, move.remote);
        transferredNames.push(path.basename(move.remote));
      }
    }

    item.transferredToVita = true;
    item.vitaTransferPath = destDir;
    item.vitaIp = ip;

    res.json({
      success: true,
      message: `Transferred ${item.name} to ${ip} via NoNpDrm`,
      transferredFiles: transferredNames
    });
  } catch (err) {
    console.error("FTP Transfer Error:", err);
    res.status(500).json({ error: 'FTP Transfer failed: ' + err.message });
  } finally {
    client.close();
  }
});

app.listen(PORT, () => {
  console.log(`NoPayStation Modern Frontend running on http://localhost:${PORT}`);
});
