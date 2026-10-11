// High-availability cover resolution & classification metadata engine

const HEXFLOW_BASE = 'https://raw.githubusercontent.com/jimbob4000/hexflow-covers/main/Covers';

export function getCoverUrls(titleId, platform, region = 'US') {
  if (!titleId) return [];
  const cleanId = titleId.trim().toUpperCase();
  const urls = [];

  if (platform === 'PSV') {
    urls.push(`${HEXFLOW_BASE}/PSVita/${cleanId}.png`);
    urls.push(`https://art.gametdb.com/psv/cover/US/${cleanId}.jpg`);
    urls.push(`https://art.gametdb.com/psv/cover/EN/${cleanId}.jpg`);
    urls.push(`https://art.gametdb.com/psv/cover/JA/${cleanId}.jpg`);
  } else if (platform === 'PSP') {
    urls.push(`${HEXFLOW_BASE}/PSP/${cleanId}.png`);
    urls.push(`https://art.gametdb.com/psp/cover/US/${cleanId}.jpg`);
    urls.push(`https://art.gametdb.com/psp/cover/EN/${cleanId}.jpg`);
    urls.push(`https://art.gametdb.com/psp/cover/JA/${cleanId}.jpg`);
  } else if (platform === 'PSX') {
    urls.push(`${HEXFLOW_BASE}/PS1/${cleanId}.png`);
    urls.push(`${HEXFLOW_BASE}/Retro/${cleanId}.png`);
  } else if (platform === 'PS3') {
    let regionCode = 'US';
    if (cleanId.startsWith('BLE') || cleanId.startsWith('NPE')) regionCode = 'EN';
    if (cleanId.startsWith('BLJ') || cleanId.startsWith('BCJ') || cleanId.startsWith('NPJ')) regionCode = 'JA';

    urls.push(`https://art.gametdb.com/ps3/cover/${regionCode}/${cleanId}.jpg`);
    if (regionCode !== 'US') urls.push(`https://art.gametdb.com/ps3/cover/US/${cleanId}.jpg`);
    if (regionCode !== 'EN') urls.push(`https://art.gametdb.com/ps3/cover/EN/${cleanId}.jpg`);
    if (regionCode !== 'JA') urls.push(`https://art.gametdb.com/ps3/cover/JA/${cleanId}.jpg`);
    urls.push(`${HEXFLOW_BASE}/Retro/${cleanId}.png`);
  } else if (platform === 'PSM') {
    urls.push(`${HEXFLOW_BASE}/HOMEBREW/${cleanId}.png`);
  }

  return urls;
}

export function getCoverUrl(titleId, platform, region) {
  const urls = getCoverUrls(titleId, platform, region);
  return urls.length > 0 ? urls[0] : null;
}

export function handleCoverError(imgElement) {
  const fallbacksStr = imgElement.getAttribute('data-fallbacks');
  if (!fallbacksStr) {
    imgElement.style.display = 'none';
    if (imgElement.nextElementSibling) imgElement.nextElementSibling.style.display = 'flex';
    return;
  }

  try {
    const fallbacks = JSON.parse(fallbacksStr);
    const currentIndex = parseInt(imgElement.getAttribute('data-fallback-index') || '0', 10);
    const nextIndex = currentIndex + 1;

    if (nextIndex < fallbacks.length) {
      imgElement.setAttribute('data-fallback-index', nextIndex);
      imgElement.src = fallbacks[nextIndex];
    } else {
      imgElement.style.display = 'none';
      if (imgElement.nextElementSibling) imgElement.nextElementSibling.style.display = 'flex';
    }
  } catch (e) {
    imgElement.style.display = 'none';
    if (imgElement.nextElementSibling) imgElement.nextElementSibling.style.display = 'flex';
  }
}

export function generateCardFallbackGradient(titleId) {
  let hash = 0;
  for (let i = 0; i < (titleId || '').length; i++) {
    hash = (hash << 5) - hash + titleId.charCodeAt(i);
    hash |= 0;
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 50) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 20%), hsl(${hue2}, 80%, 12%))`;
}
