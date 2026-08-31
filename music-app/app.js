const AUDIO_EXTENSIONS = [
  ".mp3", ".m4a", ".aac", ".ogg", ".wav", ".m4b", ".opus", ".webm"
];

/* Fallback if the repo cannot be detected from the URL */
const DEFAULT_OWNER = "bsfht202410-coder";
const DEFAULT_REPO = "music";

const player = document.getElementById("player");
const nowPlaying = document.getElementById("now-playing");
const booksEl = document.getElementById("books");

let books = [];
let loadedBooks = new Set();
let current = null;
let lastSaveTime = 0;

initialLoad();

/* ---------- repo detection (no visible inputs) ---------- */

function getRepoSettings() {
  let owner = "";
  let repo = "";

  try {
    const saved = localStorage.getItem("audiobook-loader-settings");
    if (saved) {
      const s = JSON.parse(saved);
      owner = s.owner || "";
      repo = s.repo || "";
    }
  } catch (error) {
    console.warn("Could not read saved settings:", error);
  }

  const host = window.location.hostname;
  const path = window.location.pathname;

  if (!owner && host.endsWith(".github.io")) {
    owner = host.split(".")[0];
  }

  if (!repo) {
    const possibleRepo = path.split("/")[1];
    if (possibleRepo && !possibleRepo.endsWith(".html")) {
      repo = possibleRepo;
    }
  }

  return {
    owner: owner || DEFAULT_OWNER,
    repo: repo || DEFAULT_REPO
  };
}

async function initialLoad() {
  booksEl.innerHTML = '<p class="empty">Loading library...</p>';

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
    console.error(error);
    books = [];
    booksEl.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = error.message;
    booksEl.appendChild(p);
  }
}

/* ---------- progress storage ---------- */

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

/* ---------- GitHub releases ---------- */

async function fetchReleases(owner, repo) {
  const apiUrl =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/releases?per_page=100`;

  const response = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github+json" }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Repo not found or private. The repository must be public.");
    }
    if (response.status === 403) {
      throw new Error("GitHub API rate limit. Wait a little and try again.");
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
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

/* ---------- rendering ---------- */

function renderBooks() {
  booksEl.innerHTML = "";

  if (!books.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No books found. Create one release per book with MP3 assets.";
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
      badgeText = "In progress";
    }

    section.classList.add(statusClass);

    /* header row */
    const headerRow = document.createElement("div");
    headerRow.className = "book-header";

    const collapseBtn = document.createElement("button");
    collapseBtn.className = "collapse-btn";
    collapseBtn.textContent = "▸";
    collapseBtn.setAttribute("aria-label", "Open or close book");

    const title = document.createElement("h3");
    title.className = "book-title";
    title.textContent = book.title;

    const count = document.createElement("span");
    count.className = "book-count";
    count.textContent = `${completedCount}/${total}`;

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

    /* body */
    const body = document.createElement("div");
    body.className = "book-body";

    if (!loaded) {
      const loadBtnBook = document.createElement("button");
      loadBtnBook.className = "load-book-btn";
      loadBtnBook.textContent = "Load chapters";
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
        markAllBtn.textContent = "Mark all as listened";
        markAllBtn.addEventListener("click", () => markBookCompleted(book.id));
        bookActions.appendChild(markAllBtn);
      }

      if (startedCount > 0) {
        const resetBtn = document.createElement("button");
        resetBtn.textContent = "Reset book progress";
        resetBtn.addEventListener("click", () => resetBookProgress(book.id));
        bookActions.appendChild(resetBtn);
      }

      if (bookActions.children.length > 0) body.appendChild(bookActions);

      const chapterList = document.createElement("ol");

      book.chapters.forEach((chapter, chapterIndex) => {
        const state = getChapterState(book.id, chapter.id);

        const li = document.createElement("li");
        li.className = "chapter-row";

        const button = document.createElement("button");
        button.className = "chapter-button";
        if (state.completed) button.classList.add("completed");

        let btnText = chapter.title || `Chapter ${chapterIndex + 1}`;
        if (state.completed) {
          btnText = `✓ ${btnText}`;
        } else if (state.time > 0) {
          const mins = Math.floor(state.time / 60);
          const secs = Math.floor(state.time % 60).toString().padStart(2, "0");
          btnText = `▶ ${btnText} (Resume ${mins}:${secs})`;
        }
        button.textContent = btnText;

        button.addEventListener("click", () => {
          playChapter(book.id, chapterIndex);
        });

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "toggle-btn" + (state.completed ? " completed" : "");
        toggleBtn.innerHTML = state.completed ? "✓" : "○";
        toggleBtn.title = state.completed ? "Mark as unlistened" : "Mark as listened";
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

/* ---------- playback ---------- */

function playChapter(bookId, chapterIndex) {
  const book = books.find((b) => b.id === bookId);
  if (!book) return;
  const chapter = book.chapters[chapterIndex];
  if (!chapter || !chapter.src) return;

  if (!isLoaded(bookId)) loadedBooks.add(bookId);
  if (getCollapsed(bookId)) setCollapsed(bookId, false);
  renderBooks();

  current = {
    bookId,
    chapterId: chapter.id,
    chapterIndex,
    id: `state:${bookId}:${chapter.id}`
  };

  const state = getChapterState(bookId, chapter.id);
  const startTime = state.completed ? 0 : state.time;

  startAudio(chapter.src, `${book.title} — ${chapter.title}`, startTime);
}

function startAudio(src, label, startTime) {
  if (!src) {
    nowPlaying.textContent = "Missing audio file.";
    return;
  }

  player.src = src;

  if (startTime > 0) {
    nowPlaying.textContent = `${label} (Resuming...)`;
  } else {
    nowPlaying.textContent = label;
  }

  const onCanPlay = () => {
    player.removeEventListener("canplay", onCanPlay);

    if (
      startTime > 0 &&
      Number.isFinite(player.duration) &&
      startTime < player.duration - 5
    ) {
      player.currentTime = startTime;
    }

    player.play().catch((error) => {
      console.warn("Playback failed:", error);
    });

    setTimeout(() => {
      if (nowPlaying.textContent.includes("(Resuming...)")) {
        nowPlaying.textContent = label;
      }
    }, 2000);
  };

  player.addEventListener("canplay", onCanPlay);

  player.onerror = () => {
    player.onerror = null;
    nowPlaying.textContent =
      "Could not load audio file. Check that the release is public and the asset exists.";
  };

  player.load();
}

player.addEventListener("timeupdate", () => {
  if (!current) return;

  const now = Date.now();
  const state = getChapterState(current.bookId, current.chapterId);

  if (player.duration > 0 && player.currentTime >= player.duration - 5) {
    if (!state.completed) {
      state.completed = true;
      state.time = player.duration;
      saveChapterState(current.bookId, current.chapterId, state);
      renderBooks();
    }
  }

  if (now - lastSaveTime > 3000) {
    state.time = player.currentTime;
    saveChapterState(current.bookId, current.chapterId, state);
    lastSaveTime = now;
  }
});

player.addEventListener("pause", () => {
  if (!current) return;
  const state = getChapterState(current.bookId, current.chapterId);
  state.time = player.currentTime;
  saveChapterState(current.bookId, current.chapterId, state);
});

player.addEventListener("ended", () => {
  if (!current) return;

  const state = getChapterState(current.bookId, current.chapterId);
  state.completed = true;
  state.time = player.duration;
  saveChapterState(current.bookId, current.chapterId, state);
  renderBooks();
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
