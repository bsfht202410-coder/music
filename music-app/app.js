const AUDIO_EXTENSIONS = [
  ".mp3", ".m4a", ".aac", ".ogg", ".wav", ".m4b", ".opus", ".webm"
];

/* Default fallback repository */
const DEFAULT_OWNER = "bsfht202410-coder";
const DEFAULT_REPO = "music";

/* DOM Elements */
const player = document.getElementById("player");
const booksEl = document.getElementById("books");

/* Mini Player Elements */
const miniProgressFill = document.getElementById("mini-progress-bar");
const miniBookTitle = document.getElementById("mini-book-title");
const miniChapterTitle = document.getElementById("mini-chapter-title");
const miniPlayBtn = document.getElementById("mini-play-btn");
const miniPlayIcon = document.getElementById("mini-play-icon");
const miniSkipBack = document.getElementById("mini-skip-back");
const miniSkipFwd = document.getElementById("mini-skip-fwd");
const miniInfoTap = document.getElementById("mini-info-tap");
const miniExpandBtn = document.getElementById("mini-expand-btn");

/* Modal Player Elements */
const playerModal = document.getElementById("player-modal");
const modalCloseBtn = document.getElementById("modal-close-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalHandle = document.getElementById("modal-handle");
const modalBookTitle = document.getElementById("modal-book-title");
const modalChapterTitle = document.getElementById("modal-chapter-title");
const modalSeekSlider = document.getElementById("modal-seek-slider");
const currentTimeLabel = document.getElementById("current-time-label");
const durationLabel = document.getElementById("duration-label");
const modalPlayBtn = document.getElementById("modal-play-btn");
const modalPlayIcon = document.getElementById("modal-play-icon");
const modalPrevBtn = document.getElementById("modal-prev-btn");
const modalNextBtn = document.getElementById("modal-next-btn");
const modalSkipBackBtn = document.getElementById("modal-skip-back-btn");
const modalSkipFwdBtn = document.getElementById("modal-skip-fwd-btn");
const modalSkipBack30 = document.getElementById("modal-skip-back-30");
const modalSkipFwd30 = document.getElementById("modal-skip-fwd-30");
const modalSpeedBtn = document.getElementById("modal-speed-btn");
const sleepTimerBtn = document.getElementById("sleep-timer-btn");
const sleepTimerText = document.getElementById("sleep-timer-text");

let books = [];
let loadedBooks = new Set();
let current = null;
let lastSaveTime = 0;
let isUserScrubbing = false;

/* Sleep timer state */
const SLEEP_OPTIONS = [0, 15, 30, 45, 60, "end"];
let currentSleepIdx = 0;
let sleepTimeout = null;
let sleepInterval = null;
let sleepEndTime = 0;

/* Speeds */
const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
let currentSpeedIdx = 1; // default 1.0x

initialLoad();

/* ---------- Robust Repo Detection & Persistence ---------- */

function getRepoSettings() {
  let owner = DEFAULT_OWNER;
  let repo = DEFAULT_REPO;

  try {
    const saved = localStorage.getItem("audiobook-loader-settings");
    if (saved) {
      const s = JSON.parse(saved);
      if (s.owner && s.owner.trim()) owner = s.owner.trim();
      if (s.repo && s.repo.trim()) repo = s.repo.trim();
      return { owner, repo };
    }
  } catch (error) {
    console.warn("Could not read saved settings:", error);
  }

  const host = window.location.hostname;
  const path = window.location.pathname;

  // Detect username from github.io domain (e.g. bsfht202410-coder.github.io)
  if (host.endsWith(".github.io")) {
    owner = host.split(".")[0];
    const pathParts = path.split("/").filter(Boolean);
    if (pathParts.length > 0 && !pathParts[0].includes(".")) {
      repo = pathParts[0];
    }
  }

  return { owner, repo };
}

async function initialLoad() {
  booksEl.innerHTML = '<p class="empty"><i class="ph ph-spinner ph-spin" style="font-size:26px;display:block;margin-bottom:10px"></i>Loading library...</p>';

  const { owner, repo } = getRepoSettings();

  try {
    const releases = await fetchReleases(owner, repo);
    books = buildBooks(releases);

    loadedBooks = new Set();
    books.forEach((book) => {
      if (!getCollapsed(book.id)) loadedBooks.add(book.id);
    });

    renderBooks();
  } catch (error) {
    console.error("Initial load error:", error);
    books = [];
    booksEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.innerHTML = `<i class="ph-bold ph-warning-circle" style="font-size:28px;color:#f59e0b;display:block;margin-bottom:8px"></i>${error.message}<br><button id="retry-load-btn" class="pill-btn" style="margin:12px auto 0;display:inline-flex;">Retry</button>`;
    booksEl.appendChild(p);

    const retryBtn = document.getElementById("retry-load-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", initialLoad);
    }
  }
}

/* ---------- Progress Storage ---------- */

function getChapterState(bookId, chapterId) {
  try {
    const raw = localStorage.getItem(`state:${bookId}:${chapterId}`);
    return raw ? JSON.parse(raw) : { time: 0, completed: false };
  } catch {
    return { time: 0, completed: false };
  }
}

function saveChapterState(bookId, chapterId, state) {
  localStorage.setItem(`state:${bookId}:${chapterId}`, JSON.stringify(state));
}

function getCollapsed(bookId) {
  return localStorage.getItem(`collapsed:${bookId}`) !== "0";
}

function setCollapsed(bookId, collapsed) {
  localStorage.setItem(`collapsed:${bookId}`, collapsed ? "1" : "0");
}

function isLoaded(bookId) {
  return loadedBooks.has(bookId);
}

function loadBook(bookId) {
  loadedBooks.add(bookId);
  setCollapsed(bookId, false);
  renderBooks();
}

function toggleChapter(bookId, chapterId) {
  const state = getChapterState(bookId, chapterId);
  state.completed = !state.completed;
  saveChapterState(bookId, chapterId, state);
  renderBooks();
}

function markBookCompleted(bookId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;
  book.chapters.forEach(ch => {
    const state = getChapterState(bookId, ch.id);
    state.completed = true;
    saveChapterState(bookId, ch.id, state);
  });
  renderBooks();
}

function resetBookProgress(bookId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;
  if (!confirm(`Reset all progress for "${book.title}"?`)) return;
  book.chapters.forEach(ch => {
    saveChapterState(bookId, ch.id, { time: 0, completed: false });
  });
  renderBooks();
}

/* ---------- GitHub Releases API with Offline Cache ---------- */

async function fetchReleases(owner, repo) {
  const cacheKey = `releases_cache:${owner}:${repo}`;
  const apiUrl =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/releases?per_page=100`;

  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        localStorage.setItem(cacheKey, JSON.stringify(data));
        return data;
      }
    }
  } catch (err) {
    console.warn("Network fetch failed, attempting cached data fallback:", err);
  }

  // Fallback to cache
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (e) {
      console.warn("Cached data parse error:", e);
    }
  }

  throw new Error("Unable to load audio releases. Please verify repository is public.");
}

function buildBooks(releases) {
  const result = [];

  for (const release of releases) {
    if (release.draft) continue;

    const assets = (release.assets || [])
      .filter((asset) => isAudioName(asset.name))
      .sort((a, b) => {
        return (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
          sensitivity: "base"
        });
      });

    if (!assets.length) continue;

    result.push({
      id: `release:${release.id}`,
      title:
        release.name && release.name.trim()
          ? release.name.trim()
          : "Untitled book",
      chapters: assets.map((asset) => ({
        id: String(asset.id),
        title: cleanName(asset.name),
        src: asset.browser_download_url
      }))
    });
  }

  return result;
}

function isAudioName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cleanName(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return (
    withoutExtension
      .replace(/[-_.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled"
  );
}

/* ---------- Rendering Books ---------- */

function renderBooks() {
  booksEl.innerHTML = "";

  if (!books.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.innerHTML = '<i class="ph ph-books" style="font-size:32px;display:block;margin-bottom:8px"></i>No books found in this repository.';
    booksEl.appendChild(p);
    return;
  }

  books.forEach((book) => {
    const loaded = isLoaded(book.id);

    const section = document.createElement("section");
    section.className = "book";
    if (loaded && getCollapsed(book.id)) section.classList.add("collapsed");

    let completedCount = 0;
    let startedCount = 0;

    book.chapters.forEach((ch) => {
      const st = getChapterState(book.id, ch.id);
      if (st.completed) completedCount++;
      if (st.completed || st.time > 0) startedCount++;
    });

    const total = book.chapters.length;

    let statusClass = "status-new";
    let badgeClass = "badge-new";
    let badgeText = "Not started";

    if (total > 0 && completedCount === total) {
      statusClass = "status-completed";
      badgeClass = "badge-completed";
      badgeText = "Finished";
    } else if (startedCount > 0) {
      statusClass = "status-partial";
      badgeClass = "badge-partial";
      badgeText = `${completedCount}/${total} done`;
    }

    section.classList.add(statusClass);

    /* Header row */
    const headerRow = document.createElement("div");
    headerRow.className = "book-header";

    const collapseBtn = document.createElement("button");
    collapseBtn.className = "collapse-btn";
    collapseBtn.innerHTML = '<i class="ph-bold ph-caret-right"></i>';
    collapseBtn.setAttribute("aria-label", "Open or close book");

    const title = document.createElement("h3");
    title.className = "book-title";
    title.textContent = book.title;

    const count = document.createElement("span");
    count.className = "book-count";
    count.textContent = `${total} chapters`;

    const badge = document.createElement("span");
    badge.className = `badge ${badgeClass}`;
    badge.textContent = badgeText;

    headerRow.appendChild(collapseBtn);
    headerRow.appendChild(title);
    headerRow.appendChild(count);
    headerRow.appendChild(badge);

    headerRow.addEventListener("click", () => {
      if (!isLoaded(book.id)) {
        loadBook(book.id);
        return;
      }
      const nowCollapsed = !section.classList.contains("collapsed");
      section.classList.toggle("collapsed", nowCollapsed);
      setCollapsed(book.id, nowCollapsed);
    });

    /* Body */
    const body = document.createElement("div");
    body.className = "book-body";

    if (!loaded) {
      const loadBtnBook = document.createElement("button");
      loadBtnBook.className = "load-book-btn";
      loadBtnBook.innerHTML = '<i class="ph-bold ph-list-bullets"></i> Load chapters';
      loadBtnBook.addEventListener("click", (e) => {
        e.stopPropagation();
        loadBook(book.id);
      });
      body.appendChild(loadBtnBook);
    } else {
      const bookActions = document.createElement("div");
      bookActions.className = "book-actions";

      if (completedCount > 0 && completedCount < total) {
        const markAllBtn = document.createElement("button");
        markAllBtn.innerHTML = '<i class="ph-bold ph-check-square"></i> Mark all completed';
        markAllBtn.addEventListener("click", () => markBookCompleted(book.id));
        bookActions.appendChild(markAllBtn);
      }

      if (startedCount > 0) {
        const resetBtn = document.createElement("button");
        resetBtn.innerHTML = '<i class="ph-bold ph-arrow-counter-clockwise"></i> Reset progress';
        resetBtn.addEventListener("click", () => resetBookProgress(book.id));
        bookActions.appendChild(resetBtn);
      }

      if (bookActions.children.length > 0) body.appendChild(bookActions);

      const chapterList = document.createElement("ol");

      book.chapters.forEach((chapter, chapterIndex) => {
        const state = getChapterState(book.id, chapter.id);
        const isCurrentPlaying = current && current.bookId === book.id && current.chapterIndex === chapterIndex;

        const li = document.createElement("li");
        li.className = "chapter-row";

        const button = document.createElement("button");
        button.className = "chapter-button";
        if (state.completed) button.classList.add("completed");
        if (isCurrentPlaying) button.classList.add("playing");

        const chapterTitle = chapter.title || `Chapter ${chapterIndex + 1}`;
        let iconHtml = isCurrentPlaying 
          ? '<i class="ph-fill ph-speaker-high" style="color:var(--accent-emerald)"></i>'
          : (state.completed ? '<i class="ph-fill ph-check-circle" style="color:var(--accent-emerald)"></i>' : '<i class="ph-fill ph-play-circle"></i>');

        let extraText = '';
        if (!state.completed && state.time > 0) {
          extraText = ` <span style="font-size: 0.82em; color: var(--accent-amber); font-weight:600">(${formatTime(state.time)})</span>`;
        }

        button.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px; min-width:0; overflow:hidden">
            <span style="font-size:18px; flex-shrink:0">${iconHtml}</span>
            <span class="chapter-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${chapterTitle}</span>
          </div>
          ${extraText}
        `;

        button.addEventListener("click", () => {
          playChapter(book.id, chapterIndex);
        });

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "toggle-btn" + (state.completed ? " completed" : "");
        toggleBtn.innerHTML = state.completed ? '<i class="ph-fill ph-check-circle"></i>' : '<i class="ph ph-circle"></i>';
        toggleBtn.title = state.completed ? "Mark uncompleted" : "Mark completed";
        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleChapter(book.id, chapter.id);
        });

        li.appendChild(button);
        li.appendChild(toggleBtn);
        chapterList.appendChild(li);
      });

      body.appendChild(chapterList);
    }

    section.appendChild(headerRow);
    section.appendChild(body);
    booksEl.appendChild(section);
  });
}

/* ---------- Playback Core (Mobile Friendly) ---------- */

function playChapter(bookId, chapterIndex) {
  const book = books.find((b) => b.id === bookId);
  if (!book) return;
  const chapter = book.chapters[chapterIndex];
  if (!chapter || !chapter.src) return;

  if (!isLoaded(bookId)) loadedBooks.add(bookId);
  if (getCollapsed(bookId)) setCollapsed(bookId, false);

  current = {
    bookId,
    chapterId: chapter.id,
    chapterIndex,
    bookTitle: book.title,
    chapterTitle: chapter.title || `Chapter ${chapterIndex + 1}`
  };

  renderBooks();
  updatePlayerUI();

  const state = getChapterState(bookId, chapter.id);
  const startTime = state.completed ? 0 : state.time;

  startAudio(chapter.src, startTime);
}

function startAudio(src, startTime) {
  if (!src) return;

  player.src = src;
  player.playbackRate = PLAYBACK_SPEEDS[currentSpeedIdx];

  // Resume position when metadata loads
  if (startTime > 0) {
    const onMetadata = () => {
      player.removeEventListener("loadedmetadata", onMetadata);
      if (startTime < (player.duration || Infinity) - 2) {
        player.currentTime = startTime;
      }
    };
    player.addEventListener("loadedmetadata", onMetadata);
  }

  // Play immediately within user click event context to comply with mobile autoplay policies
  const playPromise = player.play();
  if (playPromise !== undefined) {
    playPromise.catch((error) => {
      console.warn("Autoplay check:", error);
    });
  }

  updateMediaSession();
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.chapterTitle,
      artist: current.bookTitle,
      album: "Audiobook"
    });

    navigator.mediaSession.setActionHandler('play', () => player.play());
    navigator.mediaSession.setActionHandler('pause', () => player.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => skipSeconds(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => skipSeconds(10));
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevChapter());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNextChapter());
  } catch (e) {
    console.warn("MediaSession error:", e);
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updatePlayerUI() {
  if (!current) return;

  miniBookTitle.textContent = current.bookTitle;
  miniChapterTitle.textContent = current.chapterTitle;

  modalBookTitle.textContent = current.bookTitle;
  modalChapterTitle.textContent = current.chapterTitle;
}

function updatePlayIcons(isPlaying) {
  const iconClass = isPlaying ? "ph-fill ph-pause" : "ph-fill ph-play";
  miniPlayIcon.className = iconClass;
  modalPlayIcon.className = iconClass;

  if (isPlaying) {
    playerModal.classList.add("playing");
  } else {
    playerModal.classList.remove("playing");
  }
}

function skipSeconds(offset) {
  if (!player || !Number.isFinite(player.duration)) return;
  const newTime = Math.max(0, Math.min(player.duration, player.currentTime + offset));
  player.currentTime = newTime;
  updateSeekSlider();
}

function updateSeekSlider() {
  if (isUserScrubbing) return;

  const duration = player.duration || 0;
  const currentT = player.currentTime || 0;

  currentTimeLabel.textContent = formatTime(currentT);
  durationLabel.textContent = formatTime(duration);

  if (duration > 0) {
    const percent = Math.min(100, Math.max(0, (currentT / duration) * 100));
    miniProgressFill.style.width = `${percent}%`;
    modalSeekSlider.value = percent;

    // Smooth gradient on track
    modalSeekSlider.style.background = `linear-gradient(to right, var(--accent-emerald) 0%, var(--accent-emerald) ${percent}%, #27272a ${percent}%, #27272a 100%)`;
  } else {
    miniProgressFill.style.width = "0%";
    modalSeekSlider.value = 0;
    modalSeekSlider.style.background = "#27272a";
  }
}

/* ---------- Audio Event Handlers ---------- */

player.addEventListener("play", () => {
  updatePlayIcons(true);
});

player.addEventListener("pause", () => {
  updatePlayIcons(false);
  if (current) {
    const state = getChapterState(current.bookId, current.chapterId);
    state.time = player.currentTime;
    saveChapterState(current.bookId, current.chapterId, state);
  }
});

player.addEventListener("timeupdate", () => {
  updateSeekSlider();

  if (!current) return;
  const now = Date.now();
  const state = getChapterState(current.bookId, current.chapterId);

  // Auto mark completed at 98%
  if (player.duration > 0 && player.currentTime >= player.duration - 4) {
    if (!state.completed) {
      state.completed = true;
      state.time = player.duration;
      saveChapterState(current.bookId, current.chapterId, state);
      renderBooks();
    }
  }

  // Periodic save
  if (now - lastSaveTime > 2500) {
    state.time = player.currentTime;
    saveChapterState(current.bookId, current.chapterId, state);
    lastSaveTime = now;
  }
});

player.addEventListener("ended", () => {
  if (!current) return;
  const state = getChapterState(current.bookId, current.chapterId);
  state.completed = true;
  state.time = player.duration;
  saveChapterState(current.bookId, current.chapterId, state);
  renderBooks();

  if (sleepTimerText.textContent.includes("End of Ch.")) {
    clearSleepTimer();
    return;
  }

  playNextChapter();
});

function playNextChapter() {
  if (!current) return;
  const book = books.find((b) => b.id === current.bookId);
  if (!book || !Array.isArray(book.chapters)) return;
  const nextIndex = current.chapterIndex + 1;
  if (nextIndex < book.chapters.length) {
    playChapter(current.bookId, nextIndex);
  }
}

function playPrevChapter() {
  if (!current) return;
  if (player.currentTime > 5) {
    player.currentTime = 0;
    return;
  }
  const prevIndex = current.chapterIndex - 1;
  if (prevIndex >= 0) {
    playChapter(current.bookId, prevIndex);
  }
}

/* ---------- Touch / Scrubber Events ---------- */

modalSeekSlider.addEventListener("input", (e) => {
  isUserScrubbing = true;
  const percent = parseFloat(e.target.value);
  if (player.duration) {
    const previewTime = (percent / 100) * player.duration;
    currentTimeLabel.textContent = formatTime(previewTime);
    modalSeekSlider.style.background = `linear-gradient(to right, var(--accent-emerald) 0%, var(--accent-emerald) ${percent}%, #27272a ${percent}%, #27272a 100%)`;
  }
});

modalSeekSlider.addEventListener("change", (e) => {
  if (player.duration) {
    const percent = parseFloat(e.target.value);
    player.currentTime = (percent / 100) * player.duration;
  }
  isUserScrubbing = false;
});

/* ---------- Play/Pause Toggle ---------- */

function togglePlay() {
  if (!player.src) {
    if (books.length > 0 && books[0].chapters.length > 0) {
      playChapter(books[0].id, 0);
    }
    return;
  }

  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
}

miniPlayBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlay();
});

modalPlayBtn.addEventListener("click", togglePlay);

/* ---------- Skip Controls ---------- */

miniSkipBack.addEventListener("click", (e) => {
  e.stopPropagation();
  skipSeconds(-10);
});

miniSkipFwd.addEventListener("click", (e) => {
  e.stopPropagation();
  skipSeconds(10);
});

modalSkipBackBtn.addEventListener("click", () => skipSeconds(-10));
modalSkipFwdBtn.addEventListener("click", () => skipSeconds(10));
modalSkipBack30.addEventListener("click", () => skipSeconds(-30));
modalSkipFwd30.addEventListener("click", () => skipSeconds(30));

modalPrevBtn.addEventListener("click", playPrevChapter);
modalNextBtn.addEventListener("click", playNextChapter);

/* ---------- Speed Control ---------- */

modalSpeedBtn.addEventListener("click", () => {
  currentSpeedIdx = (currentSpeedIdx + 1) % PLAYBACK_SPEEDS.length;
  const speed = PLAYBACK_SPEEDS[currentSpeedIdx];
  player.playbackRate = speed;
  modalSpeedBtn.textContent = `${speed.toFixed(speed % 1 === 0 ? 1 : 2)}x`;
});

/* ---------- Sleep Timer ---------- */

function clearSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  if (sleepInterval) clearInterval(sleepInterval);
  sleepTimeout = null;
  sleepInterval = null;
  sleepTimerBtn.classList.remove("active");
  sleepTimerText.textContent = "Timer";
  currentSleepIdx = 0;
}

sleepTimerBtn.addEventListener("click", () => {
  currentSleepIdx = (currentSleepIdx + 1) % SLEEP_OPTIONS.length;
  const option = SLEEP_OPTIONS[currentSleepIdx];

  if (sleepTimeout) clearTimeout(sleepTimeout);
  if (sleepInterval) clearInterval(sleepInterval);

  if (option === 0) {
    clearSleepTimer();
    return;
  }

  sleepTimerBtn.classList.add("active");

  if (option === "end") {
    sleepTimerText.textContent = "End of Ch.";
    return;
  }

  const durationMs = option * 60 * 1000;
  sleepEndTime = Date.now() + durationMs;

  sleepTimeout = setTimeout(() => {
    player.pause();
    clearSleepTimer();
  }, durationMs);

  updateSleepCountdown();
  sleepInterval = setInterval(updateSleepCountdown, 1000);
});

function updateSleepCountdown() {
  const remainingSec = Math.round((sleepEndTime - Date.now()) / 1000);
  if (remainingSec <= 0) {
    clearSleepTimer();
    return;
  }
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  sleepTimerText.textContent = `${m}:${s.toString().padStart(2, "0")}`;
}

/* ---------- Modal Sheet Open / Close ---------- */

function openModal() {
  playerModal.classList.add("open");
  playerModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  updateSeekSlider();
}

function closeModal() {
  playerModal.classList.remove("open");
  playerModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

miniInfoTap.addEventListener("click", openModal);
miniExpandBtn.addEventListener("click", openModal);
modalCloseBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

// Swipe down to dismiss gesture on mobile
let touchStartY = 0;
modalHandle.addEventListener("touchstart", (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

modalHandle.addEventListener("touchend", (e) => {
  const touchEndY = e.changedTouches[0].clientY;
  if (touchEndY - touchStartY > 50) {
    closeModal();
  }
}, { passive: true });
