const AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".wav",
  ".m4b",
  ".opus",
  ".webm"
];

const player = document.getElementById("player");
const nowPlaying = document.getElementById("now-playing");

const musicList = document.getElementById("music-list");
const booksEl = document.getElementById("books");

const musicTab = document.getElementById("tab-music");
const booksTab = document.getElementById("tab-books");

const musicView = document.getElementById("music-view");
const booksView = document.getElementById("books-view");

const ownerInput = document.getElementById("owner");
const repoInput = document.getElementById("repo");
const branchInput = document.getElementById("branch");
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");

let library = {
  music: [],
  audiobooks: []
};

let current = null;
let lastSaveTime = 0;

musicTab.addEventListener("click", () => showView("music"));
booksTab.addEventListener("click", () => showView("books"));
loadBtn.addEventListener("click", loadAll);

loadSettings();
renderMusic();
renderAudiobooks();

function showView(view) {
  if (view === "music") {
    musicView.hidden = false;
    booksView.hidden = true;
    musicTab.classList.add("active");
    booksTab.classList.remove("active");
  } else {
    musicView.hidden = true;
    booksView.hidden = false;
    musicTab.classList.remove("active");
    booksTab.classList.add("active");
  }
}

function loadSettings() {
  try {
    const saved = localStorage.getItem("github-loader-settings");

    if (saved) {
      const settings = JSON.parse(saved);

      ownerInput.value = settings.owner || "";
      repoInput.value = settings.repo || "";
      branchInput.value = settings.branch || "main";
    }
  } catch (error) {
    console.warn("Could not load saved settings:", error);
  }

  guessRepoFromCurrentUrl();
}

function guessRepoFromCurrentUrl() {
  const host = window.location.hostname;
  const path = window.location.pathname;

  if (!ownerInput.value && host.endsWith(".github.io")) {
    ownerInput.value = host.split(".")[0];
  }

  if (!repoInput.value) {
    const possibleRepo = path.split("/")[1];

    if (possibleRepo && !possibleRepo.endsWith(".html")) {
      repoInput.value = possibleRepo;
    }
  }
}

function saveSettings() {
  const settings = {
    owner: ownerInput.value.trim(),
    repo: repoInput.value.trim(),
    branch: branchInput.value.trim() || "main"
  };

  localStorage.setItem("github-loader-settings", JSON.stringify(settings));
}

async function loadAll() {
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();
  const branch = branchInput.value.trim() || "main";

  if (!owner || !repo) {
    statusEl.textContent = "Enter your GitHub username and repository name.";
    return;
  }

  saveSettings();

  statusEl.textContent = "Loading from GitHub...";

  try {
    const apiUrl =
      `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          "Repo or branch not found. Check username, repo name, and branch. Private repos need authentication."
        );
      }

      if (response.status === 403) {
        throw new Error(
          "GitHub API rate limit or permission error. Wait a little and try again."
        );
      }

      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    const files = (data.tree || []).filter((item) => {
      return item.type === "blob" && isAudioPath(item.path);
    });

    library = buildLibrary(files, owner, repo, branch);

    renderMusic();
    renderAudiobooks();

    let message =
      `Loaded ${library.music.length} music files and ` +
      `${library.audiobooks.length} audiobooks.`;

    if (data.truncated) {
      message += " Warning: GitHub returned a truncated file list.";
    }

    if (!files.length) {
      message +=
        " No audio found. Put files in media/music/ and media/audiobooks/.";
    }

    statusEl.textContent = message;
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.message;

    library = {
      music: [],
      audiobooks: []
    };

    renderMusic();
    renderAudiobooks();
  }
}

function isAudioPath(path) {
  const lower = path.toLowerCase();

  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function buildLibrary(files, owner, repo, branch) {
  const music = [];
  const bookMap = new Map();

  for (const file of files) {
    const path = file.path.replaceAll("\\", "/");

    if (!isAudioPath(path)) {
      continue;
    }

    const src = rawUrl(owner, repo, branch, path);
    const title = fileNameToTitle(path);
    const parts = path.split("/");

    if (path.startsWith("media/music/")) {
      const artist = parts.length > 3 ? parts[2] : "GitHub file";

      music.push({
        id: path,
        title,
        artist,
        src
      });
    } else if (path.startsWith("media/audiobooks/")) {
      const bookTitle = parts[2] || "Unnamed Audiobook";

      if (!bookMap.has(bookTitle)) {
        bookMap.set(bookTitle, {
          id: `book:${bookTitle}`,
          title: bookTitle,
          author: "GitHub audiobook",
          chapters: []
        });
      }

      bookMap.get(bookTitle).chapters.push({
        title,
        src,
        sortPath: path
      });
    }
  }

  for (const book of bookMap.values()) {
    book.chapters.sort((a, b) => {
      return a.sortPath.localeCompare(b.sortPath, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  return {
    music,
    audiobooks: Array.from(bookMap.values())
  };
}

function rawUrl(owner, repo, branch, path) {
  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return (
    `https://raw.githubusercontent.com/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/` +
    `${encodeURIComponent(branch)}/` +
    encodedPath
  );
}

function fileNameToTitle(path) {
  const fileName = path.split("/").pop();
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");

  return withoutExtension.replace(/[-_]+/g, " ").trim() || "Untitled";
}

function renderMusic() {
  musicList.innerHTML = "";

  if (!library.music.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "No music loaded yet. Upload MP3 files to media/music/ and click Load.";
    musicList.appendChild(li);
    return;
  }

  library.music.forEach((track, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");

    button.className = "track-button";
    button.textContent = `${track.title || "Untitled"} — ${
      track.artist || "Unknown artist"
    }`;

    button.addEventListener("click", () => {
      playMusic(index);
    });

    li.appendChild(button);
    musicList.appendChild(li);
  });
}

function renderAudiobooks() {
  booksEl.innerHTML = "";

  if (!library.audiobooks.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      "No audiobooks loaded yet. Upload chapters to media/audiobooks/Book Name/ and click Load.";
    booksEl.appendChild(p);
    return;
  }

  library.audiobooks.forEach((book) => {
    const bookSection = document.createElement("section");
    bookSection.className = "book";

    const title = document.createElement("h3");
    title.textContent = book.title || "Untitled audiobook";

    const author = document.createElement("div");
    author.className = "book-author";
    author.textContent = book.author || "Unknown author";

    const chapterList = document.createElement("ol");

    const chapters = Array.isArray(book.chapters) ? book.chapters : [];

    chapters.forEach((chapter, chapterIndex) => {
      const li = document.createElement("li");
      const button = document.createElement("button");

      button.className = "chapter-button";
      button.textContent = chapter.title || `Chapter ${chapterIndex + 1}`;

      button.addEventListener("click", () => {
        playChapter(book.id, chapterIndex);
      });

      li.appendChild(button);
      chapterList.appendChild(li);
    });

    bookSection.appendChild(title);
    bookSection.appendChild(author);
    bookSection.appendChild(chapterList);

    booksEl.appendChild(bookSection);
  });
}

function playMusic(index) {
  const track = library.music[index];

  if (!track || !track.src) {
    nowPlaying.textContent = "Missing music file.";
    return;
  }

  current = {
    type: "music",
    id: `music:${track.id || track.src}`,
    index
  };

  startAudio(
    track.src,
    `${track.title || "Untitled"} — ${track.artist || "Unknown artist"}`
  );
}

function playChapter(bookId, chapterIndex) {
  const book = library.audiobooks.find((b) => b.id === bookId);

  if (!book || !Array.isArray(book.chapters)) {
    nowPlaying.textContent = "Missing audiobook.";
    return;
  }

  const chapter = book.chapters[chapterIndex];

  if (!chapter || !chapter.src) {
    nowPlaying.textContent = "Missing chapter file.";
    return;
  }

  current = {
    type: "audiobook",
    bookId,
    chapterIndex,
    id: `book:${bookId}:${chapterIndex}`
  };

  startAudio(
    chapter.src,
    `${book.title || "Untitled"} — ${
      chapter.title || `Chapter ${chapterIndex + 1}`
    }`
  );
}

function startAudio(src, label) {
  if (!src) {
    nowPlaying.textContent = "Missing audio file.";
    return;
  }

  player.src = src;
  nowPlaying.textContent = label;

  const storageKey = "position:" + current.id;
  const savedTime = Number(localStorage.getItem(storageKey) || 0);

  player.onloadedmetadata = () => {
    player.onloadedmetadata = null;

    if (
      savedTime > 0 &&
      Number.isFinite(player.duration) &&
      savedTime < player.duration - 10
    ) {
      player.currentTime = savedTime;
    }

    player.play().catch((error) => {
      console.warn("Playback failed:", error);
    });
  };

  player.onerror = () => {
    player.onerror = null;
    nowPlaying.textContent =
      "Could not load audio file. Check that the file exists and is public.";
  };

  player.load();
}

player.addEventListener("timeupdate", () => {
  if (!current) return;

  const now = Date.now();

  if (now - lastSaveTime > 5000) {
    localStorage.setItem("position:" + current.id, String(player.currentTime));
    lastSaveTime = now;
  }
});

player.addEventListener("pause", () => {
  if (!current) return;
  localStorage.setItem("position:" + current.id, String(player.currentTime));
});

player.addEventListener("ended", () => {
  if (!current) return;

  localStorage.setItem("position:" + current.id, String(player.currentTime));

  if (current.type === "audiobook") {
    playNextChapter();
  }
});

function playNextChapter() {
  const book = library.audiobooks.find((b) => b.id === current.bookId);

  if (!book || !Array.isArray(book.chapters)) return;

  const nextIndex = current.chapterIndex + 1;

  if (nextIndex < book.chapters.length) {
    playChapter(current.bookId, nextIndex);
  }
}
