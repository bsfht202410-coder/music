const player = document.getElementById("player");
const nowPlaying = document.getElementById("now-playing");

const musicList = document.getElementById("music-list");
const booksEl = document.getElementById("books");

const musicTab = document.getElementById("tab-music");
const booksTab = document.getElementById("tab-books");

const musicView = document.getElementById("music-view");
const booksView = document.getElementById("books-view");

let library = {
  music: [],
  audiobooks: []
};

let current = null;
let lastSaveTime = 0;

musicTab.addEventListener("click", () => showView("music"));
booksTab.addEventListener("click", () => showView("books"));

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

async function loadLibrary() {
  try {
    const res = await fetch("library.json?cache=" + Date.now(), {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error("Failed to load library.json");
    }

    const data = await res.json();

    library = {
      music: Array.isArray(data.music) ? data.music : [],
      audiobooks: Array.isArray(data.audiobooks) ? data.audiobooks : []
    };

    renderMusic();
    renderAudiobooks();
  } catch (error) {
    console.error(error);

    musicList.innerHTML = `
      <li class="error">
        Could not load library.json. Make sure it exists and contains valid JSON.
      </li>
    `;

    booksEl.innerHTML = `
      <p class="error">
        Could not load library.json. Make sure it exists and contains valid JSON.
      </p>
    `;
  }
}

function renderMusic() {
  musicList.innerHTML = "";

  if (!library.music.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "No music yet. Add MP3 files to media/music/ and update library.json.";
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
      "No audiobooks yet. Add MP3 chapters to media/audiobooks/ and update library.json.";
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

  startAudio(track.src, `${track.title || "Untitled"} — ${track.artist || "Unknown artist"}`);
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
    `${book.title || "Untitled"} — ${chapter.title || `Chapter ${chapterIndex + 1}`}`
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
    nowPlaying.textContent = "Could not load audio file. Check the path in library.json.";
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

loadLibrary();
