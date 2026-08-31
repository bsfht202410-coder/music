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
const booksEl = document.getElementById("books");

const ownerInput = document.getElementById("owner");
const repoInput = document.getElementById("repo");
const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");

let books = [];
let current = null;
let lastSaveTime = 0;

loadBtn.addEventListener("click", loadAll);

loadSettings();
renderBooks();

function loadSettings() {
  try {
    const saved = localStorage.getItem("audiobook-loader-settings");

    if (saved) {
      const settings = JSON.parse(saved);
      ownerInput.value = settings.owner || "";
      repoInput.value = settings.repo || "";
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
  localStorage.setItem(
    "audiobook-loader-settings",
    JSON.stringify({
      owner: ownerInput.value.trim(),
      repo: repoInput.value.trim()
    })
  );
}

async function loadAll() {
  const owner = ownerInput.value.trim();
  const repo = repoInput.value.trim();

  if (!owner || !repo) {
    statusEl.textContent = "Enter your GitHub username and repository name.";
    return;
  }

  saveSettings();
  statusEl.textContent = "Loading releases from GitHub...";

  try {
    const releases = await fetchReleases(owner, repo);

    books = buildBooks(releases);
    renderBooks();

    if (!releases.length) {
      statusEl.textContent =
        "No releases found. Create one release per audiobook.";
    } else if (!books.length) {
      statusEl.textContent =
        "No releases with audio assets found. Upload MP3 files as release assets.";
    } else {
      statusEl.textContent = `Loaded ${books.length} audiobook(s).`;
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent = error.message;

    books = [];
    renderBooks();
  }
}

async function fetchReleases(owner, repo) {
  const apiUrl =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/releases?per_page=100`;

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Repo not found or private. The repository must be public for this free version."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "GitHub API rate limit or permission error. Wait a little and try again."
      );
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
          : cleanName(release.tag_name || "Untitled"),
      chapters: assets.map((asset) => ({
        id: asset.id,
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

function renderBooks() {
  booksEl.innerHTML = "";

  if (!books.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      "No audiobooks loaded yet. Create one release per book and upload chapter MP3s as assets.";
    booksEl.appendChild(p);
    return;
  }

  books.forEach((book) => {
    const section = document.createElement("section");
    section.className = "book";

    const title = document.createElement("h3");
    title.textContent = book.title;

    const count = document.createElement("div");
    count.className = "book-author";
    count.textContent = `${book.chapters.length} chapters`;

    const chapterList = document.createElement("ol");

    book.chapters.forEach((chapter, chapterIndex) => {
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

    section.appendChild(title);
    section.appendChild(count);
    section.appendChild(chapterList);

    booksEl.appendChild(section);
  });
}

function playChapter(bookId, chapterIndex) {
  const book = books.find((b) => b.id === bookId);

  if (!book) return;

  const chapter = book.chapters[chapterIndex];

  if (!chapter || !chapter.src) {
    nowPlaying.textContent = "Missing chapter file.";
    return;
  }

  current = {
    bookId,
    chapterIndex,
    id: `pos:${bookId}:${chapter.id || chapter.src}`
  };

  startAudio(chapter.src, `${book.title} — ${chapter.title}`);
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
      "Could not load audio file. Check that the release is public and the asset exists.";
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

  playNextChapter();
});

function playNextChapter() {
  const book = books.find((b) => b.id === current.bookId);

  if (!book || !Array.isArray(book.chapters)) return;

  const nextIndex = current.chapterIndex + 1;

  if (nextIndex < book.chapters.length) {
    playChapter(current.bookId, nextIndex);
  }
}
