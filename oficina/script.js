// ==========================================================================
// OFICINA — Audio Player & Script Simples, Minimalista e Mobile
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const currentTimeEl = document.getElementById('currentTime');
  const durationTimeEl = document.getElementById('durationTime');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const editableText = document.getElementById('editableText');
  const saveHint = document.getElementById('saveHint');

  let isDragging = false;

  // Format seconds to mm:ss
  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Play / Pause Toggle
  function togglePlay() {
    if (audio.paused) {
      audio.play().then(() => {
        setPlayingState(true);
      }).catch(err => {
        console.warn('Playback error:', err);
      });
    } else {
      audio.pause();
      setPlayingState(false);
    }
  }

  function setPlayingState(isPlaying) {
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      playBtn.setAttribute('aria-label', 'Pausar áudio');
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      playBtn.setAttribute('aria-label', 'Tocar áudio');
    }
  }

  playBtn.addEventListener('click', togglePlay);

  // Audio Events
  audio.addEventListener('play', () => setPlayingState(true));
  audio.addEventListener('pause', () => setPlayingState(false));
  audio.addEventListener('ended', () => {
    setPlayingState(false);
    updateProgress(0);
  });

  audio.addEventListener('loadedmetadata', () => {
    durationTimeEl.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('timeupdate', () => {
    if (!isDragging && audio.duration) {
      const percent = (audio.currentTime / audio.duration) * 100;
      updateProgress(percent);
      currentTimeEl.textContent = formatTime(audio.currentTime);
    }
  });

  function updateProgress(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    progressFill.style.width = `${clamped}%`;
    progressThumb.style.left = `${clamped}%`;
  }

  // Scrubber calculation from event (Mouse or Touch)
  function seekFromEvent(e) {
    const rect = progressWrap.getBoundingClientRect();
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const offsetX = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, offsetX / rect.width));
    
    if (audio.duration) {
      audio.currentTime = percent * audio.duration;
      currentTimeEl.textContent = formatTime(audio.currentTime);
    }
    updateProgress(percent * 100);
  }

  // Touch Events (Mobile)
  progressWrap.addEventListener('touchstart', (e) => {
    isDragging = true;
    seekFromEvent(e);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging) {
      seekFromEvent(e);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
    }
  });

  // Mouse Events (Desktop)
  progressWrap.addEventListener('mousedown', (e) => {
    isDragging = true;
    seekFromEvent(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      seekFromEvent(e);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
    }
  });

  // Spacebar to play/pause (when not actively editing text)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== editableText) {
      e.preventDefault();
      togglePlay();
    }
  });

  // Optional: Auto-save text edits locally so the user can freely edit the memory
  const STORAGE_KEY = 'oficina_labcom_text';
  const savedText = localStorage.getItem(STORAGE_KEY);
  if (savedText) {
    editableText.innerHTML = savedText;
  }

  let saveTimeout;
  editableText.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveHint.textContent = 'salvando...';
    saveTimeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, editableText.innerHTML);
      saveHint.textContent = 'salvo';
      setTimeout(() => {
        saveHint.textContent = '';
      }, 2000);
    }, 600);
  });
});
