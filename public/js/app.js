import { getCoverUrl, getCoverUrls, generateCardFallbackGradient, handleCoverError } from './covers.js';
window.handleCoverError = handleCoverError;

// Application State
const state = {
  platform: 'ALL',
  category: 'GAMES',
  region: 'ALL',
  genre: 'ALL',
  search: '',
  page: 1,
  pageSize: 24,
  sortBy: 'name',
  items: [],
  total: 0,
  totalPages: 1,
  genres: [],
  downloads: [],
  pspDrives: [],
  selectedDownloadForPsp: null,
  config: {}
};

// DOM Selectors
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadConfig();
  fetchStats();
  fetchCatalog();
  startDownloadPolling();
  startPspPolling();
});

function initEventListeners() {
  // Search bar listener with debounce
  let searchTimeout;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      fetchCatalog();
    }, 300);
  });

  // Sidebar navigation click delegates
  $$('.nav-item[data-platform]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item[data-platform]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.platform = btn.getAttribute('data-platform');
      state.page = 1;
      fetchCatalog();
    });
  });

  // Category switch tabs (Games, DLCs, Themes)
  $$('.nav-item[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item[data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.category = btn.getAttribute('data-category');
      state.page = 1;
      fetchCatalog();
    });
  });

  // Region filter pills
  $$('.filter-pill[data-region]').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.filter-pill[data-region]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.region = pill.getAttribute('data-region');
      state.page = 1;
      fetchCatalog();
    });
  });

  // Sort dropdown selector
  $('#sortSelect').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    fetchCatalog();
  });

  // Pagination buttons
  $('#prevPageBtn').addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      fetchCatalog();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  $('#nextPageBtn').addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      fetchCatalog();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Modal open/close listeners
  $('#settingsBtn').addEventListener('click', () => openSettingsModal());
  $('#closeSettingsModal').addEventListener('click', () => closeSettingsModal());
  $('#settingsForm').addEventListener('submit', handleSaveSettings);

  $('#closeDetailModal').addEventListener('click', () => {
    $('#gameDetailModal').classList.remove('active');
  });

  // Refresh feed button
  $('#refreshFeedBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/refresh-tsv', { method: 'POST' });
      alert('Catalog TSV feeds refresh started in background.');
      setTimeout(fetchCatalog, 2000);
    } catch (e) {
      alert('Error triggering TSV refresh: ' + e.message);
    }
  });

  // Toggle download drawer minimize
  $('#drawerToggleBtn').addEventListener('click', () => {
    const content = $('#drawerContent');
    if (content.style.display === 'none') {
      content.style.display = 'flex';
      $('#drawerToggleIcon').style.transform = 'rotate(0deg)';
    } else {
      content.style.display = 'none';
      $('#drawerToggleIcon').style.transform = 'rotate(180deg)';
    }
  });

  $('#clearCompletedBtn').addEventListener('click', async () => {
    await fetch('/api/downloads/clear', { method: 'POST' });
    fetchDownloads();
  });

  // PSP Drive listeners
  $('#pspStatusBadge').addEventListener('click', () => detectPspDrives(true));
  $('#closePspTransferModal').addEventListener('click', () => {
    $('#pspTransferModal').classList.remove('active');
  });

  $('#pspDriveSelect').addEventListener('change', updatePspStorageBar);
  $$('input[name="pspFolderType"]').forEach(r => r.addEventListener('change', updatePspStorageBar));

  $('#confirmPspTransferBtn').addEventListener('click', handleConfirmPspTransfer);
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.byPlatform) {
      $('#badge-PSV').textContent = data.byPlatform['PSV'] || 0;
      $('#badge-PSP').textContent = data.byPlatform['PSP'] || 0;
      $('#badge-PSX').textContent = data.byPlatform['PSX'] || 0;
      $('#badge-PS3').textContent = data.byPlatform['PS3'] || 0;
      $('#badge-PSM').textContent = data.byPlatform['PSM'] || 0;
    }
  } catch (e) {
    console.error('Error fetching stats:', e);
  }
}

async function fetchCatalog() {
  const grid = $('#catalogGrid');
  grid.innerHTML = '<div class="empty-state"><span>Loading NoPayStation database...</span></div>';

  const params = new URLSearchParams({
    platform: state.platform,
    category: state.category,
    region: state.region,
    genre: state.genre,
    search: state.search,
    page: state.page,
    pageSize: state.pageSize,
    sortBy: state.sortBy
  });

  try {
    const res = await fetch(`/api/games?${params.toString()}`);
    const data = await res.json();

    state.items = data.items || [];
    state.total = data.total || 0;
    state.totalPages = data.totalPages || 1;
    state.genres = data.genres || [];

    renderGenrePills();
    renderGrid();
    renderPagination();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p>Error connecting to backend server: ${e.message}</p></div>`;
  }
}

function renderGenrePills() {
  const container = $('#genrePillsContainer');
  if (!container) return;

  let html = `<div class="filter-pill ${state.genre === 'ALL' ? 'active' : ''}" data-genre="ALL">All Genres</div>`;
  state.genres.forEach(g => {
    html += `<div class="filter-pill ${state.genre === g ? 'active' : ''}" data-genre="${g}">${g}</div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.genre = pill.getAttribute('data-genre');
      state.page = 1;
      fetchCatalog();
    });
  });
}

function renderGrid() {
  const grid = $('#catalogGrid');
  grid.innerHTML = '';

  if (state.items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <h3>No titles found</h3>
        <p>Try adjusting your search criteria or selecting a different platform.</p>
      </div>
    `;
    return;
  }

  state.items.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';

    const coverUrls = getCoverUrls(game.titleId, game.platform, game.region);
    const coverUrl = coverUrls[0] || '';
    const bgGradient = generateCardFallbackGradient(game.titleId);
    const fallbacksAttr = JSON.stringify(coverUrls).replace(/"/g, '&quot;');

    card.innerHTML = `
      <div class="card-cover" style="background: ${bgGradient};">
        <span class="platform-tag">${game.platform}</span>
        <span class="region-badge ${game.region}">${game.region}</span>
        <img src="${coverUrl}" alt="${game.name}" loading="lazy" data-fallbacks="${fallbacksAttr}" data-fallback-index="0" onerror="window.handleCoverError(this)" />
        <div class="card-cover-fallback" style="display: none;">
          <div class="fallback-title">${game.name}</div>
          <div class="fallback-platform">${game.platform} • ${game.titleId}</div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${game.name}">${game.name}</div>
        <div class="card-meta">
          <span class="card-genre">${game.genre}</span>
          <span>${game.fileSizeFormatted}</span>
        </div>
        <div class="card-actions">
          <button class="download-btn" data-id="${game.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download PKG
          </button>
        </div>
      </div>
    `;

    // Click card to open modal
    card.addEventListener('click', (e) => {
      if (e.target.closest('.download-btn')) {
        e.stopPropagation();
        triggerDownload(game);
      } else {
        openDetailModal(game);
      }
    });

    grid.appendChild(card);
  });
}

function renderPagination() {
  $('#currentPageInfo').textContent = `Page ${state.page} of ${state.totalPages} (${state.total.toLocaleString()} items)`;
  $('#prevPageBtn').disabled = state.page <= 1;
  $('#nextPageBtn').disabled = state.page >= state.totalPages;
}

function openDetailModal(game) {
  const modal = $('#gameDetailModal');
  const coverUrls = getCoverUrls(game.titleId, game.platform, game.region);
  const coverImg = $('#modalGameCover');
  
  coverImg.setAttribute('data-fallbacks', JSON.stringify(coverUrls));
  coverImg.setAttribute('data-fallback-index', '0');
  coverImg.onerror = () => handleCoverError(coverImg);
  coverImg.src = coverUrls[0] || '';

  $('#modalGameTitle').textContent = game.name;
  $('#modalGameTitleId').textContent = game.titleId;
  $('#modalGamePlatform').textContent = `${game.platform} (${game.category})`;
  $('#modalGameRegion').textContent = game.region;
  $('#modalGameSize').textContent = game.fileSizeFormatted;
  $('#modalGameFw').textContent = game.requiredFw ? `FW ${game.requiredFw}` : 'N/A';
  $('#modalGameGenre').textContent = game.genre;
  $('#modalGameZRif').value = game.zRif || 'No zRIF required or available for this title';
  $('#modalGamePkgUrl').value = game.pkgUrl;

  const downloadBtn = $('#modalDownloadBtn');
  downloadBtn.onclick = () => {
    triggerDownload(game);
    modal.classList.remove('active');
  };

  modal.classList.add('active');
}

async function triggerDownload(game) {
  try {
    const res = await fetch('/api/downloads/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(game)
    });
    const data = await res.json();
    if (data.success) {
      $('#drawerContent').style.display = 'flex';
      fetchDownloads();
    }
  } catch (e) {
    alert('Failed to enqueue download: ' + e.message);
  }
}

function startDownloadPolling() {
  fetchDownloads();
  setInterval(fetchDownloads, 2000);
}

async function fetchDownloads() {
  try {
    const res = await fetch('/api/downloads');
    const queue = await res.json();
    state.downloads = queue;
    renderDownloadDrawer();
  } catch (e) {
    console.error('Error fetching download queue:', e);
  }
}

function renderDownloadDrawer() {
  const drawerCount = $('#downloadQueueCount');
  const drawerContent = $('#drawerContent');

  const activeCount = state.downloads.filter(d => d.status === 'downloading' || d.status === 'extracting' || d.status === 'pending').length;
  drawerCount.textContent = `${activeCount} Active`;

  if (state.downloads.length === 0) {
    drawerContent.innerHTML = '<div style="color: var(--text-dim); text-align: center; width: 100%; padding: 1rem;">No active or completed downloads in queue.</div>';
    return;
  }

  let html = '';
  state.downloads.slice().reverse().forEach(item => {
    let statusText = item.status.toUpperCase();
    if (item.status === 'downloading') {
      statusText = `DOWNLOADING (${formatSpeed(item.speed)})`;
    } else if (item.status === 'extracting') {
      statusText = 'EXTRACTING WITH PKG2ZIP...';
    }

    const isCompleted = item.status === 'completed';
    const isTransferred = item.transferredToPsp;

    html += `
      <div class="download-item-card">
        <div class="item-details">
          <div class="item-title-row">
            <span>${item.name} (${item.titleId})</span>
            <span style="font-size: 0.8rem; color: ${isCompleted ? 'var(--accent-green)' : item.status === 'failed' ? 'var(--accent-pink)' : 'var(--accent-cyan)'};">${statusText}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${item.progress || 0}%;"></div>
          </div>
          <div class="item-meta-row">
            <span>Size: ${item.fileSizeFormatted}</span>
            <span>Progress: ${item.progress || 0}%</span>
          </div>
          ${item.extractLog ? `<div style="font-size: 0.7rem; font-family: monospace; color: var(--text-muted); background: rgba(0,0,0,0.3); padding: 0.3rem 0.5rem; border-radius: 4px; margin-top: 0.3rem;">${item.extractLog}</div>` : ''}
        </div>
        ${item.status === 'downloading' || item.status === 'pending' ? `
          <button onclick="cancelDownload('${item.id}')" style="background: none; border: 1px solid var(--glass-border); color: var(--text-dim); padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer;">Cancel</button>
        ` : ''}
        ${isCompleted ? `
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
            <button onclick="openPspTransferModal('${item.id}')" style="background: ${isTransferred ? 'rgba(0,255,136,0.15)' : 'linear-gradient(135deg, var(--accent-green), var(--accent-blue))'}; color: ${isTransferred ? 'var(--accent-green)' : '#000'}; font-weight: 800; border: 1px solid var(--accent-green); padding: 0.5rem 0.9rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 0.4rem; flex: 1; justify-content: center;">
              🎮 ${isTransferred ? 'Installed on PSP' : 'Transfer to PSP'}
            </button>
            <button onclick="openVitaTransferModal('${item.id}')" style="background: ${item.transferredToVita ? 'rgba(157,78,221,0.15)' : 'linear-gradient(135deg, var(--accent-purple), var(--accent-blue))'}; color: ${item.transferredToVita ? 'var(--accent-purple)' : '#fff'}; font-weight: 800; border: 1px solid var(--accent-purple); padding: 0.5rem 0.9rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 0.4rem; flex: 1; justify-content: center;">
              🌐 ${item.transferredToVita ? 'Sent to Vita' : 'Transfer to Vita'}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  });

  drawerContent.innerHTML = html;
}

window.cancelDownload = async function(id) {
  await fetch('/api/downloads/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  fetchDownloads();
};

// PSP Detection & Installation Controller Logic
function startPspPolling() {
  detectPspDrives();
  setInterval(detectPspDrives, 4000);
}

async function detectPspDrives(userTriggered = false) {
  try {
    const res = await fetch('/api/psp/detect');
    const data = await res.json();
    state.pspDrives = data.drives || [];

    const badge = $('#pspStatusBadge');
    if (state.pspDrives.length > 0) {
      const primaryDrive = state.pspDrives[0];
      badge.innerHTML = `<span>🟢 PSP Connected (${primaryDrive.drive} • ${primaryDrive.freeSpaceFormatted} Free)</span>`;
      badge.style.borderColor = 'var(--accent-green)';
      badge.style.color = 'var(--accent-green)';
    } else {
      badge.innerHTML = `<span>🎮 No PSP Detected</span>`;
      badge.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      badge.style.color = 'var(--text-muted)';
    }

    if (userTriggered) {
      if (state.pspDrives.length > 0) {
        alert(`Detected ${state.pspDrives.length} PSP drive(s):\n` + state.pspDrives.map(d => `- Drive ${d.drive} (${d.volumeName}) - ${d.freeSpaceFormatted} Free`).join('\n'));
      } else {
        alert('No PSP drive detected. Make sure your PSP is connected via USB and set to USB Connection Mode.');
      }
    }
  } catch (e) {
    console.error('Error detecting PSP drives:', e);
  }
}

window.openPspTransferModal = function(downloadId) {
  const item = state.downloads.find(d => d.id === downloadId);
  if (!item) return;

  state.selectedDownloadForPsp = item;

  $('#pspModalGameTitle').textContent = `${item.name} (${item.titleId})`;
  $('#pspModalGameSize').textContent = `File Size: ${item.fileSizeFormatted}`;

  const driveSelect = $('#pspDriveSelect');
  driveSelect.innerHTML = '';

  if (state.pspDrives.length === 0) {
    driveSelect.innerHTML = '<option value="">No PSP Drive Detected - Connect PSP via USB</option>';
  } else {
    state.pspDrives.forEach((d, idx) => {
      const option = document.createElement('option');
      option.value = d.drive;
      const typeLabel = idx === 0 ? 'Memory Card / SD Card' : 'System Storage';
      option.textContent = `Drive ${d.drive} [${typeLabel}] - ${d.freeSpaceFormatted} Free (Total: ${d.totalSizeFormatted})`;
      driveSelect.appendChild(option);
    });
  }

  updatePspStorageBar();
  $('#pspTransferModal').classList.add('active');
};

function updatePspStorageBar() {
  const item = state.selectedDownloadForPsp;
  if (!item) return;

  const driveLetter = $('#pspDriveSelect').value;
  const drive = state.pspDrives.find(d => d.drive === driveLetter);

  const textElem = $('#pspStorageStatusText');
  const barElem = $('#pspStorageBarFill');
  const confirmBtn = $('#confirmPspTransferBtn');

  if (!drive) {
    textElem.textContent = 'Please connect your PSP via USB in USB Connection Mode.';
    textElem.style.color = 'var(--accent-pink)';
    barElem.style.width = '0%';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
    return;
  }

  const freeSpace = drive.freeSpace || 0;
  const requiredSize = item.fileSize || 0;

  if (freeSpace < requiredSize) {
    textElem.textContent = `⚠️ Insufficient Space! Required: ${item.fileSizeFormatted}, Available: ${drive.freeSpaceFormatted}`;
    textElem.style.color = 'var(--accent-pink)';
    barElem.style.width = '100%';
    barElem.style.background = 'var(--accent-pink)';
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
  } else {
    const usedPercentage = drive.totalSize > 0 ? Math.min(100, Math.round(((drive.totalSize - freeSpace) / drive.totalSize) * 100)) : 50;
    textElem.textContent = `Space Available! Required: ${item.fileSizeFormatted} | Free: ${drive.freeSpaceFormatted}`;
    textElem.style.color = 'var(--accent-green)';
    barElem.style.width = `${usedPercentage}%`;
    barElem.style.background = 'var(--accent-green)';
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
  }
}

async function handleConfirmPspTransfer() {
  const item = state.selectedDownloadForPsp;
  const driveLetter = $('#pspDriveSelect').value;
  const folderType = document.querySelector('input[name="pspFolderType"]:checked')?.value || 'ISO';

  if (!item || !driveLetter) return;

  const btn = $('#confirmPspTransferBtn');
  btn.disabled = true;
  btn.textContent = 'Transferring game to PSP...';

  try {
    const res = await fetch('/api/psp/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloadId: item.id,
        targetDrive: driveLetter,
        targetType: folderType
      })
    });

    const data = await res.json();
    if (data.success) {
      alert(`Success! ${data.message}`);
      $('#pspTransferModal').classList.remove('active');
      fetchDownloads();
    } else {
      alert('Transfer error: ' + (data.error || 'Failed to copy file to PSP.'));
    }
  } catch (e) {
    alert('Failed to complete transfer: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Transfer & Install to PSP';
  }
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
  return `${(kb / 1024).toFixed(2)} MB/s`;
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
  } catch (e) {
    console.error('Error loading config:', e);
  }
}

function openSettingsModal() {
  const modal = $('#settingsModal');
  const cfg = state.config;

  $('#cfgDownloadDir').value = cfg.downloadDir || '';
  $('#cfgPkgDecTool').value = cfg.pkgDecTool || '';
  $('#cfgPkgDecParams').value = cfg.pkgDecParams || '';
  $('#cfgHmacKey').value = cfg.hmacKey || '';

  modal.classList.add('active');
}

function closeSettingsModal() {
  $('#settingsModal').classList.remove('active');
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const updated = {
    downloadDir: $('#cfgDownloadDir').value,
    pkgDecTool: $('#cfgPkgDecTool').value,
    pkgDecParams: $('#cfgPkgDecParams').value,
    hmacKey: $('#cfgHmacKey').value
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    const data = await res.json();
    if (data.success) {
      state.config = data.config;
      closeSettingsModal();
      alert('Settings updated successfully!');
    }
  } catch (e) {
    alert('Failed to save settings: ' + e.message);
  }
}

// --- Vita Transfer Logic ---
let currentVitaDownloadId = null;

window.openVitaTransferModal = function(downloadId) {
  const item = state.downloads.find(d => d.id === downloadId);
  if (!item) return;

  currentVitaDownloadId = downloadId;
  $('#vitaModalGameTitle').textContent = `${item.name} (${item.titleId})`;

  const savedIp = localStorage.getItem('vitaIp') || '';
  $('#vitaIpInput').value = savedIp;

  $('#vitaTransferProgressContainer').style.display = 'none';
  $('#vitaTransferStatusText').textContent = 'Transferring via FTP...';
  
  const btn = $('#confirmVitaTransferBtn');
  btn.disabled = false;
  btn.textContent = 'Start FTP Transfer';
  btn.style.opacity = '1';

  $('#vitaTransferModal').classList.add('active');
};

$('#closeVitaTransferModal').addEventListener('click', () => {
  $('#vitaTransferModal').classList.remove('active');
});

$('#confirmVitaTransferBtn').addEventListener('click', async () => {
  const ip = $('#vitaIpInput').value.trim();
  if (!ip) {
    alert('Please enter a valid IP address for the PS Vita.');
    return;
  }

  localStorage.setItem('vitaIp', ip);

  const targetType = document.querySelector('input[name="vitaFolderType"]:checked').value;

  const btn = $('#confirmVitaTransferBtn');
  btn.disabled = true;
  btn.textContent = 'Transferring... Please wait';
  btn.style.opacity = '0.7';

  $('#vitaTransferProgressContainer').style.display = 'block';
  $('#vitaTransferStatusText').textContent = `Connecting to ${ip}:1337...`;

  try {
    const res = await fetch('/api/vita/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        downloadId: currentVitaDownloadId,
        ip: ip,
        type: targetType
      })
    });

    const data = await res.json();
    if (data.success) {
      $('#vitaTransferStatusText').textContent = 'Transfer Complete!';
      setTimeout(() => {
        $('#vitaTransferModal').classList.remove('active');
        fetchDownloads(); // Refresh list to update badge
      }, 1500);
    } else {
      alert('Transfer Failed: ' + data.error);
      $('#vitaTransferProgressContainer').style.display = 'none';
      btn.disabled = false;
      btn.textContent = 'Start FTP Transfer';
      btn.style.opacity = '1';
    }
  } catch (e) {
    alert('Error connecting to backend: ' + e.message);
    $('#vitaTransferProgressContainer').style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Start FTP Transfer';
    btn.style.opacity = '1';
  }
});
