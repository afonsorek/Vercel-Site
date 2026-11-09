// ==========================================================================
// OFICINA II — Jukebox Diegética, Áudio em Looping & Efeito Thanos Snap
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
  const stage = document.getElementById('stage');
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

  // Elementos diegéticos da Jukebox
  const vinyl = document.getElementById('vinyl');
  const vinylLabel = document.getElementById('vinylLabel');
  const tonearm = document.getElementById('tonearm');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const vfd = document.querySelector('.vfd');
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');

  // --------------------------------------------------------------------------
  // 0. Escala Automática de Tela Única (Sem Scroll em Qualquer Resolução)
  // --------------------------------------------------------------------------

  function fitStageToViewport() {
    if (!stage) return;
    stage.style.transform = 'scale(1)';
    const naturalHeight = stage.offsetHeight + 16;
    const naturalWidth = stage.offsetWidth + 24;
    const scaleY = window.innerHeight / naturalHeight;
    const scaleX = window.innerWidth / naturalWidth;
    const scale = Math.min(1, scaleY, scaleX);
    stage.style.transform = `scale(${scale.toFixed(3)})`;
  }

  window.addEventListener('resize', fitStageToViewport);
  fitStageToViewport();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitStageToViewport);
  }

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
      li.textContent = 'Nenhum disco encontrado.';
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
  // 4. Efeito Thanos Snap (Desintegração da Tira em Poeira Dourada/Cinzas)
  // --------------------------------------------------------------------------

  function triggerThanosSnap(itemEl, entryData) {
    if (itemEl.classList.contains('snapping')) return;
    itemEl.classList.add('snapping');

    const rect = itemEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      itemEl.remove();
      return;
    }

    const padX = 90;
    const padTop = 75;
    const padBottom = 55;
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

    // Desenha a tira de papel + texto em um canvas offscreen para extrair partículas reais
    const offCanvas = document.createElement('canvas');
    offCanvas.width = Math.ceil(rect.width);
    offCanvas.height = Math.ceil(rect.height);
    const offCtx = offCanvas.getContext('2d');

    // Fundo de papel envelhecido da tira
    offCtx.fillStyle = '#e5cf9e';
    offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);

    // Etiqueta vermelha lateral
    offCtx.fillStyle = '#7d1414';
    offCtx.fillRect(6, 5, 28, offCanvas.height - 10);

    // Texto: Nome (em destaque) + Significado
    offCtx.textAlign = 'left';
    offCtx.textBaseline = 'middle';
    offCtx.font = '700 15px "Oswald", sans-serif';
    offCtx.fillStyle = '#1b1108';
    offCtx.fillText(entryData.name.toUpperCase(), 44, offCanvas.height * 0.35, offCanvas.width - 60);

    offCtx.font = '12px "Special Elite", monospace';
    offCtx.fillStyle = '#5c4632';
    offCtx.fillText(`“${entryData.meaning}”`, 44, offCanvas.height * 0.72, offCanvas.width - 60);

    const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height).data;
    const particles = [];

    // Amostra pixels da tira e do texto para formar uma nuvem densa e nítida
    for (let y = 0; y < offCanvas.height; y += 2) {
      for (let x = 0; x < offCanvas.width; x += 2) {
        if (Math.random() > 0.52) continue;
        const idx = (y * offCanvas.width + x) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        const normX = x / offCanvas.width;

        particles.push({
          x: padX + x,
          y: padTop + y,
          r,
          g,
          b,
          triggerAt: normX * 0.55 + (Math.random() - 0.5) * 0.12,
          vx: (Math.random() * 1.9 + 0.4) * (Math.random() < 0.85 ? 1 : -0.35),
          vy: -(Math.random() * 1.65 + 0.3),
          size: Math.random() * 2.1 + 0.8,
          alpha: 0.92,
          life: 0,
          maxLife: 0.45 + Math.random() * 0.45,
          seed: Math.random() * Math.PI * 2,
        });
      }
    }

    const duration = 1650;
    const startTime = performance.now();

    function animateFrame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Onda que corrói a tira da esquerda para a direita
      const wavePct = Math.min(125, (progress / 0.6) * 125);
      const maskGrad = `linear-gradient(104deg, transparent ${Math.max(
        0,
        wavePct - 16
      )}%, rgba(0,0,0,0.3) ${wavePct}%, black ${wavePct + 12}%)`;
      itemEl.style.webkitMaskImage = maskGrad;
      itemEl.style.maskImage = maskGrad;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (progress < p.triggerAt) continue;

        p.life += 0.016;
        const lifeRatio = p.life / p.maxLife;
        if (lifeRatio >= 1) continue;

        p.x += p.vx + Math.sin(p.life * 6 + p.seed) * 0.55;
        p.y += p.vy + Math.cos(p.life * 5 + p.seed) * 0.3;
        p.vx *= 1.01;
        p.vy *= 1.012;

        const currentAlpha = p.alpha * (1 - lifeRatio * lifeRatio);
        ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${currentAlpha.toFixed(3)})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }

      if (progress < 1) {
        requestAnimationFrame(animateFrame);
      } else {
        dustCanvas.remove();
        itemEl.remove();
      }
    }

    requestAnimationFrame(animateFrame);
  }

  // --------------------------------------------------------------------------
  // 5. Renderização das Tiras de Título (Acima da Caixa de Interação)
  // --------------------------------------------------------------------------

  function createRankingItemElement(entry, rankPosition, isNewTop = false) {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    if (isNewTop) {
      li.classList.add('entering-stage');
    }
    li.dataset.entryId = entry.id;
    li.dataset.rank = String(rankPosition);

    // Código de Jukebox (A1, A2, A3)
    const codeEl = document.createElement('div');
    codeEl.className = 'strip-code';
    codeEl.textContent = `A${rankPosition}`;

    // Centro: 1º Nome com maior destaque + 2º Significado
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

    // Direita: Indicador tocando (no #1) + Nome da música
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
    if (allEntries.length === 0) return;

    const visibleEntries = allEntries.slice(-MAX_VISIBLE_RANKING).reverse();
    visibleEntries.forEach((entry, idx) => {
      rankingList.appendChild(createRankingItemElement(entry, idx + 1, false));
    });

    const latest = visibleEntries[0];
    if (latest) {
      setMechanicsPlaying(true, latest.song);
      if (currentPlayingVideoId !== latest.song.videoId) {
        loadAndLoopAudio(latest.song.videoId);
      }
    }
  }

  function addNewEntryToStage(newEntry) {
    loadAndLoopAudio(newEntry.song.videoId);

    const newTopEl = createRankingItemElement(newEntry, 1, true);
    rankingList.prepend(newTopEl);

    const activeItems = Array.from(rankingList.querySelectorAll('.ranking-item:not(.snapping)'));
    activeItems.forEach((itemEl, index) => {
      const newRank = index + 1;
      const codeEl = itemEl.querySelector('.strip-code');
      if (codeEl && newRank <= MAX_VISIBLE_RANKING) {
        codeEl.textContent = `A${newRank}`;
      }

      if (newRank <= MAX_VISIBLE_RANKING) {
        itemEl.dataset.rank = String(newRank);
      } else {
        // Passou de 3 -> desintegra com efeito Thanos Snap!
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
      showError('Responda o que essa música significa.');
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
