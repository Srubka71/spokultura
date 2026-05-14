let currentAudio = new Audio();

let currentBeat = null;
let isPlaying = false;
let currentButton = null;

let loopTarget = "off";
let loopCounter = 0;
let infoTimer = null;

let loadBeatTimer = null;
let loadBeatRequestId = 0;

let autoPitchResetEnabled = false;

// =======================
// FORMSPREE ENDPOINTS
// =======================

const BUG_FORM_ENDPOINT = "https://formspree.io/f/xaqvkkvo";
const BEAT_FORM_ENDPOINT = "https://formspree.io/f/mjglzzlg";

// =======================
// SUPABASE GLOBAL VOTING
// =======================

const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

let supabaseClient = null;

if (window.supabase) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}

// =======================
// BROWSER DETECTION
// =======================

const isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (isSafari) {
  document.documentElement.classList.add("is-safari");
}

// =======================
// UI REFERENCES
// =======================

const introScreen = document.getElementById("introScreen");
const welcomeModal = document.getElementById("welcomeModal");
const closeWelcomeBtn = document.getElementById("closeWelcomeBtn");
const dontShowWelcome = document.getElementById("dontShowWelcome");

const grid = document.getElementById("beatGrid");

const img = document.getElementById("beatImage");
const title = document.getElementById("title");
const producer = document.getElementById("producer");
const bpm = document.getElementById("bpm");
const infoText = document.getElementById("infoText");

const pitch = document.getElementById("pitch");
const pitchLabel = document.getElementById("pitchLabel");

const stopBtn = document.getElementById("stopBtn");
const restartBtn = document.getElementById("restartBtn");
const autoPitchResetBtn = document.getElementById("autoPitchResetBtn");

const rankingBtn = document.getElementById("rankingBtn");
const rankingModal = document.getElementById("rankingModal");
const closeRankingBtn = document.getElementById("closeRankingBtn");
const rankingStatus = document.getElementById("rankingStatus");
const rankingTableBody = document.getElementById("rankingTableBody");

const moreInfoBtn = document.getElementById("moreInfoBtn");

const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpBtn = document.getElementById("closeHelpBtn");

const bugBtn = document.getElementById("bugBtn");
const bugModal = document.getElementById("bugModal");
const closeBugBtn = document.getElementById("closeBugBtn");
const sendBugBtn = document.getElementById("sendBugBtn");

const submitBeatBtn = document.getElementById("submitBeatBtn");
const submitBeatModal = document.getElementById("submitBeatModal");
const closeSubmitBeatBtn = document.getElementById("closeSubmitBeatBtn");
const sendBeatBtn = document.getElementById("sendBeatBtn");

const feedbackModal = document.getElementById("feedbackModal");
const feedbackTitle = document.getElementById("feedbackTitle");
const feedbackMessage = document.getElementById("feedbackMessage");
const closeFeedbackBtn = document.getElementById("closeFeedbackBtn");

const beatBpmInput = document.getElementById("beatBpm");

const voteTotal = document.getElementById("voteTotal");
const voteDownBtn = document.getElementById("voteDownBtn");
const voteUpBtn = document.getElementById("voteUpBtn");

const skipIntroBtn = document.getElementById("skipIntroBtn");

// =======================
// INTRO + WELCOME
// =======================

let introTimer = null;
let introSkipped = false;

function showWelcomeIfNeeded() {
  const hideWelcome = localStorage.getItem("spolooperHideWelcome");

  if (hideWelcome !== "true") {
    welcomeModal.classList.remove("hidden");
  }
}

function finishIntro() {
  if (introSkipped) return;

  introSkipped = true;

  if (introTimer) {
    clearTimeout(introTimer);
  }

  introScreen.classList.add("hidden");

  showWelcomeIfNeeded();
}

window.addEventListener("load", () => {
  introTimer = setTimeout(() => {
    finishIntro();
  }, 6000);

  updateVotePanel();
});

introScreen.addEventListener("click", () => {
  finishIntro();
});

skipIntroBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  finishIntro();
});

// =======================
// WELCOME MODAL
// =======================

closeWelcomeBtn.addEventListener("click", () => {
  if (dontShowWelcome.checked) {
    localStorage.setItem("spolooperHideWelcome", "true");
  }

  welcomeModal.classList.add("hidden");
});

// =======================
// HELPERS
// =======================

function setPlayingVisualState(isActive) {
  if (isActive) {
    document.body.classList.add("is-playing");
  } else {
    document.body.classList.remove("is-playing");
  }
}

function stopAudioInstance(audio) {
  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  } catch (error) {
    console.error(error);
  }
}

function stopAndResetCurrentAudio() {
  stopAudioInstance(currentAudio);
}

function cancelPendingBeatLoad() {
  if (loadBeatTimer) {
    clearTimeout(loadBeatTimer);
    loadBeatTimer = null;
  }
}

function resetPitchToZero(showMessage = false) {
  if (!pitch) return;

  pitch.value = 1;
  pitch.dispatchEvent(new Event("input"));

  if (showMessage) {
    updateInfoBar("Pitch reset");
  }
}

function updateAutoPitchButtonState() {
  if (!autoPitchResetBtn) return;

  autoPitchResetBtn.classList.toggle(
    "active-auto-pitch",
    autoPitchResetEnabled
  );

  autoPitchResetBtn.setAttribute(
    "aria-pressed",
    autoPitchResetEnabled ? "true" : "false"
  );
}

function bindInfoHover(element, text) {
  if (!element) return;

  element.addEventListener("mouseenter", () => {
    updateInfoBar(text, false);
  });

  element.addEventListener("mouseleave", () => {
    clearInfoBar();
  });
}

function randomGlowColor() {
  const colors = [
    "#EAA221",
    "#dd4124",
    "#00e5ff",
    "#ff00c8",
    "#7CFF00",
    "#ffffff",
    "#8f5cff"
  ];

  return colors[Math.floor(Math.random() * colors.length)];
}

function getBeatInfo(beat) {
  if (!beat.available || !beat.file) {
    return "Coming Soon...";
  }

  return `${beat.producer} — ${beat.title} — ${beat.bpm} BPM`;
}

function clearInfoBar() {
  if (infoTimer) {
    clearTimeout(infoTimer);
  }

  if (infoText) {
    infoText.innerText = "";
  }
}

function updateInfoBar(text, autoClear = true) {
  if (!infoText) return;

  if (infoTimer) {
    clearTimeout(infoTimer);
  }

  infoText.innerText = text;

  if (autoClear) {
    infoTimer = setTimeout(() => {
      infoText.innerText = "";
    }, 4000);
  }
}

function isValidEmail(email) {
  if (!email) return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeBpmInput(value) {
  return value.replace(/\D/g, "").slice(0, 3);
}

function isValidBpm(value) {
  if (!value) return true;

  if (!/^\d{2,3}$/.test(value)) {
    return false;
  }

  const bpmNumber = parseInt(value, 10);

  return bpmNumber >= 20 && bpmNumber <= 240;
}

function showFeedbackModal(titleText, messageText) {
  if (!feedbackModal || !feedbackTitle || !feedbackMessage) {
    updateInfoBar(messageText);
    return;
  }

  feedbackTitle.innerText = titleText;
  feedbackMessage.innerText = messageText;

  feedbackModal.classList.remove("hidden");
}

function closeFeedbackModal() {
  if (feedbackModal) {
    feedbackModal.classList.add("hidden");
  }
}

function updateBpmDisplay() {
  if (!currentBeat || !currentBeat.bpm) {
    bpm.innerText = "BPM: --";
    return;
  }

  const rate = parseFloat(pitch.value);
  const calculatedBpm = currentBeat.bpm * rate;

  bpm.innerText = `BPM: ${calculatedBpm.toFixed(2)}`;
}

function resetActiveButtons() {
  document.querySelectorAll(".beat-tile").forEach(button => {
    button.classList.remove("active");
  });
}

function getAvailableBeats() {
  return allBeats.filter(beat => beat.available && beat.file);
}

function findButtonByBeatId(id) {
  return document.querySelector(`.beat-tile[data-id="${id}"]`);
}

function stopPlaybackCompletely() {
  loadBeatRequestId++;

  cancelPendingBeatLoad();
  stopAndResetCurrentAudio();

  isPlaying = false;
  stopBtn.innerText = "START";

  loopCounter = 0;

  setPlayingVisualState(false);
  updateInfoBar("Koniec playlisty");
}

function clickLoopButton(loopValue) {
  const button = document.querySelector(`.loop-btn[data-loop="${loopValue}"]`);

  if (button) {
    button.click();
  }
}

function isTypingInForm(event) {
  const tag = event.target.tagName.toLowerCase();

  return (
    tag === "input" ||
    tag === "textarea" ||
    event.target.isContentEditable
  );
}

function isModalOpen() {
  const openedModal = document.querySelector(
    ".community-modal:not(.hidden), .help-modal:not(.hidden), .welcome-modal:not(.hidden)"
  );

  return Boolean(openedModal);
}

function closeAllCommunityModals() {
  document.querySelectorAll(".community-modal").forEach(modal => {
    modal.classList.add("hidden");
  });
}

function clearBugForm() {
  const bugName = document.getElementById("bugName");
  const bugEmail = document.getElementById("bugEmail");
  const bugMessage = document.getElementById("bugMessage");

  if (bugName) bugName.value = "";
  if (bugEmail) bugEmail.value = "";
  if (bugMessage) bugMessage.value = "";
}

function clearBeatForm() {
  const beatNick = document.getElementById("beatNick");
  const beatEmail = document.getElementById("beatEmail");
  const beatTitle = document.getElementById("beatTitle");
  const beatBpm = document.getElementById("beatBpm");
  const beatLink = document.getElementById("beatLink");
  const beatNotes = document.getElementById("beatNotes");
  const beatRights = document.getElementById("beatRights");

  if (beatNick) beatNick.value = "";
  if (beatEmail) beatEmail.value = "";
  if (beatTitle) beatTitle.value = "";
  if (beatBpm) beatBpm.value = "";
  if (beatLink) beatLink.value = "";
  if (beatNotes) beatNotes.value = "";
  if (beatRights) beatRights.checked = false;
}

async function sendFormspreeForm(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Formspree request failed");
  }

  return response.json();
}

// =======================
// BPM INPUT GUARD
// =======================

if (beatBpmInput) {
  beatBpmInput.addEventListener("input", () => {
    beatBpmInput.value = sanitizeBpmInput(beatBpmInput.value);
  });

  beatBpmInput.addEventListener("blur", () => {
    const bpmValue = beatBpmInput.value.trim();

    if (bpmValue && !isValidBpm(bpmValue)) {
      showFeedbackModal("BŁĄD", "Wpisz prawidłowe BPM.");
    }
  });
}

// =======================
// TOP BUTTON INFO HOVERS
// =======================

bindInfoHover(
  rankingBtn,
  "Pokaż ranking beatów według oceny"
);

bindInfoHover(
  moreInfoBtn,
  "Otwórz opis projektu, roadmapę i changelog"
);

bindInfoHover(
  submitBeatBtn,
  "Wyślij swój beat do Looper Monthly Pack"
);

bindInfoHover(
  bugBtn,
  "Zgłoś błąd albo problem techniczny"
);

bindInfoHover(
  helpBtn,
  "Otwórz pomoc i skróty Loopera"
);

// =======================
// AUTO 0% PITCH RESET
// =======================

if (autoPitchResetBtn) {
  autoPitchResetBtn.addEventListener("mouseenter", () => {
    updateInfoBar("Always 0% pitch after beat change", false);
  });

  autoPitchResetBtn.addEventListener("mouseleave", () => {
    clearInfoBar();
  });

  autoPitchResetBtn.addEventListener("click", () => {
    autoPitchResetEnabled = !autoPitchResetEnabled;

    updateAutoPitchButtonState();

    if (autoPitchResetEnabled) {
      updateInfoBar("AUTO 0% ON");
    } else {
      updateInfoBar("AUTO 0% OFF");
    }
  });

  updateAutoPitchButtonState();
}

// =======================
// GLOBAL VOTING FOUNDATION
// =======================

function getVoteKey(beatId) {
  return `spolooperVote_${beatId}`;
}

function getVoterId() {
  const key = "spolooperVoterId";

  let voterId = localStorage.getItem(key);

  if (!voterId) {
    if (window.crypto && crypto.randomUUID) {
      voterId = crypto.randomUUID();
    } else {
      voterId =
        "voter_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2);
    }

    localStorage.setItem(key, voterId);
  }

  return voterId;
}

function getLocalVote(beatId) {
  const savedVote = localStorage.getItem(getVoteKey(beatId));
  const voteValue = parseInt(savedVote, 10);

  if (voteValue === 1 || voteValue === -1) {
    return voteValue;
  }

  return 0;
}

function saveLocalVote(beatId, value) {
  if (value === 0) {
    localStorage.removeItem(getVoteKey(beatId));
    return;
  }

  localStorage.setItem(getVoteKey(beatId), String(value));
}

async function getOnlineUserVote(beatId) {
  if (!supabaseClient) {
    return getLocalVote(beatId);
  }

  const voterId = getVoterId();

  const { data, error } = await supabaseClient
    .from("looper_votes")
    .select("vote_value")
    .eq("beat_id", beatId)
    .eq("voter_id", voterId)
    .maybeSingle();

  if (error) {
    console.error(error);
    return getLocalVote(beatId);
  }

  if (!data || typeof data.vote_value !== "number") {
    return 0;
  }

  return data.vote_value;
}

async function getDisplayedVoteTotal(beatId) {
  if (!supabaseClient) {
    return getLocalVote(beatId);
  }

  const { data, error } = await supabaseClient
    .from("looper_votes")
    .select("vote_value")
    .eq("beat_id", beatId);

  if (error) {
    console.error(error);
    return getLocalVote(beatId);
  }

  if (!Array.isArray(data)) {
    return 0;
  }

  return data.reduce((sum, row) => {
    const value = parseInt(row.vote_value, 10);

    if (value === 1 || value === -1) {
      return sum + value;
    }

    return sum;
  }, 0);
}

async function submitVote(beatId, value) {
  if (!supabaseClient) {
    saveLocalVote(beatId, value);

    return {
      beatId: beatId,
      value: value,
      total: await getDisplayedVoteTotal(beatId)
    };
  }

  const voterId = getVoterId();

  if (value === 0) {
    const { error } = await supabaseClient
      .from("looper_votes")
      .delete()
      .eq("beat_id", beatId)
      .eq("voter_id", voterId);

    if (error) {
      throw error;
    }

    saveLocalVote(beatId, 0);

    return {
      beatId: beatId,
      value: 0,
      total: await getDisplayedVoteTotal(beatId)
    };
  }

  const { error } = await supabaseClient
    .from("looper_votes")
    .upsert(
      {
        beat_id: beatId,
        voter_id: voterId,
        vote_value: value,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "beat_id,voter_id"
      }
    );

  if (error) {
    throw error;
  }

  saveLocalVote(beatId, value);

  return {
    beatId: beatId,
    value: value,
    total: await getDisplayedVoteTotal(beatId)
  };
}

async function updateVotePanel() {
  if (!voteTotal || !voteDownBtn || !voteUpBtn) return;

  if (!currentBeat || !currentBeat.available || !currentBeat.file) {
    voteTotal.innerText = "0";

    voteDownBtn.classList.remove("active-vote");
    voteUpBtn.classList.remove("active-vote");

    voteDownBtn.setAttribute("aria-pressed", "false");
    voteUpBtn.setAttribute("aria-pressed", "false");

    return;
  }

  voteTotal.innerText = "...";

  const beatId = currentBeat.id;
  const voteValue = await getOnlineUserVote(beatId);
  const displayedTotal = await getDisplayedVoteTotal(beatId);

  if (!currentBeat || currentBeat.id !== beatId) {
    return;
  }

  voteTotal.innerText = String(displayedTotal);

  voteDownBtn.classList.toggle("active-vote", voteValue === -1);
  voteUpBtn.classList.toggle("active-vote", voteValue === 1);

  voteDownBtn.setAttribute("aria-pressed", voteValue === -1 ? "true" : "false");
  voteUpBtn.setAttribute("aria-pressed", voteValue === 1 ? "true" : "false");

  saveLocalVote(beatId, voteValue);
}

async function handleVote(selectedValue) {
  if (!currentBeat || !currentBeat.available || !currentBeat.file) {
    updateInfoBar("Najpierw wybierz beat");
    return;
  }

  voteDownBtn.disabled = true;
  voteUpBtn.disabled = true;

  try {
    const oldValue = await getOnlineUserVote(currentBeat.id);

    let newValue = selectedValue;

    if (oldValue === selectedValue) {
      newValue = 0;
    }

    const voteResult = await submitVote(currentBeat.id, newValue);

    await updateVotePanel();

    if (voteResult.value === 1) {
      updateInfoBar("Głos online: łapka w górę");
    } else if (voteResult.value === -1) {
      updateInfoBar("Głos online: łapka w dół");
    } else {
      updateInfoBar("Głos online cofnięty");
    }
  } catch (error) {
    console.error(error);
    showFeedbackModal("BŁĄD", "Nie udało się zapisać głosu online. Spróbuj ponownie.");
  } finally {
    voteDownBtn.disabled = false;
    voteUpBtn.disabled = false;
  }
}

if (voteUpBtn) {
  voteUpBtn.addEventListener("mouseenter", () => {
    updateInfoBar("Zajebisty beat!", false);
  });

  voteUpBtn.addEventListener("mouseleave", () => {
    clearInfoBar();
  });

  voteUpBtn.addEventListener("click", () => {
    handleVote(1);
  });
}

if (voteDownBtn) {
  voteDownBtn.addEventListener("mouseenter", () => {
    updateInfoBar("Nie siedzi mi..", false);
  });

  voteDownBtn.addEventListener("mouseleave", () => {
    clearInfoBar();
  });

  voteDownBtn.addEventListener("click", () => {
    handleVote(-1);
  });
}

// =======================
// BUILD ALL SLOTS
// =======================

const totalSlots =
  typeof TOTAL_SLOTS !== "undefined"
    ? TOTAL_SLOTS
    : 36;

const allBeats = Array.from({ length: totalSlots }, (_, i) => {
  const id = i + 1;

  const existingBeat = beats.find(beat => beat.id === id);

  if (existingBeat) {
    return existingBeat;
  }

  return {
    id: id,
    title: `Beat ${id}`,
    producer: "Coming Soon",
    bpm: null,
    file: "",
    image: `assets/images/beat${id}.jpg`,
    available: false
  };
});

// =======================
// RANKING
// =======================

function setRankingStatus(message) {
  if (rankingStatus) {
    rankingStatus.innerText = message;
  }
}

function clearRankingTable() {
  if (!rankingTableBody) return;

  rankingTableBody.innerHTML = "";
}

function appendRankingMessage(message) {
  if (!rankingTableBody) return;

  clearRankingTable();

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = 4;
  cell.innerText = message;

  row.appendChild(cell);
  rankingTableBody.appendChild(row);
}

function getScoreClass(score) {
  if (score > 0) {
    return "ranking-score-positive";
  }

  if (score < 0) {
    return "ranking-score-negative";
  }

  return "ranking-score-zero";
}

function formatScore(score) {
  if (score > 0) {
    return `+${score}`;
  }

  return String(score);
}

function renderRankingRows(rows) {
  if (!rankingTableBody) return;

  clearRankingTable();

  if (!rows.length) {
    appendRankingMessage("Brak beatów do wyświetlenia.");
    return;
  }

  rows.forEach((item) => {
    const row = document.createElement("tr");

    const numberCell = document.createElement("td");
    const producerCell = document.createElement("td");
    const titleCell = document.createElement("td");
    const scoreCell = document.createElement("td");

    numberCell.innerText = String(item.id);
    producerCell.innerText = item.producer || "Unknown";
    titleCell.innerText = item.title || `Beat ${item.id}`;

    scoreCell.innerText = formatScore(item.score);
    scoreCell.classList.add(getScoreClass(item.score));

    row.appendChild(numberCell);
    row.appendChild(producerCell);
    row.appendChild(titleCell);
    row.appendChild(scoreCell);

    rankingTableBody.appendChild(row);
  });
}

async function buildRankingRows() {
  const availableBeats = getAvailableBeats();

  const scoreMap = new Map();

  availableBeats.forEach((beat) => {
    scoreMap.set(String(beat.id), 0);
  });

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from("looper_votes")
      .select("beat_id, vote_value");

    if (error) {
      throw error;
    }

    if (Array.isArray(data)) {
      data.forEach((row) => {
        const beatId = String(row.beat_id);
        const value = parseInt(row.vote_value, 10);

        if (!scoreMap.has(beatId)) {
          return;
        }

        if (value === 1 || value === -1) {
          scoreMap.set(
            beatId,
            scoreMap.get(beatId) + value
          );
        }
      });
    }
  }

  return availableBeats
    .map((beat) => {
      return {
        id: beat.id,
        producer: beat.producer,
        title: beat.title,
        score: scoreMap.get(String(beat.id)) || 0
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.id - b.id;
    });
}

async function loadRanking() {
  if (!rankingTableBody) return;

  setRankingStatus("Ładowanie rankingu...");
  appendRankingMessage("Ładowanie rankingu...");

  try {
    const rows = await buildRankingRows();

    renderRankingRows(rows);

    if (!supabaseClient) {
      setRankingStatus("Supabase niedostępny — pokazuję ranking lokalny bez głosów online.");
      return;
    }

    setRankingStatus(`Załadowano ${rows.length} beatów.`);
  } catch (error) {
    console.error(error);

    setRankingStatus("Nie udało się pobrać rankingu.");
    appendRankingMessage("Błąd pobierania rankingu. Spróbuj ponownie później.");
  }
}

function openRankingModal() {
  if (!rankingModal) return;

  rankingModal.classList.remove("hidden");
  loadRanking();
}

function closeRankingModal() {
  if (rankingModal) {
    rankingModal.classList.add("hidden");
  }
}

if (rankingBtn) {
  rankingBtn.addEventListener("click", () => {
    openRankingModal();
  });
}

if (closeRankingBtn) {
  closeRankingBtn.addEventListener("click", () => {
    closeRankingModal();
  });
}

if (rankingModal) {
  rankingModal.addEventListener("click", (event) => {
    if (event.target === rankingModal) {
      closeRankingModal();
    }
  });
}

// =======================
// CREATE BEAT TILES
// =======================

allBeats.forEach((beat) => {
  const btn = document.createElement("button");

  btn.classList.add("beat-tile");
  btn.dataset.id = beat.id;

  if (beat.available && beat.file) {
    btn.classList.add("available");
  } else {
    btn.classList.add("unavailable");
  }

  btn.style.backgroundImage = `url("${beat.image}")`;

  btn.style.setProperty(
    "--glow-color",
    randomGlowColor()
  );

  btn.innerHTML = `<span>${beat.id}</span>`;

  btn.addEventListener("mouseenter", () => {
    btn.style.setProperty(
      "--glow-color",
      randomGlowColor()
    );

    updateInfoBar(getBeatInfo(beat), false);
  });

  btn.addEventListener("mouseleave", () => {
    clearInfoBar();
  });

  btn.addEventListener("click", () => {
    if (!beat.available || !beat.file) {
      updateInfoBar("Coming Soon...");
      return;
    }

    loadBeat(beat, btn);
  });

  grid.appendChild(btn);
});

// =======================
// LOAD BEAT
// =======================

function loadBeat(beat, btn) {
  loadBeatRequestId++;

  const requestId = loadBeatRequestId;

  cancelPendingBeatLoad();

  resetActiveButtons();

  stopAndResetCurrentAudio();

  loopCounter = 0;

  currentBeat = beat;
  currentButton = btn;

  if (autoPitchResetEnabled) {
    resetPitchToZero(false);
  }

  isPlaying = false;
  stopBtn.innerText = "START";

  setPlayingVisualState(false);

  clearInfoBar();
  updateVotePanel();

  img.classList.add("changing");

  const coverPanel = document.querySelector(".cover-panel");
  const infoBar = document.querySelector(".info-bar");

  loadBeatTimer = setTimeout(() => {
    if (requestId !== loadBeatRequestId) {
      return;
    }

    const nextAudio = new Audio(beat.file);

    currentAudio = nextAudio;

    currentAudio.loop = false;
    currentAudio.playbackRate = parseFloat(pitch.value);

    currentAudio.addEventListener("ended", () => {
      if (currentAudio !== nextAudio) {
        return;
      }

      handleBeatEnded();
    });

    const playPromise = currentAudio.play();

    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          if (requestId !== loadBeatRequestId) {
            stopAudioInstance(nextAudio);
            return;
          }

          isPlaying = true;
          stopBtn.innerText = "STOP";

          setPlayingVisualState(true);
        })
        .catch((error) => {
          console.error(error);

          if (requestId === loadBeatRequestId) {
            isPlaying = false;
            stopBtn.innerText = "START";

            setPlayingVisualState(false);
            updateInfoBar("Nie udało się uruchomić beatu");
          }
        });
    } else {
      isPlaying = true;
      stopBtn.innerText = "STOP";

      setPlayingVisualState(true);
    }

    if (img) {
      img.src = beat.image || "";
    }

    if (title) {
      title.innerText = beat.title || "";
    }

    if (producer) {
      producer.innerText = beat.producer || "";
    }

    updateBpmDisplay();
    updateVotePanel();

    btn.classList.add("active");

    setTimeout(() => {
      if (requestId === loadBeatRequestId && img) {
        img.classList.remove("changing");
      }
    }, 60);

    if (coverPanel) {
      coverPanel.classList.remove("active-cover");
    }

    if (infoBar) {
      infoBar.classList.remove("active-info");
    }

    if (coverPanel) {
      void coverPanel.offsetWidth;
      coverPanel.classList.add("active-cover");
    }

    if (infoBar) {
      void infoBar.offsetWidth;
      infoBar.classList.add("active-info");
    }

    loadBeatTimer = null;
  }, 220);
}

// =======================
// LOOP ENGINE
// =======================

function handleBeatEnded() {
  if (!currentAudio || !currentAudio.src) return;

  if (loopTarget === "off") {
    currentAudio.currentTime = 0;
    currentAudio.play();
    return;
  }

  loopCounter++;

  if (loopCounter < loopTarget) {
    currentAudio.currentTime = 0;
    currentAudio.play();
    return;
  }

  playNextAvailableBeat();
}

function playNextAvailableBeat() {
  const availableBeats = getAvailableBeats();

  if (!currentBeat) return;

  const currentIndex = availableBeats.findIndex(
    beat => beat.id === currentBeat.id
  );

  const nextBeat = availableBeats[currentIndex + 1];

  if (!nextBeat) {
    stopPlaybackCompletely();
    return;
  }

  const nextButton = findButtonByBeatId(nextBeat.id);

  if (nextButton) {
    loadBeat(nextBeat, nextButton);
  }
}

// =======================
// LOOP BUTTONS
// =======================

document.querySelectorAll(".loop-btn").forEach(button => {
  if (button.id === "autoPitchResetBtn") {
    return;
  }

  button.addEventListener("click", () => {
    document.querySelectorAll(".loop-btn").forEach(btn => {
      if (btn.id !== "autoPitchResetBtn") {
        btn.classList.remove("active-loop");
      }
    });

    button.classList.add("active-loop");

    if (button.dataset.loop === "off") {
      loopTarget = "off";
      updateInfoBar("INFINITY LOOP");
    } else {
      loopTarget = parseInt(button.dataset.loop, 10);
      updateInfoBar(`Loop ${loopTarget}x`);
    }

    loopCounter = 0;
  });
});

// =======================
// STOP / START
// =======================

stopBtn.addEventListener("click", () => {
  if (!currentAudio.src) return;

  if (isPlaying) {
    currentAudio.pause();

    isPlaying = false;
    stopBtn.innerText = "START";

    setPlayingVisualState(false);
    updateInfoBar("STOP");
  } else {
    currentAudio.play();

    isPlaying = true;
    stopBtn.innerText = "STOP";

    setPlayingVisualState(true);
    updateInfoBar("START");
  }
});

// =======================
// RESTART
// =======================

restartBtn.addEventListener("click", () => {
  if (!currentAudio.src) return;

  loopCounter = 0;

  currentAudio.currentTime = 0;
  currentAudio.play();

  isPlaying = true;
  stopBtn.innerText = "STOP";

  setPlayingVisualState(true);
  updateInfoBar("RESTART");
});

// =======================
// PITCH
// =======================

pitch.addEventListener("input", () => {
  const value = parseFloat(pitch.value);

  if (currentAudio) {
    currentAudio.playbackRate = value;
  }

  const percent = ((value - 1) * 10).toFixed(2);

  if (pitchLabel) {
    pitchLabel.innerText = `Pitch: ${percent}%`;
  }

  updateBpmDisplay();
});

function setPitch(delta) {
  let value = parseFloat(pitch.value) + delta;

  value = Math.max(
    0.80,
    Math.min(1.20, value)
  );

  pitch.value = value;

  pitch.dispatchEvent(new Event("input"));
}

document.getElementById("pitchPlus1").onclick = () => setPitch(0.10);
document.getElementById("pitchMinus1").onclick = () => setPitch(-0.10);

document.getElementById("pitchPlus025").onclick = () => setPitch(0.025);
document.getElementById("pitchMinus025").onclick = () => setPitch(-0.025);

document.getElementById("pitchReset").onclick = () => {
  resetPitchToZero(true);
};

// =======================
// HELP MODAL
// =======================

helpBtn.addEventListener("click", () => {
  helpModal.classList.remove("hidden");
});

closeHelpBtn.addEventListener("click", () => {
  helpModal.classList.add("hidden");
});

helpModal.addEventListener("click", (event) => {
  if (event.target === helpModal) {
    helpModal.classList.add("hidden");
  }
});

// =======================
// FEEDBACK MODAL
// =======================

if (closeFeedbackBtn) {
  closeFeedbackBtn.addEventListener("click", () => {
    closeFeedbackModal();
  });
}

if (feedbackModal) {
  feedbackModal.addEventListener("click", (event) => {
    if (event.target === feedbackModal) {
      closeFeedbackModal();
    }
  });
}

// =======================
// BUG MODAL — FORMSPREE
// =======================

bugBtn.addEventListener("click", () => {
  if (bugModal) {
    bugModal.classList.remove("hidden");
  }
});

if (closeBugBtn && bugModal) {
  closeBugBtn.addEventListener("click", () => {
    bugModal.classList.add("hidden");
  });
}

if (bugModal) {
  bugModal.addEventListener("click", (event) => {
    if (event.target === bugModal) {
      bugModal.classList.add("hidden");
    }
  });
}

if (sendBugBtn) {
  sendBugBtn.addEventListener("click", async () => {
    const name = document.getElementById("bugName").value.trim();
    const email = document.getElementById("bugEmail").value.trim();
    const message = document.getElementById("bugMessage").value.trim();

    if (!email || !isValidEmail(email)) {
      showFeedbackModal("BŁĄD", "Podaj prawidłowy adres e-mail.");
      return;
    }

    if (!message) {
      showFeedbackModal("BŁĄD", "Opisz błąd przed wysłaniem zgłoszenia.");
      return;
    }

    const originalText = sendBugBtn.innerText;

    try {
      sendBugBtn.disabled = true;
      sendBugBtn.innerText = "WYSYŁAM...";

      await sendFormspreeForm(BUG_FORM_ENDPOINT, {
        type: "BUG REPORT",
        name: name,
        email: email,
        message: message,
        page: window.location.href,
        userAgent: navigator.userAgent,
        submittedAt: new Date().toISOString()
      });

      clearBugForm();

      if (bugModal) {
        bugModal.classList.add("hidden");
      }

      showFeedbackModal("WYSŁANO", "Wysłano buga — dzięki ;)");
    } catch (error) {
      console.error(error);
      showFeedbackModal("BŁĄD", "Błąd wysyłki — spróbuj ponownie.");
    } finally {
      sendBugBtn.disabled = false;
      sendBugBtn.innerText = originalText;
    }
  });
}

// =======================
// SUBMIT BEAT MODAL — FORMSPREE
// =======================

if (submitBeatBtn && submitBeatModal) {
  submitBeatBtn.addEventListener("click", () => {
    submitBeatModal.classList.remove("hidden");
  });
}

if (closeSubmitBeatBtn && submitBeatModal) {
  closeSubmitBeatBtn.addEventListener("click", () => {
    submitBeatModal.classList.add("hidden");
  });
}

if (submitBeatModal) {
  submitBeatModal.addEventListener("click", (event) => {
    if (event.target === submitBeatModal) {
      submitBeatModal.classList.add("hidden");
    }
  });
}

if (sendBeatBtn) {
  sendBeatBtn.addEventListener("click", async () => {
    const nick = document.getElementById("beatNick").value.trim();
    const email = document.getElementById("beatEmail").value.trim();
    const beatTitle = document.getElementById("beatTitle").value.trim();
    const bpmValue = document.getElementById("beatBpm").value.trim();
    const link = document.getElementById("beatLink").value.trim();
    const notes = document.getElementById("beatNotes").value.trim();
    const rights = document.getElementById("beatRights").checked;

    if (!nick) {
      showFeedbackModal("BŁĄD", "Podaj ksywę producenta.");
      return;
    }

    if (!email || !isValidEmail(email)) {
      showFeedbackModal("BŁĄD", "Podaj prawidłowy adres e-mail.");
      return;
    }

    if (!beatTitle) {
      showFeedbackModal("BŁĄD", "Podaj tytuł beatu.");
      return;
    }

    if (!link) {
      showFeedbackModal("BŁĄD", "Podaj link do beatu.");
      return;
    }

    if (!isValidBpm(bpmValue)) {
      showFeedbackModal("BŁĄD", "Wpisz prawidłowe BPM.");
      return;
    }

    if (!rights) {
      showFeedbackModal("BŁĄD", "Musisz potwierdzić, że masz prawa do beatu i sampli.");
      return;
    }

    const originalText = sendBeatBtn.innerText;

    try {
      sendBeatBtn.disabled = true;
      sendBeatBtn.innerText = "WYSYŁAM...";

      await sendFormspreeForm(BEAT_FORM_ENDPOINT, {
        type: "BEAT SUBMISSION",
        producerNick: nick,
        email: email,
        beatTitle: beatTitle,
        bpm: bpmValue,
        beatLink: link,
        notes: notes,
        rightsConfirmed: rights,
        page: window.location.href,
        userAgent: navigator.userAgent,
        submittedAt: new Date().toISOString()
      });

      clearBeatForm();

      if (submitBeatModal) {
        submitBeatModal.classList.add("hidden");
      }

      showFeedbackModal("WYSŁANO", "Wysłano beat — odezwę się na maila podanego w zgłoszeniu.");
    } catch (error) {
      console.error(error);
      showFeedbackModal("BŁĄD", "Błąd wysyłki — spróbuj ponownie.");
    } finally {
      sendBeatBtn.disabled = false;
      sendBeatBtn.innerText = originalText;
    }
  });
}

// =======================
// KEYBOARD SHORTCUTS
// =======================

document.addEventListener("keydown", (event) => {
  if (isTypingInForm(event)) return;

  if (isModalOpen()) {
    if (event.key === "Escape") {
      closeAllCommunityModals();

      if (helpModal) {
        helpModal.classList.add("hidden");
      }
    }

    return;
  }

  const key = event.key.toLowerCase();

  if (event.code === "Space") {
    event.preventDefault();
    stopBtn.click();
  }

  if (key === "r") {
    event.preventDefault();
    restartBtn.click();
  }

  if (event.code === "Backquote") {
    event.preventDefault();
    clickLoopButton("off");
  }

  if (key === "1") {
    event.preventDefault();
    clickLoopButton("1");
  }

  if (key === "2") {
    event.preventDefault();
    clickLoopButton("2");
  }

  if (key === "3") {
    event.preventDefault();
    clickLoopButton("4");
  }

  if (key === "4") {
    event.preventDefault();
    clickLoopButton("6");
  }

  if (key === "5") {
    event.preventDefault();
    clickLoopButton("8");
  }

  if (event.code === "ArrowRight") {
    event.preventDefault();
    setPitch(0.025);
    updateInfoBar("Pitch +0.25");
  }

  if (event.code === "ArrowLeft") {
    event.preventDefault();
    setPitch(-0.025);
    updateInfoBar("Pitch -0.25");
  }
});

// =======================
// PARALLAX / DEPTH — COVER ONLY
// =======================

document.addEventListener("mousemove", (event) => {
  const x = (event.clientX / window.innerWidth - 0.5) * 2;
  const y = (event.clientY / window.innerHeight - 0.5) * 2;

  document.body.style.setProperty("--mouse-x", x.toFixed(3));
  document.body.style.setProperty("--mouse-y", y.toFixed(3));

  if (img) {
    img.style.transform = `
      translate3d(${x * 10}px, ${y * 8}px, 0)
      scale(1.03)
    `;
  }
});

document.addEventListener("mouseleave", () => {
  if (img) {
    img.style.transform = "translate3d(0, 0, 0) scale(1)";
  }
});
