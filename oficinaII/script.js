// ==========================================================================
// OFICINA II — Plataforma de Cocriação Sonora, Jukebox em Looping & Ranking
// ==========================================================================

const STORAGE_KEY = 'oficinaII_entries_v1';
const MAX_VISIBLE_RANKING = 5;

// Estado Global
let allEntries = []; // Todas as entradas salvas (nunca apagadas no envio; exportáveis em JSON)
let selectedSong = null;
let searchResults = [];
let activeDropdownIndex = -1;
let searchDebounceTimer = null;

// YouTube IFrame Player
let ytPlayer = null;
let ytApiReady = false;
let currentPlayingVideoId = null;
let isPlayerPlaying = false;

// Callback global exigida pela YouTube IFrame API
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (allEntries.length > 0) {
    const latest = allEntries[allEntries.length - 1];
    loadAndLoopVideo(latest.song.videoId);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // Referências de DOM
  const form = document.getElementById('cocreationForm');
  const songSearchInput = document.getElementById('songSearchInput');
  const searchSpinner = document.getElementById('searchSpinner');
  const searchResultsDropdown = document.getElementById('searchResultsDropdown');
  const searchCombobox = document.getElementById('searchCombobox');

  const selectedSongCard = document.getElementById('selectedSongCard');
  const selectedSongThumb = document.getElementById('selectedSongThumb');
  const selectedSongTitle = document.getElementById('selectedSongTitle');
  const selectedSongChannel = document.getElementById('selectedSongChannel');
  const clearSongBtn = document.getElementById('clearSongBtn');

  const participantNameInput = document.getElementById('participantName');
  const songMeaningInput = document.getElementById('songMeaning');
  const formError = document.getElementById('formError');

  // Jukebox DOM
  const jukeboxEmpty = document.getElementById('jukeboxEmpty');
  const jukeboxActive = document.getElementById('jukeboxActive');
  const loopIndicator = document.getElementById('loopIndicator');
  const stageTimestamp = document.getElementById('stageTimestamp');
  const stageMeaning = document.getElementById('stageMeaning');
  const stageParticipantName = document.getElementById('stageParticipantName');
  const stageSongTitle = document.getElementById('stageSongTitle');
  const stageSongChannel = document.getElementById('stageSongChannel');
  const jukeboxPlayPauseBtn = document.getElementById('jukeboxPlayPauseBtn');
  const jukeboxPlayIcon = document.getElementById('jukeboxPlayIcon');
  const jukeboxPauseIcon = document.getElementById('jukeboxPauseIcon');
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  const ytPlayerWrapper = document.getElementById('ytPlayerWrapper');

  // Ranking DOM
  const rankingCounter = document.getElementById('rankingCounter');
  const rankingEmpty = document.getElementById('rankingEmpty');
  const rankingList = document.getElementById('rankingList');
  const muffledNotice = document.getElementById('muffledNotice');
  const muffledCountText = document.getElementById('muffledCountText');

  // Arquivo JSON DOM
  const totalSavedCount = document.getElementById('totalSavedCount');
  const downloadCountBadge = document.getElementById('downloadCountBadge');
  const viewJsonBtn = document.getElementById('viewJsonBtn');
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const resetArchiveBtn = document.getElementById('resetArchiveBtn');
  const jsonModal = document.getElementById('jsonModal');
  const jsonModalPre = document.getElementById('jsonModalPre');
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  const closeJsonModalBtn = document.getElementById('closeJsonModalBtn');

  // --------------------------------------------------------------------------
  // 1. Inicialização & Persistência
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
      console.warn('Erro ao ler entradas salvas:', err);
      allEntries = [];
    }
  }

  function saveEntriesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allEntries));
    } catch (err) {
      console.warn('Erro ao salvar entradas no localStorage:', err);
    }
    updateArchiveCounters();
  }

  function buildExportPayload() {
    return {
      projeto: 'Oficina II — Experiência de Cocriação Sonora',
      epigrafe: 'Enquanto uns são aplaudidos no palco, outros são abafados pela platéia.',
      exportadoEm: new Date().toISOString(),
      totalEntradas: allEntries.length,
      visiveisNoPalcoERanking: Math.min(allEntries.length, MAX_VISIBLE_RANKING),
      abafadosPelaPlateia: Math.max(0, allEntries.length - MAX_VISIBLE_RANKING),
      entradas: allEntries.map((entry, idx) => {
        const posicaoAtualNoRanking = allEntries.length - idx;
        return {
          ...entry,
          posicaoAtualNoRanking,
          visivelNaTela: posicaoAtualNoRanking <= MAX_VISIBLE_RANKING,
        };
      }),
    };
  }

  function updateArchiveCounters() {
    const total = allEntries.length;
    totalSavedCount.textContent =
      total === 1 ? '1 entrada salva no JSON' : `${total} entradas salvas no JSON`;
    downloadCountBadge.textContent = String(total);
  }

  // --------------------------------------------------------------------------
  // 2. Busca no YouTube (API + Fallbacks)
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
        if (videos.length >= 8) break;
      }
      if (videos.length >= 8) break;
    }
    return videos;
  }

  async function searchYouTube(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Caso 1: O usuário colou um link direto do YouTube
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
      } catch (_) {
        // Continua com dados básicos do ID
      }
      return [
        {
          videoId: directVideoId,
          title: `YouTube (${directVideoId})`,
          channel: 'Link direto',
          duration: '',
          thumbnail: `https://i.ytimg.com/vi/${directVideoId}/hqdefault.jpg`,
        },
      ];
    }

    // Caso 2: Endpoint Serverless local/Vercel (/api/youtube-search)
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
      } catch (_) {
        // Tenta próximo fallback
      }
    }

    // Caso 3: Fallback via /api/fetch-html (já existente no domínio afonso.io)
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      trimmed
    )}&hl=pt-BR`;

    const fetchHtmlEndpoints = ['/api/fetch-html/', 'https://www.afonso.io/api/fetch-html/'];
    for (const proxyEndpoint of fetchHtmlEndpoints) {
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
      } catch (_) {
        // Continua
      }
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
      li.textContent = 'Buscando no YouTube...';
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
      li.textContent = 'Nenhum resultado encontrado. Tente outro termo ou cole o link do YouTube.';
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

      li.addEventListener('click', () => {
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

    selectedSongThumb.src = selectedSong.thumbnail;
    selectedSongTitle.textContent = selectedSong.title;
    selectedSongChannel.textContent = [selectedSong.channel, selectedSong.duration]
      .filter(Boolean)
      .join(' · ');

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
    songSearchInput.focus();
  }

  clearSongBtn.addEventListener('click', clearSelectedSong);

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
    }, 340);
  });

  // Navegação por teclado no dropdown
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
  // 3. Jukebox em Looping (YouTube IFrame API)
  // --------------------------------------------------------------------------

  function loadAndLoopVideo(videoId) {
    if (!videoId) return;
    currentPlayingVideoId = videoId;

    if (!ytApiReady || typeof YT === 'undefined' || !YT.Player) {
      return;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      ytPlayer.loadVideoById({
        videoId: videoId,
        startSeconds: 0,
      });
      ytPlayer.playVideo();
      return;
    }

    ytPlayer = new YT.Player('ytPlayerContainer', {
      width: '100%',
      height: '100%',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        loop: 1,
        playlist: videoId,
        playsinline: 1,
      },
      events: {
        onReady: (event) => {
          event.target.playVideo();
          setJukeboxPlayingUI(true);
        },
        onStateChange: (event) => {
          // Garante looping infinito da última música enviada
          if (event.data === YT.PlayerState.ENDED) {
            event.target.seekTo(0);
            event.target.playVideo();
          } else if (event.data === YT.PlayerState.PLAYING) {
            setJukeboxPlayingUI(true);
          } else if (event.data === YT.PlayerState.PAUSED) {
            setJukeboxPlayingUI(false);
          }
        },
      },
    });
  }

  function setJukeboxPlayingUI(playing) {
    isPlayerPlaying = playing;
    if (playing) {
      jukeboxPlayIcon.style.display = 'none';
      jukeboxPauseIcon.style.display = 'block';
    } else {
      jukeboxPlayIcon.style.display = 'block';
      jukeboxPauseIcon.style.display = 'none';
    }
  }

  jukeboxPlayPauseBtn.addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  });

  toggleVideoBtn.addEventListener('click', () => {
    ytPlayerWrapper.classList.toggle('is-collapsed');
  });

  // --------------------------------------------------------------------------
  // 4. Renderização do Palco (#1) e Ranking Efêmero (até 5 pessoas)
  // --------------------------------------------------------------------------

  function formatShortTime(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderStageSpotlight() {
    if (allEntries.length === 0) {
      jukeboxEmpty.hidden = false;
      jukeboxActive.hidden = true;
      loopIndicator.hidden = true;
      return;
    }

    const latest = allEntries[allEntries.length - 1];
    jukeboxEmpty.hidden = true;
    jukeboxActive.hidden = false;
    loopIndicator.hidden = false;

    stageMeaning.textContent = `“${latest.meaning}”`;
    stageParticipantName.textContent = latest.name;
    stageTimestamp.textContent = formatShortTime(latest.createdAt);
    stageSongTitle.textContent = latest.song.title;
    stageSongChannel.textContent = latest.song.channel;

    if (currentPlayingVideoId !== latest.song.videoId) {
      loadAndLoopVideo(latest.song.videoId);
    }
  }

  function createRankingItemElement(entry, rankPosition, isNewTop = false) {
    const li = document.createElement('li');
    li.className = 'ranking-item';
    if (isNewTop) {
      li.classList.add('entering-stage');
    }
    li.dataset.entryId = entry.id;
    li.dataset.rank = String(rankPosition);

    const topRow = document.createElement('div');
    topRow.className = 'ranking-item-top';

    const personWrap = document.createElement('div');
    personWrap.className = 'ranking-person';

    const posBadge = document.createElement('span');
    posBadge.className = 'ranking-pos';
    posBadge.textContent = `#${rankPosition}`;

    const nameEl = document.createElement('span');
    nameEl.className = 'ranking-name';
    nameEl.textContent = entry.name;

    personWrap.appendChild(posBadge);
    personWrap.appendChild(nameEl);

    const songTag = document.createElement('span');
    songTag.className = 'ranking-song-tag';
    songTag.textContent = `♪ ${entry.song.title}`;

    topRow.appendChild(personWrap);
    topRow.appendChild(songTag);

    const meaningEl = document.createElement('p');
    meaningEl.className = 'ranking-meaning';
    meaningEl.textContent = entry.meaning;

    li.appendChild(topRow);
    li.appendChild(meaningEl);

    return li;
  }

  /**
   * Atualiza o ranking visual.
   * A partir da 5ª pessoa, quando uma nova pessoa envia, a que estava na 5ª posição
   * é empurrada para baixo e apagada visualmente (com animação .pushed-out).
   */
  function renderRanking(animateNewSubmission = false) {
    const total = allEntries.length;

    if (total === 0) {
      rankingEmpty.hidden = false;
      rankingList.innerHTML = '';
      rankingCounter.textContent = `0 / ${MAX_VISIBLE_RANKING} visíveis`;
      muffledNotice.hidden = true;
      return;
    }

    rankingEmpty.hidden = true;

    // As últimas 5 pessoas (em ordem reversa: mais recente no topo #1)
    const visibleEntries = allEntries.slice(-MAX_VISIBLE_RANKING).reverse();
    const muffledCount = Math.max(0, total - MAX_VISIBLE_RANKING);

    rankingCounter.textContent = `${visibleEntries.length} / ${MAX_VISIBLE_RANKING} visíveis`;

    if (muffledCount > 0) {
      muffledNotice.hidden = false;
      muffledCountText.textContent =
        muffledCount === 1
          ? '1 voz anterior já foi abafada pela platéia (preservada no JSON)'
          : `${muffledCount} vozes anteriores já foram abafadas pela platéia (preservadas no JSON)`;
    } else {
      muffledNotice.hidden = true;
    }

    if (!animateNewSubmission) {
      rankingList.innerHTML = '';
      visibleEntries.forEach((entry, index) => {
        const rankPos = index + 1;
        rankingList.appendChild(createRankingItemElement(entry, rankPos, false));
      });
      return;
    }

    // Se estamos animando uma nova submissão:
    // 1. Insere a nova entrada no topo (#1)
    const newestEntry = visibleEntries[0];
    const newTopEl = createRankingItemElement(newestEntry, 1, true);
    rankingList.prepend(newTopEl);

    // 2. Atualiza as posições dos itens existentes e empurra/apaga quem passar de 5
    const allDomItems = Array.from(rankingList.querySelectorAll('.ranking-item:not(.pushed-out)'));
    allDomItems.forEach((itemEl, index) => {
      const newRank = index + 1;
      const posBadge = itemEl.querySelector('.ranking-pos');
      if (posBadge) {
        posBadge.textContent = `#${newRank}`;
      }

      if (newRank <= MAX_VISIBLE_RANKING) {
        itemEl.dataset.rank = String(newRank);
      } else {
        // Passou da 5ª pessoa -> empurrada para baixo e apagada!
        itemEl.classList.add('pushed-out');
        itemEl.addEventListener(
          'animationend',
          () => {
            itemEl.remove();
          },
          { once: true }
        );
      }
    });
  }

  // --------------------------------------------------------------------------
  // 5. Submissão do Formulário
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
      showError('Por favor, pesquise e selecione uma música na lista.');
      songSearchInput.focus();
      return;
    }

    const name = participantNameInput.value.trim();
    if (!name) {
      showError('Por favor, informe seu nome.');
      participantNameInput.focus();
      return;
    }

    const meaning = songMeaningInput.value.trim();
    if (!meaning) {
      showError('Por favor, conte o que essa música significa para você.');
      songMeaningInput.focus();
      return;
    }

    const newEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sequenceNumber: allEntries.length + 1,
      name,
      meaning,
      song: { ...selectedSong },
      createdAt: new Date().toISOString(),
    };

    allEntries.push(newEntry);
    saveEntriesToStorage();

    // Atualiza Jukebox (#1 em looping) e Ranking (empurrando/apagando a partir da 5ª)
    renderStageSpotlight();
    renderRanking(true);

    // Limpa o formulário para a próxima pessoa da fila
    clearSelectedSong();
    participantNameInput.value = '';
    songMeaningInput.value = '';
  });

  // --------------------------------------------------------------------------
  // 6. Exportação e Visualização do JSON Completo
  // --------------------------------------------------------------------------

  downloadJsonBtn.addEventListener('click', () => {
    const payload = buildExportPayload();
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `oficinaII-entradas-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  viewJsonBtn.addEventListener('click', () => {
    const payload = buildExportPayload();
    jsonModalPre.textContent = JSON.stringify(payload, null, 2);
    jsonModal.hidden = false;
  });

  closeJsonModalBtn.addEventListener('click', () => {
    jsonModal.hidden = true;
  });

  jsonModal.addEventListener('click', (e) => {
    if (e.target === jsonModal) {
      jsonModal.hidden = true;
    }
  });

  copyJsonBtn.addEventListener('click', async () => {
    const payload = buildExportPayload();
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      const original = copyJsonBtn.textContent;
      copyJsonBtn.textContent = 'Copiado ✓';
      setTimeout(() => {
        copyJsonBtn.textContent = original;
      }, 1800);
    } catch (_) {
      // Fallback
    }
  });

  resetArchiveBtn.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    const confirmed = window.confirm(
      `Tem certeza que deseja apagar as ${allEntries.length} entradas salvas neste navegador? Recomendamos clicar em "Baixar JSON" antes de reiniciar.`
    );
    if (!confirmed) return;

    allEntries = [];
    saveEntriesToStorage();
    currentPlayingVideoId = null;
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
      ytPlayer.stopVideo();
    }
    renderStageSpotlight();
    renderRanking(false);
  });

  // Inicialização da página
  loadStoredEntries();
  updateArchiveCounters();
  renderStageSpotlight();
  renderRanking(false);
});

