// ==========================================================================
// OFICINA II — Jukebox Diegética, Confirmação & Física de Queda/Quebra 2D
// ==========================================================================

const STORAGE_KEY = 'oficinaII_entries_v1';
const MAX_VISIBLE_RANKING = 3;
const SYNC_CHANNEL_NAME = 'oficinaII_sync_v1';

const urlParams = new URLSearchParams(window.location.search);
const isTvWindow = urlParams.get('mode') === 'tv';
let currentViewMode = isTvWindow ? 'tv' : 'unified';
const syncChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;

let allEntries = [];
let selectedSong = null;
let searchResults = [];
let activeDropdownIndex = -1;
let searchDebounceTimer = null;
let latestSearchToken = 0;
let pendingSubmission = null;

// YouTube Audio-Only Loop Engine
let ytPlayer = null;
let ytApiReady = false;
let currentPlayingVideoId = null;
let onYtApiReadyCallback = null;

window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (typeof onYtApiReadyCallback === 'function') {
    onYtApiReadyCallback();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const stage = document.getElementById('stage');
  const jukebox = document.getElementById('jukebox');
  const form = document.getElementById('cocreationForm');
  const songSearchInput = document.getElementById('songSearchInput');
  const searchSpinner = document.getElementById('searchSpinner');
  const searchResultsDropdown = document.getElementById('searchResultsDropdown');
  const searchCombobox = document.getElementById('searchCombobox');

  const selectedSongCard = document.getElementById('selectedSongCard');
  const selectedSongTitle = document.getElementById('selectedSongTitle');
  const clearSongBtn = document.getElementById('clearSongBtn');

  const participantNameInput = document.getElementById('participantName');
  const songMeaningInput = document.getElementById('songMeaning');
  const formError = document.getElementById('formError');

  const rankingList = document.getElementById('rankingList');
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const downloadCountBadge = document.getElementById('downloadCountBadge');
  const shatteredCountText = document.getElementById('shatteredCountText');
  const tvModeBtn = document.getElementById('tvModeBtn');
  const tvModeLabel = document.getElementById('tvModeLabel');

  // Popup de Confirmação
  const confirmModal = document.getElementById('confirmModal');
  const confirmModalSub = document.getElementById('confirmModalSub');
  const confirmYesBtn = document.getElementById('confirmYesBtn');
  const confirmNoBtn = document.getElementById('confirmNoBtn');

  // Elementos diegéticos da Jukebox
  const vinyl = document.getElementById('vinyl');
  const vinylLabel = document.getElementById('vinylLabel');
  const tonearm = document.getElementById('tonearm');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const vfd = document.querySelector('.vfd');
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');

  // Canvas de Física 2D
  const physicsCanvas = document.getElementById('physicsCanvas');
  const pCtx = physicsCanvas.getContext('2d');

  // --------------------------------------------------------------------------
  // 0. Escala Automática de Tela Única
  // --------------------------------------------------------------------------

  function fitStageToViewport() {
    if (!stage) return;
    stage.style.transform = 'scale(1)';
    const extraH = currentViewMode === 'controller' ? 24 : 70;
    const naturalHeight = stage.offsetHeight + extraH;
    const naturalWidth = stage.offsetWidth + 32;
    const scaleY = window.innerHeight / naturalHeight;
    const scaleX = window.innerWidth / naturalWidth;
    const scale = Math.min(1, scaleY, scaleX);
    stage.style.transform = `scale(${scale.toFixed(3)})`;
  }

  window.addEventListener('resize', () => {
    fitStageToViewport();
    resizePhysicsCanvas();
  });
  fitStageToViewport();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitStageToViewport);
  }

  // --------------------------------------------------------------------------
  // 1. Armazenamento & Contadores
  // --------------------------------------------------------------------------

  function loadStoredEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          allEntries = parsed;
        }
      }
    } catch (_) {
      allEntries = [];
    }
  }

  function saveEntriesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allEntries));
    } catch (err) {
      console.warn('Erro ao salvar no localStorage:', err);
    }
    updateCounters();
  }

  function updateCounters() {
    downloadCountBadge.textContent = String(allEntries.length);
    const discarded = Math.max(0, allEntries.length - MAX_VISIBLE_RANKING);
    if (shatteredCountText) {
      shatteredCountText.textContent =
        discarded === 1
          ? '1 voz descartada no chão'
          : `${discarded} vozes descartadas no chão`;
    }
  }

  // --------------------------------------------------------------------------
  // 2. Busca no YouTube & Dropdown Corrigido + Limpeza Garantida do Form
  // --------------------------------------------------------------------------

  function extractYouTubeId(input) {
    const regex =
      /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
    const match = input.match(regex);
    return match ? match[1] : null;
  }

  function parseYtInitialDataFromHtml(html) {
    const match =
      html.match(/var ytInitialData = (\{.*?\});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*(\{.*?\});<\/script>/s);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];

    const videos = [];
    for (const sec of sections) {
      const items = sec?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.videoRenderer) {
          const v = item.videoRenderer;
          const videoId = v.videoId;
          const title =
            v.title?.runs?.map((r) => r.text).join('') ||
            v.title?.simpleText ||
            'Sem título';
          const channel =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            v.shortBylineText?.runs?.[0]?.text ||
            '';
          const duration = v.lengthText?.simpleText || '';
          const thumbnail =
            v.thumbnail?.thumbnails?.[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          if (videoId) {
            videos.push({ videoId, title, channel, duration, thumbnail });
          }
        }
        if (videos.length >= 6) break;
      }
      if (videos.length >= 6) break;
    }
    return videos;
  }

  async function searchYouTube(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const directVideoId = extractYouTubeId(trimmed);
    if (directVideoId) {
      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(
            `https://www.youtube.com/watch?v=${directVideoId}`
          )}&format=json`
        );
        if (oembedRes.ok) {
          const meta = await oembedRes.json();
          return [
            {
              videoId: directVideoId,
              title: meta.title || 'Vídeo do YouTube',
              channel: meta.author_name || 'YouTube',
              duration: '',
              thumbnail:
                meta.thumbnail_url || `https://i.ytimg.com/vi/${directVideoId}/hqdefault.jpg`,
            },
          ];
        }
      } catch (_) {}
      return [
        {
          videoId: directVideoId,
          title: `YouTube (${directVideoId})`,
          channel: '',
          duration: '',
          thumbnail: `https://i.ytimg.com/vi/${directVideoId}/hqdefault.jpg`,
        },
      ];
    }

    const apiCandidates = [
      `/api/youtube-search/?q=${encodeURIComponent(trimmed)}`,
      `/api/youtube-search?q=${encodeURIComponent(trimmed)}`,
    ];

    for (const endpoint of apiCandidates) {
      try {
        const res = await fetch(endpoint);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results) && data.results.length > 0) {
            return data.results;
          }
        }
      } catch (_) {}
    }

    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      trimmed
    )}&hl=pt-BR`;

    for (const proxyEndpoint of ['/api/fetch-html/', 'https://www.afonso.io/api/fetch-html/']) {
      try {
        const res = await fetch(proxyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url1: ytSearchUrl, url2: ytSearchUrl }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.html1) {
            const parsed = parseYtInitialDataFromHtml(data.html1);
            if (parsed.length > 0) return parsed;
          }
        }
      } catch (_) {}
    }

    // Fallback via Piped API pública caso local/serverless não esteja disponível
    const pipedEndpoints = [
      `https://api.piped.private.coffee/search?q=${encodeURIComponent(trimmed)}&filter=music_songs`,
      `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(trimmed)}&filter=music_songs`,
    ];
    for (const pipedUrl of pipedEndpoints) {
      try {
        const res = await fetch(pipedUrl);
        if (res.ok) {
          const data = await res.json();
          const items = (data.items || [])
            .filter((it) => it.url && it.url.includes('v='))
            .slice(0, 6)
            .map((it) => {
              const idMatch = it.url.match(/v=([^&]+)/);
              const videoId = idMatch ? idMatch[1] : '';
              const mins = it.duration ? Math.floor(it.duration / 60) : 0;
              const secs = it.duration ? String(it.duration % 60).padStart(2, '0') : '';
              return {
                videoId,
                title: it.title || 'Sem título',
                channel: it.uploaderName || '',
                duration: it.duration > 0 ? `${mins}:${secs}` : '',
                thumbnail: it.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              };
            })
            .filter((v) => v.videoId);
          if (items.length > 0) return items;
        }
      } catch (_) {}
    }

    return [];
  }

  function renderDropdownResults(results, isLoading = false, query = '') {
    searchResultsDropdown.innerHTML = '';
    activeDropdownIndex = -1;

    if (isLoading) {
      searchResultsDropdown.hidden = false;
      songSearchInput.setAttribute('aria-expanded', 'true');
      const li = document.createElement('li');
      li.className = 'dropdown-empty';
      li.textContent = 'Buscando no catálogo...';
      searchResultsDropdown.appendChild(li);
      return;
    }

    if (!results || results.length === 0) {
      if (!query) {
        closeDropdown();
        return;
      }
      searchResultsDropdown.hidden = false;
      songSearchInput.setAttribute('aria-expanded', 'true');
      const li = document.createElement('li');
      li.className = 'dropdown-empty';
      li.textContent = 'Nenhum disco encontrado. Tente outro termo ou cole o link.';
      searchResultsDropdown.appendChild(li);
      return;
    }

    results.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'search-dropdown-item';
      li.setAttribute('role', 'option');
      li.dataset.index = String(index);

      const thumb = document.createElement('img');
      thumb.className = 'dropdown-thumb';
      thumb.src = item.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'dropdown-meta';

      const title = document.createElement('span');
      title.className = 'dropdown-title';
      title.textContent = item.title;

      const sub = document.createElement('span');
      sub.className = 'dropdown-sub';
      sub.textContent = [item.channel, item.duration].filter(Boolean).join(' · ');

      meta.appendChild(title);
      meta.appendChild(sub);
      li.appendChild(thumb);
      li.appendChild(meta);

      // Usa mousedown para selecionar antes de qualquer blur do input
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSong(item);
      });

      searchResultsDropdown.appendChild(li);
    });

    searchResultsDropdown.hidden = false;
    songSearchInput.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    searchResultsDropdown.hidden = true;
    songSearchInput.setAttribute('aria-expanded', 'false');
    activeDropdownIndex = -1;
  }

  function selectSong(song) {
    selectedSong = {
      videoId: song.videoId,
      title: song.title,
      channel: song.channel || 'YouTube',
      duration: song.duration || '',
      thumbnail: song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${song.videoId}`,
    };

    selectedSongTitle.textContent = [selectedSong.title, selectedSong.channel]
      .filter(Boolean)
      .join(' — ');
    selectedSongCard.hidden = false;
    searchCombobox.hidden = true;
    closeDropdown();
    hideError();
  }

  function clearSelectedSong() {
    selectedSong = null;
    latestSearchToken += 1;
    clearTimeout(searchDebounceTimer);
    selectedSongTitle.textContent = '';
    selectedSongCard.hidden = true;
    searchCombobox.hidden = false;
    songSearchInput.value = '';
    searchResults = [];
    searchResultsDropdown.innerHTML = '';
    searchSpinner.hidden = true;
    closeDropdown();
  }

  function resetFormForNextPerson() {
    form.reset();
    clearSelectedSong();
    participantNameInput.value = '';
    songMeaningInput.value = '';
    hideError();
  }

  clearSongBtn.addEventListener('click', () => {
    clearSelectedSong();
    songSearchInput.focus();
  });

  songSearchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    clearTimeout(searchDebounceTimer);
    const currentToken = ++latestSearchToken;

    if (q.trim().length < 2) {
      searchSpinner.hidden = true;
      closeDropdown();
      return;
    }

    searchSpinner.hidden = false;
    renderDropdownResults([], true, q);

    searchDebounceTimer = setTimeout(async () => {
      const results = await searchYouTube(q);
      if (currentToken !== latestSearchToken || selectedSong !== null) {
        return;
      }
      searchResults = results;
      searchSpinner.hidden = true;
      renderDropdownResults(results, false, q.trim());
    }, 320);
  });

  songSearchInput.addEventListener('keydown', (e) => {
    if (searchResultsDropdown.hidden || searchResults.length === 0) return;
    const items = searchResultsDropdown.querySelectorAll('.search-dropdown-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex + 1) % items.length;
      updateActiveDropdownItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex - 1 + items.length) % items.length;
      updateActiveDropdownItem(items);
    } else if (e.key === 'Enter' && activeDropdownIndex >= 0) {
      e.preventDefault();
      selectSong(searchResults[activeDropdownIndex]);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  function updateActiveDropdownItem(items) {
    items.forEach((el, idx) => {
      el.classList.toggle('is-active', idx === activeDropdownIndex);
      if (idx === activeDropdownIndex) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!searchCombobox.contains(e.target)) {
      closeDropdown();
    }
  });

  // --------------------------------------------------------------------------
  // 3. Motor de Áudio da Jukebox (Oculto, Em Looping) + Mecânica do Vinil
  // --------------------------------------------------------------------------

  function setMechanicsPlaying(isPlaying, songObj) {
    if (songObj) {
      nowPlayingTitle.textContent = songObj.title;
      if (songObj.thumbnail) {
        vinylLabel.style.backgroundImage = `url("${songObj.thumbnail}")`;
      }
    }

    if (isPlaying) {
      vinyl.classList.add('is-spinning');
      tonearm.classList.add('is-active');
      playPauseBtn.classList.add('is-playing');
      vfd.classList.add('is-active');
    } else {
      vinyl.classList.remove('is-spinning');
      playPauseBtn.classList.remove('is-playing');
      vfd.classList.remove('is-active');
    }
  }

  function loadAndLoopAudio(videoId) {
    if (!videoId) return;
    if (currentViewMode === 'controller') return;
    currentPlayingVideoId = videoId;

    const latest = allEntries[allEntries.length - 1];
    if (latest && latest.song) {
      setMechanicsPlaying(true, latest.song);
    }

    if (!ytApiReady || typeof YT === 'undefined' || !YT.Player) {
      return;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      ytPlayer.loadVideoById({ videoId, startSeconds: 0 });
      ytPlayer.playVideo();
      return;
    }

    ytPlayer = new YT.Player('ytPlayerContainer', {
      width: '1',
      height: '1',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        loop: 1,
        playlist: videoId,
        playsinline: 1,
      },
      events: {
        onReady: (event) => {
          event.target.unMute();
          event.target.setVolume(100);
          event.target.playVideo();
          setMechanicsPlaying(true, allEntries[allEntries.length - 1]?.song);
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.ENDED) {
            event.target.seekTo(0);
            event.target.playVideo();
          } else if (event.data === YT.PlayerState.PLAYING) {
            setMechanicsPlaying(true);
          } else if (event.data === YT.PlayerState.PAUSED) {
            setMechanicsPlaying(false);
          }
        },
      },
    });
  }

  playPauseBtn.addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  });

  // --------------------------------------------------------------------------
  // 4. Física 2D: Queda Dramática, Quebra em Estilhaços & Acúmulo no Fundo
  // --------------------------------------------------------------------------

  const MAX_PILE_SHARDS = 240;
  let physicsDpr = 1;
  let fallingCards = [];
  let shards = [];
  let impactParticles = [];
  let impactFlashes = [];
  let physicsRafId = null;
  let lastPhysicsTime = 0;

  function resizePhysicsCanvas() {
    physicsDpr = Math.min(window.devicePixelRatio || 1, 2);
    physicsCanvas.width = window.innerWidth * physicsDpr;
    physicsCanvas.height = window.innerHeight * physicsDpr;
    pCtx.setTransform(physicsDpr, 0, 0, physicsDpr, 0, 0);

    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (!s.settled) continue;
      s.x = Math.max(40, Math.min(window.innerWidth - 40, s.x));
      s.y = Math.max(window.innerHeight - 34, Math.min(window.innerHeight - 10, s.y));
    }

    renderPhysicsOnce();
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  function renderCardTexture(entryData, width, height) {
    const w = Math.max(220, Math.round(width));
    const h = Math.max(64, Math.round(height));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');

    // Fundo de papel envelhecido com leve tom avermelhado da condenação
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#f9ebcf');
    bgGrad.addColorStop(0.55, '#ead1a3');
    bgGrad.addColorStop(1, '#d3b27e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#7a4f25';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Selo A3 lateral
    ctx.fillStyle = '#8b1414';
    ctx.fillRect(10, 10, 32, h - 20);
    ctx.fillStyle = '#fff5d6';
    ctx.font = '700 13px "Oswald", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A3', 26, h / 2);

    // Nome em destaque
    const textLeft = 52;
    const textMaxW = w - textLeft - 14;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#140c05';
    ctx.font = '700 16px "Oswald", sans-serif';
    ctx.fillText((entryData.name || '').toUpperCase(), textLeft, 10, textMaxW);

    // Texto completo (múltiplas linhas)
    ctx.fillStyle = '#4e3927';
    ctx.font = '12px "Special Elite", monospace';
    const lines = wrapCanvasText(ctx, `“${entryData.meaning || ''}”`, textMaxW);
    lines.forEach((line, idx) => {
      const yPos = 31 + idx * 15;
      if (yPos < h - 12) {
        ctx.fillText(line, textLeft, yPos, textMaxW);
      }
    });

    // Linhas de fratura escuras na textura antes de quebrar
    ctx.strokeStyle = 'rgba(40, 8, 8, 0.55)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(w * 0.34, 0);
    ctx.lineTo(w * 0.38, h * 0.52);
    ctx.lineTo(w * 0.31, h);
    ctx.moveTo(w * 0.68, 0);
    ctx.lineTo(w * 0.64, h * 0.45);
    ctx.lineTo(w * 0.72, h);
    ctx.moveTo(0, h * 0.48);
    ctx.lineTo(w, h * 0.54);
    ctx.stroke();

    return off;
  }

  function getFloorSurfaceAt(xPos) {
    const baseFloor = window.innerHeight - 6;
    let overlapCount = 0;

    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (!s.settled) continue;
      if (Math.abs(s.x - xPos) < s.w * 0.65) {
        overlapCount += 1;
      }
    }

    const pileTop = baseFloor - overlapCount * 1.8;
    const maxFloorCeiling = window.innerHeight - 36;
    return Math.max(maxFloorCeiling, pileTop);
  }

  function shatterCardAtImpact(card) {
    // Tremor da jukebox no impacto
    jukebox.classList.remove('is-shaking');
    void jukebox.offsetWidth;
    jukebox.classList.add('is-shaking');

    // Flash de impacto
    impactFlashes.push({
      x: card.x,
      y: card.y,
      radius: 14,
      maxRadius: Math.max(120, card.w * 0.45),
      alpha: 0.85,
    });

    // Explosão de fagulhas e poeira no ponto de quebra
    for (let i = 0; i < 36; i++) {
      const angle = -Math.PI * Math.random();
      const speed = 110 + Math.random() * 340;
      impactParticles.push({
        x: card.x + (Math.random() - 0.5) * card.w * 0.6,
        y: card.y,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 90,
        vy: Math.sin(angle) * speed - 60,
        size: 1.8 + Math.random() * 3.2,
        color: i % 3 === 0 ? '255, 174, 52' : i % 3 === 1 ? '230, 57, 70' : '243, 223, 186',
        alpha: 0.95,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.45,
      });
    }

    // Divide a textura real do card em 6 estilhaços poligonais (3 colunas x 2 linhas com cortes irregulares)
    const cols = 3;
    const rows = 2;
    const cw = card.w;
    const ch = card.h;
    const cellW = cw / cols;
    const cellH = ch / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const localX0 = -cw / 2 + c * cellW;
        const localY0 = -ch / 2 + r * cellH;
        const shardW = cellW;
        const shardH = cellH;
        const centerX = localX0 + shardW / 2;
        const centerY = localY0 + shardH / 2;

        // Polígono irregular relativo ao centro do estilhaço
        const jitter = () => (Math.random() - 0.5) * 10;
        const poly = [
          { x: -shardW / 2 + jitter(), y: -shardH / 2 + jitter() },
          { x: shardW / 2 + jitter(), y: -shardH / 2 + jitter() },
          { x: shardW / 2 + jitter(), y: shardH / 2 + jitter() },
          { x: -shardW / 2 + jitter(), y: shardH / 2 + jitter() },
        ];

        const spreadFactor = (c - 1) * 280 + (Math.random() - 0.5) * 240;
        shards.push({
          texture: card.texture,
          srcX: c * (card.texture.width / cols),
          srcY: r * (card.texture.height / rows),
          srcW: card.texture.width / cols,
          srcH: card.texture.height / rows,
          w: shardW,
          h: shardH,
          poly,
          x: card.x + centerX * Math.cos(card.angle) - centerY * Math.sin(card.angle),
          y: card.y + centerX * Math.sin(card.angle) + centerY * Math.cos(card.angle) - 6,
          vx: card.vx * 0.4 + spreadFactor,
          vy: -(160 + Math.random() * 260 + (1 - r) * 90),
          angle: card.angle + (Math.random() - 0.5) * 0.3,
          omega: (Math.random() - 0.5) * 12,
          restitution: 0.28 + Math.random() * 0.18,
          friction: 0.78,
          settled: false,
          bounces: 0,
        });
      }
    }

    if (shards.length > MAX_PILE_SHARDS) {
      shards = shards.slice(shards.length - MAX_PILE_SHARDS);
    }
  }

  function spawnPreSettledShards(entryData, indexInPile) {
    const tex = renderCardTexture(entryData, 420, 74);
    const cols = 3;
    const rows = 2;
    const shardW = 420 / cols;
    const shardH = 74 / rows;
    const usableWidth = Math.max(200, window.innerWidth - 120);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Distribui horizontalmente por toda a largura do chão da tela
        const seedSlot = ((indexInPile * 6 + r * 3 + c) * 0.61803398875) % 1;
        const x = 60 + seedSlot * usableWidth + (Math.random() - 0.5) * 32;
        const clampedX = Math.max(60, Math.min(window.innerWidth - 60, x));
        const floorY = getFloorSurfaceAt(clampedX);
        const jitter = () => (Math.random() - 0.5) * 8;
        shards.push({
          texture: tex,
          srcX: c * (tex.width / cols),
          srcY: r * (tex.height / rows),
          srcW: tex.width / cols,
          srcH: tex.height / rows,
          w: shardW,
          h: shardH,
          poly: [
            { x: -shardW / 2 + jitter(), y: -shardH / 2 + jitter() },
            { x: shardW / 2 + jitter(), y: -shardH / 2 + jitter() },
            { x: shardW / 2 + jitter(), y: shardH / 2 + jitter() },
            { x: -shardW / 2 + jitter(), y: shardH / 2 + jitter() },
          ],
          x: clampedX,
          y: Math.max(window.innerHeight - 32, Math.min(window.innerHeight - 10, floorY - shardH * 0.22)),
          vx: 0,
          vy: 0,
          angle: (Math.random() - 0.5) * 0.44,
          omega: 0,
          restitution: 0.3,
          friction: 0.78,
          settled: true,
          bounces: 4,
        });
      }
    }

    if (shards.length > MAX_PILE_SHARDS) {
      shards = shards.slice(shards.length - MAX_PILE_SHARDS);
    }
  }

  function renderPhysicsOnce() {
    pCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 1. Estilhaços acumulados / quicando
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      pCtx.save();
      pCtx.translate(s.x, s.y);
      pCtx.rotate(s.angle);

      pCtx.beginPath();
      pCtx.moveTo(s.poly[0].x, s.poly[0].y);
      for (let k = 1; k < s.poly.length; k++) {
        pCtx.lineTo(s.poly[k].x, s.poly[k].y);
      }
      pCtx.closePath();

      pCtx.save();
      pCtx.clip();
      pCtx.globalAlpha = s.settled ? 0.88 : 1;
      pCtx.drawImage(
        s.texture,
        s.srcX,
        s.srcY,
        s.srcW,
        s.srcH,
        -s.w / 2,
        -s.h / 2,
        s.w,
        s.h
      );
      pCtx.restore();

      // Borda da fratura visível
      pCtx.strokeStyle = 'rgba(25, 10, 6, 0.75)';
      pCtx.lineWidth = 1.2;
      pCtx.stroke();
      pCtx.restore();
    }

    // 2. Cards inteiros em queda livre
    for (let i = 0; i < fallingCards.length; i++) {
      const card = fallingCards[i];
      pCtx.save();
      pCtx.translate(card.x, card.y);
      pCtx.rotate(card.angle);
      pCtx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      pCtx.shadowBlur = 14;
      pCtx.drawImage(card.texture, -card.w / 2, -card.h / 2, card.w, card.h);
      pCtx.restore();
    }

    // 3. Flashes de impacto
    for (let i = 0; i < impactFlashes.length; i++) {
      const fl = impactFlashes[i];
      const grad = pCtx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, fl.radius);
      grad.addColorStop(0, `rgba(255, 220, 140, ${fl.alpha})`);
      grad.addColorStop(0.45, `rgba(230, 57, 70, ${fl.alpha * 0.55})`);
      grad.addColorStop(1, 'rgba(230, 57, 70, 0)');
      pCtx.fillStyle = grad;
      pCtx.beginPath();
      pCtx.arc(fl.x, fl.y, fl.radius, 0, Math.PI * 2);
      pCtx.fill();
    }

    // 4. Fagulhas e poeira do impacto
    for (let i = 0; i < impactParticles.length; i++) {
      const pt = impactParticles[i];
      const lifeRatio = pt.life / pt.maxLife;
      const alpha = Math.max(0, pt.alpha * (1 - lifeRatio));
      pCtx.fillStyle = `rgba(${pt.color}, ${alpha.toFixed(3)})`;
      pCtx.fillRect(pt.x, pt.y, pt.size, pt.size);
    }
  }

  function stepPhysics(now) {
    if (!lastPhysicsTime) lastPhysicsTime = now;
    const dt = Math.min(0.032, (now - lastPhysicsTime) / 1000);
    lastPhysicsTime = now;

    const gravity = 1850;
    let hasMotion = false;

    // Atualiza cards caindo
    for (let i = fallingCards.length - 1; i >= 0; i--) {
      const card = fallingCards[i];
      hasMotion = true;
      card.vy += gravity * dt;
      card.x += card.vx * dt;
      card.y += card.vy * dt;
      card.angle += card.omega * dt;

      const impactY = getFloorSurfaceAt(card.x);
      if (card.y + card.h * 0.42 >= impactY) {
        card.y = impactY - card.h * 0.35;
        fallingCards.splice(i, 1);
        shatterCardAtImpact(card);
      }
    }

    // Atualiza estilhaços com gravidade, quique e atrito até assentar no fundo
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (s.settled) continue;
      hasMotion = true;

      s.vy += gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.omega * dt;

      // Colisão lateral nas bordas da tela
      const margin = s.w * 0.35;
      if (s.x < margin) {
        s.x = margin;
        s.vx = Math.abs(s.vx) * 0.6;
      } else if (s.x > window.innerWidth - margin) {
        s.x = window.innerWidth - margin;
        s.vx = -Math.abs(s.vx) * 0.6;
      }

      // Colisão com o fundo ou pilha já assentada
      const surfaceY = getFloorSurfaceAt(s.x);
      const halfThick = s.h * 0.24;
      if (s.y + halfThick >= surfaceY) {
        s.y = Math.max(window.innerHeight - 34, surfaceY - halfThick);
        s.bounces += 1;

        if (Math.abs(s.vy) < 95 || s.bounces >= 4) {
          s.vy = 0;
          s.vx = 0;
          s.omega = 0;
          // Assenta quase horizontalmente no chão da página
          s.angle = Math.max(-0.22, Math.min(0.22, Math.sin(s.angle) * 0.25));
          s.settled = true;
        } else {
          s.vy = -s.vy * s.restitution;
          s.vx *= s.friction;
          s.omega *= 0.65;
        }
      }
    }

    // Atualiza flashes
    for (let i = impactFlashes.length - 1; i >= 0; i--) {
      const fl = impactFlashes[i];
      hasMotion = true;
      fl.radius += (fl.maxRadius - fl.radius) * 0.22;
      fl.alpha -= dt * 2.8;
      if (fl.alpha <= 0) impactFlashes.splice(i, 1);
    }

    // Atualiza partículas
    for (let i = impactParticles.length - 1; i >= 0; i--) {
      const pt = impactParticles[i];
      hasMotion = true;
      pt.life += dt;
      pt.vy += 880 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life >= pt.maxLife) impactParticles.splice(i, 1);
    }

    renderPhysicsOnce();

    if (hasMotion) {
      physicsRafId = requestAnimationFrame(stepPhysics);
    } else {
      physicsRafId = null;
      lastPhysicsTime = 0;
    }
  }

  function ensurePhysicsRunning() {
    if (!physicsRafId) {
      lastPhysicsTime = performance.now();
      physicsRafId = requestAnimationFrame(stepPhysics);
    }
  }

  function triggerDramaticFallAndShatter(itemEl, entryData) {
    if (itemEl.classList.contains('is-condemned')) return;
    itemEl.classList.add('is-condemned');

    // Ato 1: Tremor mecânico da Jukebox + Trincas no card condenado (~420ms)
    jukebox.classList.remove('is-shaking');
    void jukebox.offsetWidth;
    jukebox.classList.add('is-shaking');

    setTimeout(() => {
      const rect = itemEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        itemEl.remove();
        fitStageToViewport();
        return;
      }

      const cardTexture = renderCardTexture(entryData, rect.width, rect.height);

      // Ato 2: Desprende do painel e inicia queda livre no canvas
      itemEl.remove();
      fitStageToViewport();

      fallingCards.push({
        texture: cardTexture,
        w: rect.width,
        h: rect.height,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        vx: (Math.random() - 0.5) * 90,
        vy: -85,
        angle: (Math.random() - 0.5) * 0.08,
        omega: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.4),
      });

      ensurePhysicsRunning();
    }, 420);
  }

  // --------------------------------------------------------------------------
  // 5. Renderização das Tiras de Título (Texto 100% Inteiro)
  // --------------------------------------------------------------------------

  function createRankingItemElement(entry, rankPosition, isNewTop = false) {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    if (isNewTop) {
      li.classList.add('entering-stage');
    }
    li.dataset.entryId = entry.id;
    li.dataset.rank = String(rankPosition);

    const codeEl = document.createElement('div');
    codeEl.className = 'strip-code';
    codeEl.textContent = `A${rankPosition}`;

    const mainEl = document.createElement('div');
    mainEl.className = 'strip-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'ranking-name';
    nameEl.textContent = entry.name;

    const meaningEl = document.createElement('p');
    meaningEl.className = 'ranking-meaning';
    meaningEl.textContent = `“${entry.meaning}”`;

    mainEl.appendChild(nameEl);
    mainEl.appendChild(meaningEl);

    const rightEl = document.createElement('div');
    rightEl.className = 'strip-right';

    const eqEl = document.createElement('span');
    eqEl.className = 'strip-eq';
    eqEl.setAttribute('aria-hidden', 'true');
    eqEl.innerHTML = '<i></i><i></i><i></i>';

    const songEl = document.createElement('span');
    songEl.className = 'ranking-song';
    songEl.textContent = entry.song.title;

    rightEl.appendChild(eqEl);
    rightEl.appendChild(songEl);

    li.appendChild(codeEl);
    li.appendChild(mainEl);
    li.appendChild(rightEl);

    li._entryData = entry;
    return li;
  }

  function renderInitialState() {
    rankingList.innerHTML = '';
    shards = [];
    if (allEntries.length === 0) {
      updateCounters();
      resizePhysicsCanvas();
      fitStageToViewport();
      return;
    }

    const visibleEntries = allEntries.slice(-MAX_VISIBLE_RANKING).reverse();
    visibleEntries.forEach((entry, idx) => {
      rankingList.appendChild(createRankingItemElement(entry, idx + 1, false));
    });

    // Reconstrói no fundo os cacos acumulados de entradas já descartadas
    resizePhysicsCanvas();
    if (allEntries.length > MAX_VISIBLE_RANKING) {
      const discardedEntries = allEntries.slice(0, allEntries.length - MAX_VISIBLE_RANKING);
      discardedEntries.forEach((entry, i) => {
        spawnPreSettledShards(entry, i);
      });
      renderPhysicsOnce();
    }

    const latest = visibleEntries[0];
    if (latest) {
      setMechanicsPlaying(true, latest.song);
      if (currentPlayingVideoId !== latest.song.videoId) {
        loadAndLoopAudio(latest.song.videoId);
      }
    }

    updateCounters();
    fitStageToViewport();
  }

  function addNewEntryToStage(newEntry) {
    loadAndLoopAudio(newEntry.song.videoId);

    const newTopEl = createRankingItemElement(newEntry, 1, true);
    rankingList.prepend(newTopEl);

    const activeItems = Array.from(rankingList.querySelectorAll('.ranking-item:not(.is-condemned)'));
    activeItems.forEach((itemEl, index) => {
      const newRank = index + 1;
      const codeEl = itemEl.querySelector('.strip-code');
      if (codeEl && newRank <= MAX_VISIBLE_RANKING) {
        codeEl.textContent = `A${newRank}`;
      }

      if (newRank <= MAX_VISIBLE_RANKING) {
        itemEl.dataset.rank = String(newRank);
      } else {
        const entryData = itemEl._entryData || {
          name: itemEl.querySelector('.ranking-name')?.textContent || '',
          meaning: (itemEl.querySelector('.ranking-meaning')?.textContent || '').replace(/[“”]/g, ''),
          song: { title: itemEl.querySelector('.ranking-song')?.textContent || '' },
        };
        triggerDramaticFallAndShatter(itemEl, entryData);
      }
    });

    fitStageToViewport();
  }

  // --------------------------------------------------------------------------
  // 6. Fluxo de Submissão com Popup de Confirmação ("Tem certeza da sua atitude?")
  // --------------------------------------------------------------------------

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function hideError() {
    formError.textContent = '';
    formError.hidden = true;
  }

  function openConfirmModal(submission) {
    pendingSubmission = submission;

    if (allEntries.length >= MAX_VISIBLE_RANKING) {
      const oldestVisible = allEntries[allEntries.length - MAX_VISIBLE_RANKING];
      confirmModalSub.textContent =
        `Sua música assumirá o palco em looping, empurrando e quebrando a memória de “${oldestVisible.name}” (A3) no chão.`;
    } else {
      confirmModalSub.textContent =
        'Sua música assumirá o palco principal (A1) e tocará em looping contínuo.';
    }

    confirmModal.hidden = false;
    confirmYesBtn.focus();
  }

  function closeConfirmModal() {
    confirmModal.hidden = true;
    pendingSubmission = null;
  }

  function commitSubmission(submission) {
    const newEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      order: allEntries.length + 1,
      name: submission.name,
      meaning: submission.meaning,
      song: { ...submission.song },
      createdAt: new Date().toISOString(),
    };

    allEntries.push(newEntry);
    saveEntriesToStorage();

    if (currentViewMode === 'controller' && syncChannel) {
      syncChannel.postMessage({
        type: 'NEW_ENTRY',
        entry: newEntry,
        allEntries,
      });
    } else {
      addNewEntryToStage(newEntry);
    }

    resetFormForNextPerson();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();

    if (!selectedSong) {
      showError('Escolha uma música.');
      songSearchInput.focus();
      return;
    }

    const name = participantNameInput.value.trim();
    if (!name) {
      showError('Informe seu nome.');
      participantNameInput.focus();
      return;
    }

    const meaning = songMeaningInput.value.trim();
    if (!meaning) {
      showError('Responda o que essa música significa.');
      songMeaningInput.focus();
      return;
    }

    openConfirmModal({
      name,
      meaning,
      song: { ...selectedSong },
    });
  });

  confirmYesBtn.addEventListener('click', () => {
    const toCommit = pendingSubmission;
    closeConfirmModal();
    if (toCommit) {
      commitSubmission(toCommit);
    }
  });

  confirmNoBtn.addEventListener('click', () => {
    closeConfirmModal();
  });

  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
      closeConfirmModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !confirmModal.hidden) {
      closeConfirmModal();
    }
  });

  // --------------------------------------------------------------------------
  // 7. Exportação do JSON Completo & Inicialização Limpa
  // --------------------------------------------------------------------------

  downloadJsonBtn.addEventListener('click', () => {
    const payload = {
      epigrafe: 'Enquanto uns são aplaudidos no palco, outros são abafados pela platéia.',
      exportadoEm: new Date().toISOString(),
      totalEntradas: allEntries.length,
      entradas: allEntries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oficinaII-entradas.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  window.addEventListener('pageshow', () => {
    resetFormForNextPerson();
  });

  // --------------------------------------------------------------------------
  // 8. Modo HDMI / Segunda Tela (BroadcastChannel + Heartbeat Automático)
  // --------------------------------------------------------------------------

  let tvWindowRef = null;
  let tvHeartbeatWatchdog = null;
  let tvHeartbeatInterval = null;

  function updateTvButtonLabel() {
    if (!tvModeLabel) return;
    if (currentViewMode === 'tv') {
      tvModeLabel.textContent = document.fullscreenElement ? 'sair da tela cheia' : 'tela cheia';
    } else if (currentViewMode === 'controller') {
      tvModeLabel.textContent = 'TV conectada (encerrar)';
    } else {
      tvModeLabel.textContent = 'projetar na TV';
    }
  }

  function setViewMode(mode) {
    const prevMode = currentViewMode;
    currentViewMode = mode;
    document.body.dataset.viewMode = mode;
    updateTvButtonLabel();

    if (mode === 'controller') {
      if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        ytPlayer.pauseVideo();
      }
    } else if (mode === 'unified' && prevMode === 'controller') {
      renderInitialState();
      if (allEntries.length > 0) {
        loadAndLoopAudio(allEntries[allEntries.length - 1].song.videoId);
      }
    } else if (mode === 'tv') {
      resizePhysicsCanvas();
    }

    requestAnimationFrame(fitStageToViewport);
  }

  function resetTvWatchdog() {
    clearTimeout(tvHeartbeatWatchdog);
    tvHeartbeatWatchdog = setTimeout(() => {
      tvWindowRef = null;
      if (currentViewMode === 'controller') {
        setViewMode('unified');
      }
    }, 3200);
  }

  if (syncChannel) {
    if (isTvWindow) {
      syncChannel.postMessage({ type: 'TV_READY' });
      tvHeartbeatInterval = setInterval(() => {
        syncChannel.postMessage({ type: 'TV_HEARTBEAT' });
      }, 1200);

      const notifyTvClosed = () => {
        clearInterval(tvHeartbeatInterval);
        syncChannel.postMessage({ type: 'TV_CLOSED' });
      };
      window.addEventListener('beforeunload', notifyTvClosed);
      window.addEventListener('pagehide', notifyTvClosed);

      syncChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'SYNC_STATE' && Array.isArray(msg.allEntries)) {
          const prevCount = allEntries.length;
          allEntries = msg.allEntries;
          saveEntriesToStorage();
          if (prevCount !== allEntries.length) {
            renderInitialState();
          }
        } else if (msg.type === 'NEW_ENTRY' && msg.entry) {
          allEntries = Array.isArray(msg.allEntries)
            ? msg.allEntries
            : [...allEntries, msg.entry];
          saveEntriesToStorage();
          addNewEntryToStage(msg.entry);
        } else if (msg.type === 'TOGGLE_PLAY') {
          if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
            if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
              ytPlayer.pauseVideo();
            } else {
              ytPlayer.playVideo();
            }
          }
        } else if (msg.type === 'CLOSE_TV_REQUEST') {
          clearInterval(tvHeartbeatInterval);
          window.close();
        }
      };
    } else {
      syncChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'TV_READY') {
          if (currentViewMode !== 'controller') {
            setViewMode('controller');
          }
          resetTvWatchdog();
          syncChannel.postMessage({ type: 'SYNC_STATE', allEntries });
        } else if (msg.type === 'TV_HEARTBEAT') {
          if (currentViewMode !== 'controller') {
            setViewMode('controller');
          }
          resetTvWatchdog();
        } else if (msg.type === 'TV_CLOSED') {
          clearTimeout(tvHeartbeatWatchdog);
          tvWindowRef = null;
          if (currentViewMode === 'controller') {
            setViewMode('unified');
          }
        }
      };
    }
  }

  if (tvModeBtn) {
    tvModeBtn.addEventListener('click', async () => {
      if (currentViewMode === 'tv') {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (_) {}
        if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
          ytPlayer.unMute();
          ytPlayer.playVideo();
        }
        return;
      }

      if (currentViewMode === 'controller') {
        if (syncChannel) {
          syncChannel.postMessage({ type: 'CLOSE_TV_REQUEST' });
        }
        try {
          if (tvWindowRef && !tvWindowRef.closed) {
            tvWindowRef.close();
          }
        } catch (_) {}
        clearTimeout(tvHeartbeatWatchdog);
        tvWindowRef = null;
        setViewMode('unified');
        return;
      }

      // Abre a janela dedicada da TV de forma síncrona para evitar bloqueio de popup
      const tvUrl = `${window.location.pathname}?mode=tv`;
      tvWindowRef = window.open(
        tvUrl,
        'OficinaII_TV',
        'width=1120,height=900,menubar=no,toolbar=no,location=no,status=no'
      );

      // Tenta posicionar automaticamente na segunda tela (HDMI) caso a API seja suportada
      if (tvWindowRef && 'getScreenDetails' in window) {
        try {
          const screenDetails = await window.getScreenDetails();
          const externalScreen = screenDetails.screens.find((s) => !s.isPrimary);
          if (externalScreen && tvWindowRef && !tvWindowRef.closed) {
            tvWindowRef.moveTo(externalScreen.availLeft, externalScreen.availTop);
            tvWindowRef.resizeTo(externalScreen.availWidth, externalScreen.availHeight);
          }
        } catch (_) {}
      }
    });
  }

  document.addEventListener('fullscreenchange', updateTvButtonLabel);

  onYtApiReadyCallback = () => {
    if (allEntries.length > 0 && currentViewMode !== 'controller') {
      loadAndLoopAudio(allEntries[allEntries.length - 1].song.videoId);
    }
  };

  resetFormForNextPerson();
  loadStoredEntries();
  setViewMode(isTvWindow ? 'tv' : 'unified');
  renderInitialState();
  if (ytApiReady) {
    onYtApiReadyCallback();
  }
});
