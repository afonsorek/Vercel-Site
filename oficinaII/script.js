// ==========================================================================
// OFICINA II — Tela Única, Áudio em Looping e Desintegração (Thanos Snap)
// ==========================================================================

const STORAGE_KEY = 'oficinaII_entries_v1';
const MAX_VISIBLE_RANKING = 3;

let allEntries = [];
let selectedSong = null;
let searchResults = [];
let activeDropdownIndex = -1;
let searchDebounceTimer = null;

// YouTube Audio-Only Loop Engine
let ytPlayer = null;
let ytApiReady = false;
let currentPlayingVideoId = null;

window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (allEntries.length > 0) {
    const latest = allEntries[allEntries.length - 1];
    loadAndLoopAudio(latest.song.videoId);
  }
};

document.addEventListener('DOMContentLoaded', () => {
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

  // --------------------------------------------------------------------------
  // 1. Armazenamento & JSON Completo
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
    } catch (err) {
      allEntries = [];
    }
  }

  function saveEntriesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allEntries));
    } catch (err) {
      console.warn('Erro ao salvar no localStorage:', err);
    }
    downloadCountBadge.textContent = String(allEntries.length);
  }

  // --------------------------------------------------------------------------
  // 2. Busca no YouTube
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
      li.textContent = 'Buscando...';
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
      li.textContent = 'Nenhum resultado encontrado.';
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

      li.addEventListener('click', () => selectSong(item));
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
    selectedSongCard.hidden = true;
    searchCombobox.hidden = false;
    songSearchInput.value = '';
  }

  clearSongBtn.addEventListener('click', () => {
    clearSelectedSong();
    songSearchInput.focus();
  });

  songSearchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    clearTimeout(searchDebounceTimer);

    if (q.trim().length < 2) {
      searchSpinner.hidden = true;
      closeDropdown();
      return;
    }

    searchSpinner.hidden = false;
    renderDropdownResults([], true, q);

    searchDebounceTimer = setTimeout(async () => {
      const results = await searchYouTube(q);
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
  // 3. Áudio da Jukebox em Looping (Oculto, Sem Mostrar Vídeo)
  // --------------------------------------------------------------------------

  function loadAndLoopAudio(videoId) {
    if (!videoId) return;
    currentPlayingVideoId = videoId;

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
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.ENDED) {
            event.target.seekTo(0);
            event.target.playVideo();
          }
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // 4. Efeito Thanos Snap (Desintegração em Partículas de Poeira)
  // --------------------------------------------------------------------------

  function triggerThanosSnap(itemEl, entryData) {
    if (itemEl.classList.contains('snapping')) return;
    itemEl.classList.add('snapping');

    const rect = itemEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      itemEl.remove();
      return;
    }

    // Cria um canvas sobreposto com margem extra para as partículas voarem
    const padX = 120;
    const padTop = 90;
    const padBottom = 60;
    const canvasWidth = rect.width + padX * 2;
    const canvasHeight = rect.height + padTop + padBottom;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dustCanvas = document.createElement('canvas');
    dustCanvas.className = 'snap-dust-canvas';
    dustCanvas.style.left = `${rect.left - padX}px`;
    dustCanvas.style.top = `${rect.top - padTop}px`;
    dustCanvas.style.width = `${canvasWidth}px`;
    dustCanvas.style.height = `${canvasHeight}px`;
    dustCanvas.width = canvasWidth * dpr;
    dustCanvas.height = canvasHeight * dpr;
    document.body.appendChild(dustCanvas);

    const ctx = dustCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Renderiza o texto exato do item em um canvas offscreen para extrair os pixels reais
    const offCanvas = document.createElement('canvas');
    offCanvas.width = Math.ceil(rect.width);
    offCanvas.height = Math.ceil(rect.height);
    const offCtx = offCanvas.getContext('2d');

    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';

    // Linha 1: Significado
    offCtx.font = 'italic 300 15.5px "Newsreader", Georgia, serif';
    offCtx.fillStyle = 'rgba(242, 242, 242, 0.72)';
    const meaningText = `“${entryData.meaning}”`;
    offCtx.fillText(meaningText, rect.width / 2, rect.height * 0.36, rect.width - 16);

    // Linha 2: Nome e Música
    offCtx.font = '400 11.5px "Inter", sans-serif';
    offCtx.fillStyle = 'rgba(180, 180, 180, 0.65)';
    const metaText = `${entryData.name}  ·  ${entryData.song.title}`;
    offCtx.fillText(metaText, rect.width / 2, rect.height * 0.72, rect.width - 16);

    // Amostra os pixels visíveis do texto e gera partículas de poeira
    const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height).data;
    const particles = [];

    for (let y = 0; y < offCanvas.height; y += 1) {
      for (let x = 0; x < offCanvas.width; x += 1) {
        const idx = (y * offCanvas.width + x) * 4;
        const alpha = imgData[idx + 3];
        if (alpha > 25 && Math.random() < 0.68) {
          const normX = x / offCanvas.width;
          particles.push({
            x: padX + x,
            y: padTop + y,
            // A onda de desintegração varre da esquerda para a direita com leve ruído orgânico
            triggerAt: normX * 0.55 + (Math.random() - 0.5) * 0.12,
            vx: (Math.random() * 1.4 + 0.35) * (Math.random() < 0.8 ? 1 : -0.4),
            vy: -(Math.random() * 1.35 + 0.25),
            size: Math.random() * 1.6 + 0.7,
            alpha: (alpha / 255) * 0.9,
            life: 0,
            maxLife: 0.45 + Math.random() * 0.45,
            turbulenceSeed: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    // Também adiciona partículas extras de "cinza/poeira" ao longo da largura do item
    for (let i = 0; i < 240; i++) {
      const rx = Math.random() * offCanvas.width;
      const ry = Math.random() * (offCanvas.height * 0.7) + offCanvas.height * 0.15;
      particles.push({
        x: padX + rx,
        y: padTop + ry,
        triggerAt: (rx / offCanvas.width) * 0.55 + (Math.random() - 0.5) * 0.1,
        vx: Math.random() * 1.8 - 0.2,
        vy: -(Math.random() * 1.5 + 0.3),
        size: Math.random() * 1.9 + 0.6,
        alpha: Math.random() * 0.55 + 0.25,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.45,
        turbulenceSeed: Math.random() * Math.PI * 2,
      });
    }

    const duration = 1750; // ms
    const startTime = performance.now();

    function animateFrame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Máscara progressiva que "apaga" o elemento DOM da esquerda para a direita enquanto vira pó
      const wavePct = Math.min(120, (progress / 0.62) * 120);
      const maskGrad = `linear-gradient(102deg, transparent ${Math.max(
        0,
        wavePct - 18
      )}%, rgba(0,0,0,0.3) ${wavePct}%, black ${wavePct + 14}%)`;
      itemEl.style.webkitMaskImage = maskGrad;
      itemEl.style.maskImage = maskGrad;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (progress < p.triggerAt) continue;

        p.life += 0.016;
        const lifeRatio = p.life / p.maxLife;
        if (lifeRatio >= 1) continue;

        // Movimento orgânico de poeira ao vento (subindo e derivando)
        p.x += p.vx + Math.sin(p.life * 6 + p.turbulenceSeed) * 0.45;
        p.y += p.vy + Math.cos(p.life * 5 + p.turbulenceSeed) * 0.25;
        p.vx *= 1.008;
        p.vy *= 1.01;

        const currentAlpha = p.alpha * (1 - lifeRatio * lifeRatio);
        ctx.fillStyle = `rgba(242, 242, 242, ${currentAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (progress < 1) {
        requestAnimationFrame(animateFrame);
      } else {
        dustCanvas.remove();
        // Recolhe suavemente o espaço residual e remove do DOM
        itemEl.style.transition = 'max-height 260ms ease, padding 260ms ease, margin 260ms ease';
        itemEl.style.maxHeight = '0px';
        itemEl.style.paddingTop = '0px';
        itemEl.style.paddingBottom = '0px';
        itemEl.style.margin = '0px';
        itemEl.style.overflow = 'hidden';
        setTimeout(() => itemEl.remove(), 270);
      }
    }

    requestAnimationFrame(animateFrame);
  }

  // --------------------------------------------------------------------------
  // 5. Renderização do Ranking (Máximo 3 visíveis; a partir de 3 é apagado)
  // --------------------------------------------------------------------------

  function createRankingItemElement(entry, rankPosition, isNewTop = false) {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    if (isNewTop) {
      li.classList.add('entering-stage');
    }
    li.dataset.entryId = entry.id;
    li.dataset.rank = String(rankPosition);

    // Indicador minimalista de que o #1 atual está tocando + nome da música
    const playingBadge = document.createElement('div');
    playingBadge.className = 'now-playing-badge';
    playingBadge.innerHTML = `
      <span class="eq-bars" aria-hidden="true">
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
      </span>
    `;
    const badgeSongTitle = document.createElement('span');
    badgeSongTitle.className = 'ranking-song';
    badgeSongTitle.textContent = entry.song.title;
    playingBadge.appendChild(badgeSongTitle);

    const meaningEl = document.createElement('p');
    meaningEl.className = 'ranking-meaning';
    meaningEl.textContent = `“${entry.meaning}”`;

    const metaEl = document.createElement('div');
    metaEl.className = 'ranking-meta';

    const nameEl = document.createElement('span');
    nameEl.className = 'ranking-name';
    nameEl.textContent = entry.name;

    const sepEl = document.createElement('span');
    sepEl.className = 'ranking-sep-inline';
    sepEl.textContent = '·';

    const songEl = document.createElement('span');
    songEl.className = 'ranking-song ranking-song-inline';
    songEl.textContent = entry.song.title;

    metaEl.appendChild(nameEl);
    metaEl.appendChild(sepEl);
    metaEl.appendChild(songEl);

    li.appendChild(playingBadge);
    li.appendChild(meaningEl);
    li.appendChild(metaEl);

    // Guarda os dados no próprio elemento para o efeito Thanos Snap usar ao desintegrar
    li._entryData = entry;

    return li;
  }

  function renderInitialState() {
    rankingList.innerHTML = '';
    if (allEntries.length === 0) return;

    const visibleEntries = allEntries.slice(-MAX_VISIBLE_RANKING).reverse();
    visibleEntries.forEach((entry, idx) => {
      rankingList.appendChild(createRankingItemElement(entry, idx + 1, false));
    });

    const latest = visibleEntries[0];
    if (latest && currentPlayingVideoId !== latest.song.videoId) {
      loadAndLoopAudio(latest.song.videoId);
    }
  }

  function addNewEntryToStage(newEntry) {
    // Toca em looping a música da última pessoa a colocar
    loadAndLoopAudio(newEntry.song.videoId);

    // Insere no topo do ranking (#1)
    const newTopEl = createRankingItemElement(newEntry, 1, true);
    rankingList.prepend(newTopEl);

    // Atualiza posições e aplica o Thanos Snap em quem passar de 3
    const activeItems = Array.from(rankingList.querySelectorAll('.ranking-item:not(.snapping)'));
    activeItems.forEach((itemEl, index) => {
      const newRank = index + 1;
      if (newRank <= MAX_VISIBLE_RANKING) {
        itemEl.dataset.rank = String(newRank);
      } else {
        // Empurrado além da 3ª posição -> efeito Thanos Snap!
        const entryData = itemEl._entryData || {
          name: itemEl.querySelector('.ranking-name')?.textContent || '',
          meaning: (itemEl.querySelector('.ranking-meaning')?.textContent || '').replace(/[“”]/g, ''),
          song: { title: itemEl.querySelector('.ranking-song')?.textContent || '' },
        };
        triggerThanosSnap(itemEl, entryData);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 6. Envio do Formulário & Download do JSON
  // --------------------------------------------------------------------------

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  function hideError() {
    formError.textContent = '';
    formError.hidden = true;
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
      showError('Responda o que essa música significa para você.');
      songMeaningInput.focus();
      return;
    }

    const newEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      order: allEntries.length + 1,
      name,
      meaning,
      song: { ...selectedSong },
      createdAt: new Date().toISOString(),
    };

    allEntries.push(newEntry);
    saveEntriesToStorage();
    addNewEntryToStage(newEntry);

    clearSelectedSong();
    participantNameInput.value = '';
    songMeaningInput.value = '';
  });

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

  loadStoredEntries();
  downloadCountBadge.textContent = String(allEntries.length);
  renderInitialState();
});
