// =======================
// ETAP 53A-4 — QUEUE PERSISTENCE + PRESENCE LEAVE DEBOUNCE
// Spokultura Jam Room #1
// =======================

const JAM_LOCAL_USER_KEY = "spokulturaJamUser";
const JAM_LOCAL_NICK_KEY = "spokulturaJamNick";
const JAM_SPAM_STATE_KEY = "spokulturaJamSpamState";

const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
const SUPABASE_ANON_KEY_STABLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

const JAM_ROOM_CHANNEL = "spokultura_jam_room_1";

const JAM_SESSION_ID =
  "session_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2);

const JAM_PRESENCE_LEAVE_DEBOUNCE_MS = 1600;
const JAM_SPAM_ESCALATION_WINDOW_MS = 4 * 60 * 1000;

const JAM_SPAM_BLOCK_LEVELS_MS = [
  60 * 1000,
  2 * 60 * 1000,
  3 * 60 * 1000,
  10 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  7 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  60 * 24 * 60 * 60 * 1000,
  120 * 24 * 60 * 60 * 1000
];

let jamSupabaseClient = null;
let jamPresenceChannel = null;

let jamUser = null;
let jamJoined = false;
let jamRealtimeReady = false;
let jamActive = false;

let jamQueue = [];
let jamOnlineUsers = [];
let jamCurrentPerformer = null;
let jamMicRequested = false;

let jamLastChatText = "";
let jamLastChatAt = 0;
let jamLastReactionText = "";
let jamLastReactionAt = 0;

let jamRecentChatTimes = [];
let jamRecentReactionTimes = [];

let jamSpamState = loadSpamState();
let jamNotificationTimer = null;

const jamSeenRealtimeMessageIds = new Set();
const jamPendingLeaveTimers = new Map();

// =======================
// DOM HELPERS
// =======================

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function findButtonByText(text) {
  const normalizedText = text.trim().toLowerCase();

  return qsa("button").find((button) => {
    return button.innerText.trim().toLowerCase() === normalizedText;
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (typeof text === "string") {
    element.innerText = text;
  }

  return element;
}

function sanitizeText(value, maxLength = 120) {
  if (!value) return "";

  return String(value)
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function createMessageId() {
  return (
    "msg_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2)
  );
}

// =======================
// USER
// =======================

function getOrCreateJamUser() {
  let savedUser = localStorage.getItem(JAM_LOCAL_USER_KEY);

  if (savedUser) {
    try {
      const parsedUser = JSON.parse(savedUser);

      if (parsedUser && parsedUser.id && parsedUser.nick) {
        parsedUser.role = parsedUser.role || "Listener";
        parsedUser.joinedAt = Number(parsedUser.joinedAt || Date.now());
        parsedUser.isInQueue = Boolean(parsedUser.isInQueue);
        parsedUser.isPerformer = Boolean(parsedUser.isPerformer);
        parsedUser.queueJoinedAt = Number(parsedUser.queueJoinedAt || 0);

        return parsedUser;
      }
    } catch (error) {
      localStorage.removeItem(JAM_LOCAL_USER_KEY);
    }
  }

  const savedNick = localStorage.getItem(JAM_LOCAL_NICK_KEY);

  const nick =
    savedNick ||
    `Tester ${Math.floor(Math.random() * 900 + 100)}`;

  const newUser = {
    id:
      "jam_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2),
    nick: nick,
    role: "Listener",
    joinedAt: Date.now(),
    isInQueue: false,
    isPerformer: false,
    queueJoinedAt: 0
  };

  localStorage.setItem(JAM_LOCAL_USER_KEY, JSON.stringify(newUser));
  localStorage.setItem(JAM_LOCAL_NICK_KEY, nick);

  return newUser;
}

function saveJamUser() {
  if (!jamUser) return;

  localStorage.setItem(JAM_LOCAL_USER_KEY, JSON.stringify(jamUser));
  localStorage.setItem(JAM_LOCAL_NICK_KEY, jamUser.nick);
}

function askForNick() {
  const currentNick = jamUser && jamUser.nick ? jamUser.nick : "";

  const nick = prompt(
    "Podaj nick do Jam Roomu:",
    currentNick
  );

  const cleanedNick = sanitizeText(nick, 24);

  if (!cleanedNick) {
    return null;
  }

  jamUser.nick = cleanedNick;
  saveJamUser();

  return cleanedNick;
}

// =======================
// UI REFERENCES
// =======================

const hostPanel = qs("#jamHostPanel");
const performerPanel = qs("#jamPerformerPanel");

const onlineCard = qsa(".jam-card").find((card) => {
  const title = card.querySelector("h2");
  return title && title.innerText.trim().toLowerCase() === "online";
});

const queueCard = qsa(".jam-card").find((card) => {
  const title = card.querySelector("h2");
  return title && title.innerText.trim().toLowerCase() === "kolejka scratchujących";
});

const onlineList = onlineCard ? onlineCard.querySelector(".jam-list") : null;
const queueList = queueCard ? queueCard.querySelector(".jam-list") : null;

const chatFeed = qs(".jam-chat-feed");
const chatInput = qs(".jam-chat-form input");
const chatSendBtn = qs(".jam-chat-form button");

const joinRoomBtn = findButtonByText("DOŁĄCZ DO POKOJU");
const requestMicBtn = qs("#openHeadphonesModalBtn");

const startJamBtn = qs("#startJamBtn") || findButtonByText("START JAM");
const nextBeatBtn = qs("#nextBeatBtn") || findButtonByText("NEXT BEAT");
const skipPerformerBtn = qs("#skipPerformerBtn") || findButtonByText("SKIP PERFORMERA");
const hostTakeMicBtn = qs("#hostTakeMicBtn");
const hostPassMicBtn = qs("#hostPassMicBtn");
const transferHostBtn = qs("#transferHostBtn") || findButtonByText("PRZEKAŻ HOSTA");
const kickBtn = qs("#kickBtn") || findButtonByText("KICK");
const muteBtn = qs("#muteBtn") || findButtonByText("MUTE");

const performerPassNextBtn = qs("#performerPassNextBtn");
const performerBackToListeningBtn = qs("#performerBackToListeningBtn");

const headphonesModal = qs("#headphonesModal");
const closeHeadphonesModalBtn = qs("#closeHeadphonesModalBtn");
const confirmMicBtn = qs("#confirmMicBtn");

const nowPlayingPerformerLine = qsa(".jam-track-meta p").find((paragraph) => {
  return paragraph.innerText.includes("Aktualnie skreczuje");
});

const statusPills = qsa(".jam-pill");

// =======================
// ROLE HELPERS
// =======================

function getCurrentPresenceUser() {
  if (!jamUser) return null;

  return jamOnlineUsers.find((user) => {
    return user.sessionId === JAM_SESSION_ID;
  }) || null;
}

function isCurrentUserHost() {
  const currentPresenceUser = getCurrentPresenceUser();

  return Boolean(currentPresenceUser && currentPresenceUser.role === "Host");
}

function isCurrentUserPerformer() {
  return Boolean(
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID
  );
}

function isHostSession(sessionId) {
  if (!jamOnlineUsers.length) return false;

  const host = jamOnlineUsers.find((user) => user.role === "Host");

  return Boolean(host && host.sessionId === sessionId);
}

function getNextQueueUser(excludeSessionId = null) {
  const filteredQueue = jamQueue.filter((user) => {
    return user.sessionId !== excludeSessionId;
  });

  if (!filteredQueue.length) {
    return null;
  }

  return filteredQueue[0];
}

function sessionIsCurrentlyOnline(sessionId) {
  return jamOnlineUsers.some((user) => user.sessionId === sessionId);
}

function clearPendingLeaveNotice(sessionId) {
  if (!sessionId) return;

  const existingTimer = jamPendingLeaveTimers.get(sessionId);

  if (existingTimer) {
    clearTimeout(existingTimer);
    jamPendingLeaveTimers.delete(sessionId);
  }
}

function schedulePresenceLeaveNotice(presence) {
  if (!presence || !presence.session_id || presence.session_id === JAM_SESSION_ID) {
    return;
  }

  const sessionId = presence.session_id;
  const nick = presence.nick || "Użytkownik";

  clearPendingLeaveNotice(sessionId);

  const timer = setTimeout(() => {
    jamPendingLeaveTimers.delete(sessionId);

    if (sessionIsCurrentlyOnline(sessionId)) {
      return;
    }

    showSystemInfo(`${nick} opuścił pokój.`);

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === sessionId
    ) {
      jamCurrentPerformer = null;
      renderJamState();
    }
  }, JAM_PRESENCE_LEAVE_DEBOUNCE_MS);

  jamPendingLeaveTimers.set(sessionId, timer);
}

// =======================
// INFO NOTIFICATION
// =======================

function ensureInfoNotification() {
  let notification = qs("#jamInfoNotification");

  if (notification) {
    return notification;
  }

  notification = document.createElement("div");
  notification.id = "jamInfoNotification";
  notification.className = "jam-info-notification";

  notification.innerHTML = `
    <span id="jamInfoNotificationText">Jam Room gotowy.</span>
  `;

  const style = document.createElement("style");

  style.innerHTML = `
    .jam-info-notification {
      position: fixed;
      top: 16px;
      left: 50%;
      z-index: 1200;

      max-width: min(560px, calc(100% - 28px));
      padding: 11px 15px;

      border-radius: 999px;

      background:
        linear-gradient(135deg, rgba(26,21,12,0.98), rgba(10,10,10,0.98));

      border:
        1px solid rgba(234,162,33,0.38);

      color:
        rgba(255,255,255,0.92);

      font-family: "Rajdhani", sans-serif;
      font-size: 14px;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0.7px;
      text-transform: uppercase;

      box-shadow:
        0 14px 38px rgba(0,0,0,0.48),
        0 0 26px rgba(234,162,33,0.12);

      transform:
        translate(-50%, -18px)
        scale(0.98);

      opacity: 0;
      pointer-events: none;

      transition:
        opacity 0.18s ease,
        transform 0.18s ease;
    }

    .jam-info-notification.visible {
      opacity: 1;

      transform:
        translate(-50%, 0)
        scale(1);
    }

    .jam-info-notification.attention {
      animation:
        jamInfoShake 0.42s ease-in-out 1;
    }

    .jam-info-notification.warn {
      border-color:
        rgba(221,65,36,0.52);

      box-shadow:
        0 14px 38px rgba(0,0,0,0.48),
        0 0 26px rgba(221,65,36,0.16);
    }

    .jam-info-notification.success {
      border-color:
        rgba(124,255,0,0.36);

      box-shadow:
        0 14px 38px rgba(0,0,0,0.48),
        0 0 26px rgba(124,255,0,0.12);
    }

    @keyframes jamInfoShake {
      0% {
        transform:
          translate(-50%, 0)
          scale(1);
      }

      18% {
        transform:
          translate(calc(-50% - 4px), 0)
          scale(1.01);
      }

      36% {
        transform:
          translate(calc(-50% + 4px), 0)
          scale(1.01);
      }

      54% {
        transform:
          translate(calc(-50% - 3px), 0)
          scale(1.005);
      }

      72% {
        transform:
          translate(calc(-50% + 3px), 0)
          scale(1.005);
      }

      100% {
        transform:
          translate(-50%, 0)
          scale(1);
      }
    }

    @media (max-width: 620px) {
      .jam-info-notification {
        top: 10px;

        border-radius: 16px;

        font-size: 12px;
        text-align: center;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(notification);

  return notification;
}

function showInfoNotification(message, type = "default", duration = 3200) {
  const notification = ensureInfoNotification();
  const textElement = notification.querySelector("#jamInfoNotificationText");

  if (jamNotificationTimer) {
    clearTimeout(jamNotificationTimer);
    jamNotificationTimer = null;
  }

  if (textElement) {
    textElement.innerText = sanitizeText(message, 160);
  }

  notification.classList.remove("warn", "success", "attention");

  if (type === "warn") {
    notification.classList.add("warn");
  }

  if (type === "success") {
    notification.classList.add("success");
  }

  notification.classList.add("visible");

  void notification.offsetWidth;
  notification.classList.add("attention");

  jamNotificationTimer = setTimeout(() => {
    notification.classList.remove("visible", "attention");
  }, duration);
}

function showSystemInfo(message, type = "default") {
  showInfoNotification(message, type);
}

// =======================
// SPAM MODAL
// =======================

function ensureSpamModal() {
  let modal = qs("#jamSpamModal");

  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "jamSpamModal";
  modal.className = "jam-modal hidden";

  modal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Nie spamuj</h2>

      <p id="jamSpamModalMessage">
        Nie spamuj chatu, daj innym przeczytać i się wypowiedzieć.
      </p>

      <div class="jam-modal-actions">
        <button id="closeSpamModalBtn" class="jam-btn jam-btn-primary" type="button">
          OK
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector("#closeSpamModalBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeSpamModal();
    });
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeSpamModal();
    }
  });

  return modal;
}

function showSpamModal(message) {
  const modal = ensureSpamModal();
  const messageElement = modal.querySelector("#jamSpamModalMessage");

  if (messageElement) {
    messageElement.innerText =
      message ||
      "Nie spamuj chatu, daj innym przeczytać i się wypowiedzieć.";
  }

  modal.classList.remove("hidden");
}

function closeSpamModal() {
  const modal = qs("#jamSpamModal");

  if (modal) {
    modal.classList.add("hidden");
  }
}

// =======================
// ANTISPAM
// =======================

function loadSpamState() {
  const rawState = localStorage.getItem(JAM_SPAM_STATE_KEY);

  if (!rawState) {
    return {
      warningUsed: false,
      penaltyLevel: 0,
      blockedUntil: 0,
      lastBlockEndedAt: 0,
      lastViolationAt: 0
    };
  }

  try {
    const parsed = JSON.parse(rawState);

    return {
      warningUsed: Boolean(parsed.warningUsed),
      penaltyLevel: Number(parsed.penaltyLevel || 0),
      blockedUntil: Number(parsed.blockedUntil || 0),
      lastBlockEndedAt: Number(parsed.lastBlockEndedAt || 0),
      lastViolationAt: Number(parsed.lastViolationAt || 0)
    };
  } catch (error) {
    return {
      warningUsed: false,
      penaltyLevel: 0,
      blockedUntil: 0,
      lastBlockEndedAt: 0,
      lastViolationAt: 0
    };
  }
}

function saveSpamState() {
  localStorage.setItem(JAM_SPAM_STATE_KEY, JSON.stringify(jamSpamState));
}

function updateExpiredSpamBlock() {
  const now = Date.now();

  if (
    jamSpamState.blockedUntil > 0 &&
    now >= jamSpamState.blockedUntil
  ) {
    jamSpamState.lastBlockEndedAt = jamSpamState.blockedUntil;
    jamSpamState.blockedUntil = 0;
    saveSpamState();
  }
}

function resetSpamEscalationIfExpired() {
  updateExpiredSpamBlock();

  const now = Date.now();

  if (
    jamSpamState.lastBlockEndedAt > 0 &&
    now - jamSpamState.lastBlockEndedAt > JAM_SPAM_ESCALATION_WINDOW_MS
  ) {
    jamSpamState.penaltyLevel = 0;
    jamSpamState.warningUsed = true;
    saveSpamState();
  }
}

function formatRemainingTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);

  if (totalHours < 24) {
    return `${totalHours} h`;
  }

  const totalDays = Math.ceil(totalHours / 24);

  return `${totalDays} dni`;
}

function isSpamBlocked() {
  updateExpiredSpamBlock();

  return Date.now() < Number(jamSpamState.blockedUntil || 0);
}

function getSpamBlockRemaining() {
  return Math.max(0, Number(jamSpamState.blockedUntil || 0) - Date.now());
}

function applySpamViolation(reason) {
  const now = Date.now();

  updateExpiredSpamBlock();
  resetSpamEscalationIfExpired();

  jamSpamState.lastViolationAt = now;

  const hasPriorBlock =
    jamSpamState.lastBlockEndedAt > 0;

  const isInsideEscalationWindow =
    hasPriorBlock &&
    now - jamSpamState.lastBlockEndedAt <= JAM_SPAM_ESCALATION_WINDOW_MS;

  if (!hasPriorBlock && !jamSpamState.warningUsed) {
    jamSpamState.warningUsed = true;
    saveSpamState();

    showSpamModal(
      "Nie spamuj chatu, daj innym przeczytać i się wypowiedzieć. To jest ostrzeżenie."
    );

    showSystemInfo(
      `Antyspam: ${reason}. Ostrzeżenie.`,
      "warn"
    );

    return false;
  }

  if (hasPriorBlock && !isInsideEscalationWindow) {
    jamSpamState.penaltyLevel = 0;
    jamSpamState.warningUsed = true;
  }

  const blockIndex = Math.min(
    jamSpamState.penaltyLevel,
    JAM_SPAM_BLOCK_LEVELS_MS.length - 1
  );

  const blockMs = JAM_SPAM_BLOCK_LEVELS_MS[blockIndex];

  jamSpamState.blockedUntil = now + blockMs;
  jamSpamState.lastBlockEndedAt = jamSpamState.blockedUntil;
  jamSpamState.penaltyLevel = Math.min(
    jamSpamState.penaltyLevel + 1,
    JAM_SPAM_BLOCK_LEVELS_MS.length - 1
  );
  jamSpamState.warningUsed = true;

  saveSpamState();

  showSpamModal(
    `Nie spamuj chatu. Blokada wysyłania: ${formatRemainingTime(blockMs)}.`
  );

  showSystemInfo(
    `Antyspam: ${reason}. Blokada: ${formatRemainingTime(blockMs)}.`,
    "warn"
  );

  return true;
}

function checkCurrentSpamBlock() {
  if (!isSpamBlocked()) {
    return false;
  }

  const remaining = getSpamBlockRemaining();

  showSpamModal(
    `Masz aktywną blokadę antyspamową. Spróbuj ponownie za ${formatRemainingTime(remaining)}.`
  );

  showSystemInfo(
    `Aktywna blokada antyspamowa: ${formatRemainingTime(remaining)}.`,
    "warn"
  );

  return true;
}

function looksLikeRepeatedCharacters(text) {
  const normalized = text.replace(/\s+/g, "");

  if (normalized.length < 4) {
    return false;
  }

  return /^(.)\1+$/.test(normalized);
}

function pruneRecentTimes(times, windowMs) {
  const now = Date.now();

  return times.filter((timestamp) => {
    return now - timestamp <= windowMs;
  });
}

function checkChatSpam(message) {
  if (checkCurrentSpamBlock()) {
    return true;
  }

  const now = Date.now();
  const normalizedMessage = message.toLowerCase().trim();

  jamRecentChatTimes = pruneRecentTimes(jamRecentChatTimes, 3000);

  if (
    normalizedMessage &&
    normalizedMessage === jamLastChatText &&
    now - jamLastChatAt < 1000
  ) {
    applySpamViolation("ta sama wiadomość wysłana za szybko");
    return true;
  }

  if (looksLikeRepeatedCharacters(normalizedMessage)) {
    applySpamViolation("powtarzanie tych samych znaków");
    return true;
  }

  if (jamRecentChatTimes.length >= 3) {
    applySpamViolation("zbyt dużo wiadomości w krótkim czasie");
    return true;
  }

  jamLastChatText = normalizedMessage;
  jamLastChatAt = now;
  jamRecentChatTimes.push(now);

  return false;
}

function checkReactionSpam(reaction) {
  if (checkCurrentSpamBlock()) {
    return true;
  }

  const now = Date.now();

  jamRecentReactionTimes = pruneRecentTimes(jamRecentReactionTimes, 2000);

  if (
    reaction === jamLastReactionText &&
    now - jamLastReactionAt < 700
  ) {
    applySpamViolation("ta sama reakcja kliknięta za szybko");
    return true;
  }

  if (jamRecentReactionTimes.length >= 5) {
    applySpamViolation("zbyt dużo reakcji w krótkim czasie");
    return true;
  }

  jamLastReactionText = reaction;
  jamLastReactionAt = now;
  jamRecentReactionTimes.push(now);

  return false;
}

// =======================
// SUPABASE REALTIME / PRESENCE
// =======================

function initSupabaseClient() {
  if (!window.supabase) {
    showSystemInfo(
      "Brak biblioteki Supabase. Sprawdź CDN w index.html.",
      "warn"
    );

    return false;
  }

  jamSupabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY_STABLE
  );

  return true;
}

function getPresencePayload() {
  return {
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    role: "Listener",
    joined_at: Number(jamUser.joinedAt || Date.now()),
    online_at: new Date().toISOString(),
    is_in_queue: Boolean(jamUser.isInQueue),
    queue_joined_at: Number(jamUser.queueJoinedAt || 0),
    is_performer: Boolean(jamUser.isPerformer)
  };
}

function flattenPresenceState(state) {
  const usersBySession = new Map();

  Object.keys(state).forEach((presenceKey) => {
    const presences = state[presenceKey];

    presences.forEach((presence) => {
      if (!presence || !presence.session_id) return;

      const sessionId = presence.session_id;

      clearPendingLeaveNotice(sessionId);

      usersBySession.set(sessionId, {
        id: sessionId,
        userId: presence.user_id || sessionId,
        sessionId: sessionId,
        nick: presence.nick || "Anon",
        role: "Listener",
        joinedAt: Number(presence.joined_at || Date.now()),
        onlineAt: presence.online_at || new Date().toISOString(),
        isInQueue: Boolean(presence.is_in_queue),
        queueJoinedAt: Number(presence.queue_joined_at || 0),
        isPerformer: Boolean(presence.is_performer)
      });
    });
  });

  const users = Array.from(usersBySession.values());

  users.sort((a, b) => {
    return Number(a.joinedAt || 0) - Number(b.joinedAt || 0);
  });

  users.forEach((user, index) => {
    const isHost = index === 0;

    if (isHost) {
      user.role = "Host";
    } else if (user.isPerformer) {
      user.role = "Performer";
    } else {
      user.role = "Listener";
    }
  });

  jamQueue = users
    .filter((user) => user.isInQueue)
    .sort((a, b) => {
      return Number(a.queueJoinedAt || 0) - Number(b.queueJoinedAt || 0);
    })
    .map((user) => {
      return {
        id: user.userId,
        sessionId: user.sessionId,
        nick: user.nick,
        joinedAt: user.queueJoinedAt || user.joinedAt
      };
    });

  const performerFromPresence = users.find((user) => {
    return user.isPerformer;
  });

  if (performerFromPresence) {
    jamCurrentPerformer = {
      id: performerFromPresence.userId,
      sessionId: performerFromPresence.sessionId,
      nick: performerFromPresence.nick,
      joinedAt: performerFromPresence.queueJoinedAt || Date.now()
    };
  } else {
    jamCurrentPerformer = null;
  }

  return users;
}

function updatePresenceStateFromChannel() {
  if (!jamPresenceChannel) return;

  const state = jamPresenceChannel.presenceState();

  jamOnlineUsers = flattenPresenceState(state);

  if (jamUser) {
    const currentPresence = jamOnlineUsers.find((user) => {
      return user.sessionId === JAM_SESSION_ID;
    });

    if (currentPresence) {
      jamUser.role = currentPresence.role;
      jamUser.isInQueue = Boolean(currentPresence.isInQueue);
      jamUser.isPerformer = Boolean(currentPresence.isPerformer);
      jamUser.queueJoinedAt = Number(currentPresence.queueJoinedAt || 0);
      jamMicRequested = Boolean(jamUser.isPerformer);
      saveJamUser();
    }
  }

  renderJamState();
}

async function trackCurrentUserPresence() {
  if (!jamPresenceChannel || !jamUser) return;

  saveJamUser();

  await jamPresenceChannel.track(getPresencePayload());
}

async function updateCurrentPresence() {
  if (!jamPresenceChannel || !jamUser || !jamJoined) return;

  saveJamUser();

  await jamPresenceChannel.track(getPresencePayload());
}

// =======================
// REALTIME HANDLERS
// =======================

function handleRealtimeChatMessage(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  if (payload.session_id === JAM_SESSION_ID) {
    return;
  }

  addChatMessage(payload.nick || "Anon", payload.message || "");
}

function handleRealtimeReaction(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  if (payload.session_id === JAM_SESSION_ID) {
    return;
  }

  addChatMessage(payload.nick || "Anon", payload.reaction || "");
}

function handleRealtimeJamStatus(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  jamActive = Boolean(payload.active);

  if (jamActive) {
    showSystemInfo(`${payload.nick || "Host"} wystartował jam.`, "success");
  } else {
    showSystemInfo(`${payload.nick || "Host"} zakończył jam.`);
  }

  updatePresenceStateFromChannel();
  renderJamState();
}

async function handleRealtimePerformerStatus(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  const targetSessionId = payload.session_id;
  const active = Boolean(payload.active);
  const isHostRequest = Boolean(payload.is_host_request);

  if (payload.clear_all && jamUser && jamUser.isPerformer && targetSessionId !== JAM_SESSION_ID) {
    jamUser.isPerformer = false;
    jamMicRequested = false;

    // Ważne:
    // Nie czyścimy tutaj isInQueue ani queueJoinedAt.
    // Dzięki temu poprzedni performer/host nie wypada z kolejki,
    // kiedy ktoś inny prosi o mikrofon.
    saveJamUser();
    await updateCurrentPresence();
  }

  if (active) {
    if (targetSessionId === JAM_SESSION_ID && jamUser) {
      jamUser.isPerformer = true;
      jamUser.isInQueue = true;

      if (!jamUser.queueJoinedAt) {
        jamUser.queueJoinedAt = Date.now();
      }

      jamMicRequested = true;
      saveJamUser();
      await updateCurrentPresence();
    }

    jamCurrentPerformer = {
      id: payload.user_id,
      sessionId: targetSessionId,
      nick: payload.nick || "Anon",
      joinedAt: Date.now()
    };

    if (isHostRequest) {
      showSystemInfo(`${payload.nick || "Host"} prosi o głos.`, "success");
    } else {
      showSystemInfo(`${payload.nick || "Użytkownik"} jest teraz performerem.`, "success");
    }
  } else {
    if (targetSessionId === JAM_SESSION_ID && jamUser) {
      jamUser.isPerformer = false;
      jamUser.isInQueue = false;
      jamUser.queueJoinedAt = 0;
      jamMicRequested = false;
      saveJamUser();
      await updateCurrentPresence();
    }

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === targetSessionId
    ) {
      jamCurrentPerformer = null;
    }

    showSystemInfo(`${payload.nick || "Użytkownik"} wrócił do słuchania.`);
  }

  updatePresenceStateFromChannel();
  renderJamState();
}

function connectPresence() {
  if (!jamSupabaseClient || !jamUser) return;

  if (jamPresenceChannel) {
    jamSupabaseClient.removeChannel(jamPresenceChannel);
    jamPresenceChannel = null;
  }

  jamPresenceChannel = jamSupabaseClient.channel(JAM_ROOM_CHANNEL, {
    config: {
      presence: {
        key: JAM_SESSION_ID
      },
      broadcast: {
        self: false
      }
    }
  });

  jamPresenceChannel
    .on("presence", { event: "sync" }, () => {
      jamRealtimeReady = true;
      updatePresenceStateFromChannel();
    })
    .on("presence", { event: "join" }, ({ newPresences }) => {
      if (Array.isArray(newPresences)) {
        newPresences.forEach((presence) => {
          if (
            presence &&
            presence.nick &&
            presence.session_id !== JAM_SESSION_ID
          ) {
            clearPendingLeaveNotice(presence.session_id);
            showSystemInfo(`${presence.nick} dołączył do pokoju.`, "success");
          }
        });
      }
    })
    .on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (Array.isArray(leftPresences)) {
        leftPresences.forEach((presence) => {
          schedulePresenceLeaveNotice(presence);
        });
      }

      renderJamState();
    })
    .on("broadcast", { event: "chat_message" }, ({ payload }) => {
      handleRealtimeChatMessage(payload);
    })
    .on("broadcast", { event: "reaction" }, ({ payload }) => {
      handleRealtimeReaction(payload);
    })
    .on("broadcast", { event: "jam_status" }, ({ payload }) => {
      handleRealtimeJamStatus(payload);
    })
    .on("broadcast", { event: "performer_status" }, ({ payload }) => {
      handleRealtimePerformerStatus(payload);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await trackCurrentUserPresence();

        jamRealtimeReady = true;
        showSystemInfo("Połączono z Jam Room realtime.", "success");
        renderJamState();
      }

      if (status === "CHANNEL_ERROR") {
        showSystemInfo("Błąd połączenia realtime.", "warn");
      }

      if (status === "TIMED_OUT") {
        showSystemInfo("Realtime timeout — spróbuj odświeżyć stronę.", "warn");
      }

      if (status === "CLOSED") {
        showSystemInfo("Realtime rozłączony.", "warn");
      }
    });
}

async function sendRealtimeBroadcast(eventName, payload) {
  if (!jamPresenceChannel || !jamRealtimeReady) {
    showSystemInfo("Realtime jeszcze nie jest gotowy.", "warn");
    return;
  }

  try {
    await jamPresenceChannel.send({
      type: "broadcast",
      event: eventName,
      payload: payload
    });
  } catch (error) {
    console.error(error);
    showSystemInfo("Nie udało się wysłać realtime.", "warn");
  }
}

async function leavePresence() {
  if (!jamPresenceChannel) return;

  try {
    await jamPresenceChannel.untrack();
  } catch (error) {
    console.error(error);
  }
}

async function disconnectPresence() {
  if (!jamSupabaseClient || !jamPresenceChannel) {
    jamPresenceChannel = null;
    return;
  }

  try {
    await jamPresenceChannel.untrack();
  } catch (error) {
    console.error(error);
  }

  try {
    jamSupabaseClient.removeChannel(jamPresenceChannel);
  } catch (error) {
    console.error(error);
  }

  jamPresenceChannel = null;
}

// =======================
// RENDER
// =======================

function renderRolePanels() {
  const isHost = isCurrentUserHost();
  const isPerformer = isCurrentUserPerformer();

  if (hostPanel) {
    hostPanel.classList.toggle("jam-card-hidden", !isHost);
  }

  if (performerPanel) {
    performerPanel.classList.toggle("jam-card-hidden", !isPerformer);
  }
}

function renderOnlineUsers() {
  if (!onlineList) return;

  onlineList.innerHTML = "";

  if (!jamOnlineUsers.length) {
    const emptyRow = createElement("div", "jam-user-row");

    const nick = createElement("strong", "", "Brak użytkowników");
    const role = createElement("span", "jam-user-role", "Offline");

    emptyRow.appendChild(nick);
    emptyRow.appendChild(role);

    onlineList.appendChild(emptyRow);
    return;
  }

  jamOnlineUsers.forEach((user) => {
    const row = createElement("div", "jam-user-row");

    const nick = createElement("strong", "", user.nick);
    const role = createElement("span", "jam-user-role", user.role || "Listener");

    row.appendChild(nick);
    row.appendChild(role);

    onlineList.appendChild(row);
  });
}

function renderQueue() {
  if (!queueList) return;

  queueList.innerHTML = "";

  if (!jamQueue.length) {
    const emptyRow = createElement(
      "div",
      "jam-queue-row",
      "Kolejka pusta"
    );

    queueList.appendChild(emptyRow);
    return;
  }

  jamQueue.forEach((user, index) => {
    const row = createElement("div", "jam-queue-row");

    const number = createElement("strong", "", `${index + 1}.`);
    const text = document.createTextNode(` ${user.nick}`);

    row.appendChild(number);
    row.appendChild(text);

    if (
      jamActive &&
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === user.sessionId
    ) {
      const active = document.createTextNode(" — TERAZ");
      row.appendChild(active);
    }

    queueList.appendChild(row);
  });
}

function renderCurrentPerformer() {
  if (!nowPlayingPerformerLine) return;

  const performerName =
    jamActive && jamCurrentPerformer
      ? jamCurrentPerformer.nick
      : "nikt";

  nowPlayingPerformerLine.innerHTML =
    `<strong>Aktualnie skreczuje:</strong> ${performerName}`;
}

function updateButtons() {
  if (joinRoomBtn) {
    joinRoomBtn.innerText = jamJoined
      ? "OPUŚĆ POKÓJ"
      : "DOŁĄCZ DO POKOJU";
  }

  if (requestMicBtn) {
    if (isCurrentUserPerformer() || jamMicRequested || (jamUser && jamUser.isPerformer)) {
      requestMicBtn.innerText = "WRÓĆ DO SŁUCHANIA";
    } else {
      requestMicBtn.innerText = "POPROŚ O MIKROFON";
    }
  }

  if (startJamBtn) {
    startJamBtn.innerText = jamActive
      ? "ZAKOŃCZ JAM"
      : "START JAM";
  }
}

function updateStatusPills() {
  const statusPill = statusPills[0];
  const jamModePill = statusPills[1];

  if (statusPill) {
    if (jamJoined && jamRealtimeReady) {
      statusPill.innerHTML = "Status: <strong>Realtime</strong>";
    } else if (jamJoined) {
      statusPill.innerHTML = "Status: <strong>Łączenie</strong>";
    } else {
      statusPill.innerHTML = "Status: <strong>Poza pokojem</strong>";
    }
  }

  if (jamModePill) {
    jamModePill.innerHTML = jamActive
      ? "Jam: <strong>Live</strong>"
      : "Jam: <strong>Stop</strong>";
  }
}

function renderJamState() {
  renderRolePanels();
  renderOnlineUsers();
  renderQueue();
  renderCurrentPerformer();
  updateButtons();
  updateStatusPills();
}

// =======================
// CHAT / FEED
// =======================

function addChatMessage(author, message, type = "normal") {
  if (!chatFeed) return;

  if (type === "system") {
    showSystemInfo(message || author || "Info");
    return;
  }

  const cleanAuthor = sanitizeText(author, 28) || "Anon";
  const cleanMessage = sanitizeText(message, 160);

  if (!cleanMessage) return;

  const row = createElement("div", "jam-chat-row");

  row.innerHTML = `<strong>${cleanAuthor}:</strong> ${cleanMessage}`;

  chatFeed.appendChild(row);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

async function sendLocalChatMessage() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!chatInput) return;

  const message = sanitizeText(chatInput.value, 120);

  if (!message) {
    return;
  }

  if (checkChatSpam(message)) {
    return;
  }

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  addChatMessage(jamUser.nick, message);
  chatInput.value = "";

  await sendRealtimeBroadcast("chat_message", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    message: message,
    created_at: new Date().toISOString()
  });
}

async function addReaction(reaction) {
  if (!jamJoined) {
    showSystemInfo("Dołącz do pokoju, żeby wysyłać reakcje.", "warn");
    return;
  }

  const cleanReaction = sanitizeText(reaction, 8);

  if (!cleanReaction) {
    return;
  }

  if (checkReactionSpam(cleanReaction)) {
    return;
  }

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  addChatMessage(jamUser.nick, cleanReaction);

  await sendRealtimeBroadcast("reaction", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    reaction: cleanReaction,
    created_at: new Date().toISOString()
  });
}

// =======================
// ROOM ACTIONS
// =======================

function resetLocalRoomState() {
  jamQueue = [];
  jamOnlineUsers = [];
  jamCurrentPerformer = null;
  jamMicRequested = false;
  jamRealtimeReady = false;

  if (jamUser) {
    jamUser.isInQueue = false;
    jamUser.isPerformer = false;
    jamUser.queueJoinedAt = 0;
    saveJamUser();
  }
}

function joinRoom() {
  if (jamJoined) {
    return;
  }

  if (!jamUser) {
    jamUser = getOrCreateJamUser();
  }

  const nick = askForNick();

  if (!nick) {
    showSystemInfo("Nie dołączono — brak nicku.", "warn");
    return;
  }

  jamJoined = true;
  jamRealtimeReady = false;

  jamUser.role = "Listener";
  jamUser.joinedAt = Date.now();
  jamUser.isInQueue = false;
  jamUser.isPerformer = false;
  jamUser.queueJoinedAt = 0;

  saveJamUser();

  jamOnlineUsers = [
    {
      id: JAM_SESSION_ID,
      userId: jamUser.id,
      sessionId: JAM_SESSION_ID,
      nick: jamUser.nick,
      role: "Listener",
      joinedAt: jamUser.joinedAt,
      isInQueue: false,
      queueJoinedAt: 0,
      isPerformer: false
    }
  ];

  showSystemInfo(`${jamUser.nick} dołącza do pokoju...`);

  if (!jamSupabaseClient) {
    showSystemInfo("Realtime niedostępny — tryb lokalny.", "warn");
    renderJamState();
    return;
  }

  connectPresence();
  renderJamState();
}

async function leaveRoom() {
  if (!jamJoined) {
    return;
  }

  const leavingNick = jamUser && jamUser.nick ? jamUser.nick : "Użytkownik";

  if (jamUser && jamUser.isPerformer) {
    await returnToListening(false);
  }

  await disconnectPresence();

  jamJoined = false;

  resetLocalRoomState();

  showSystemInfo(`${leavingNick} opuścił pokój.`);

  renderJamState();
}

function toggleRoom() {
  if (jamJoined) {
    leaveRoom();
  } else {
    joinRoom();
  }
}

function requestMicrophone() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (isCurrentUserPerformer() || jamMicRequested || jamUser.isPerformer) {
    returnToListening(true);
    return;
  }

  openHeadphonesModal();
}

async function setSelfAsPerformer() {
  if (!jamUser || !jamJoined) return;

  const currentUserIsHost = isCurrentUserHost();

  jamMicRequested = true;

  jamUser.isInQueue = true;
  jamUser.isPerformer = true;

  if (!jamUser.queueJoinedAt) {
    jamUser.queueJoinedAt = Date.now();
  }

  saveJamUser();

  jamCurrentPerformer = {
    id: jamUser.id,
    sessionId: JAM_SESSION_ID,
    nick: jamUser.nick,
    joinedAt: jamUser.queueJoinedAt
  };

  await updateCurrentPresence();

  if (currentUserIsHost) {
    showSystemInfo(`${jamUser.nick} prosi o głos.`, "success");
  } else {
    showSystemInfo(`${jamUser.nick} jest teraz performerem.`, "success");
  }

  renderJamState();

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: true,
    clear_all: true,
    is_host_request: currentUserIsHost,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    created_at: new Date().toISOString()
  });
}

async function confirmMicrophoneRequest() {
  closeHeadphonesModal();
  await setSelfAsPerformer();
}

async function returnToListening(shouldBroadcast = true) {
  if (!jamUser) return;

  const wasPerformer = Boolean(jamUser.isPerformer);

  jamMicRequested = false;

  jamUser.isPerformer = false;
  jamUser.isInQueue = false;
  jamUser.queueJoinedAt = 0;

  saveJamUser();

  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID
  ) {
    jamCurrentPerformer = null;
  }

  await updateCurrentPresence();

  if (wasPerformer || shouldBroadcast) {
    showSystemInfo(
      `${jamUser.nick} wrócił do słuchania.`
    );
  }

  renderJamState();

  if (shouldBroadcast) {
    const messageId = createMessageId();

    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("performer_status", {
      message_id: messageId,
      active: false,
      session_id: JAM_SESSION_ID,
      user_id: jamUser.id,
      nick: jamUser.nick,
      created_at: new Date().toISOString()
    });
  }
}

async function assignPerformer(targetUser, sourceLabel = "Host") {
  if (!targetUser) {
    showSystemInfo("Nie ma osoby, której można przekazać mikrofon.", "warn");
    return;
  }

  const targetIsHost = isHostSession(targetUser.sessionId);

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  jamCurrentPerformer = {
    id: targetUser.id,
    sessionId: targetUser.sessionId,
    nick: targetUser.nick,
    joinedAt: targetUser.joinedAt || Date.now()
  };

  if (targetIsHost) {
    showSystemInfo(`${sourceLabel}: Host prosi o głos.`, "success");
  } else {
    showSystemInfo(`${sourceLabel}: mikrofon przechodzi do ${targetUser.nick}.`, "success");
  }

  renderJamState();

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: true,
    clear_all: true,
    is_host_request: targetIsHost,
    session_id: targetUser.sessionId,
    user_id: targetUser.id,
    nick: targetUser.nick,
    created_at: new Date().toISOString()
  });
}

async function performerPassNext() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserPerformer()) {
    showSystemInfo("Tylko osoba z mikrofonem może przekazać dalej.", "warn");
    return;
  }

  const nextUser = getNextQueueUser(JAM_SESSION_ID);

  await returnToListening(true);

  if (!nextUser) {
    showSystemInfo("Nie ma kolejnej osoby w kolejce.", "warn");
    return;
  }

  await assignPerformer(nextUser, "Performer");
}

async function hostTakeMicrophone() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przejąć mikrofon.", "warn");
    return;
  }

  await setSelfAsPerformer();

  showSystemInfo("Host przejął głos.", "success");
}

async function hostPassMicrophoneNext() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przekazać mikrofon.", "warn");
    return;
  }

  const currentSessionId = jamCurrentPerformer
    ? jamCurrentPerformer.sessionId
    : null;

  const nextUser = getNextQueueUser(currentSessionId);

  if (!nextUser) {
    showSystemInfo("Nie ma kolejnej osoby w kolejce.", "warn");
    return;
  }

  await assignPerformer(nextUser, "Host");
}

async function toggleJamActive() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wystartować albo zakończyć jam.", "warn");
    return;
  }

  jamActive = !jamActive;

  if (jamActive) {
    showSystemInfo(`${jamUser.nick} wystartował jam.`, "success");
  } else {
    showSystemInfo(`${jamUser.nick} zakończył jam.`);
  }

  renderJamState();

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("jam_status", {
    message_id: messageId,
    active: jamActive,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    created_at: new Date().toISOString()
  });
}

// =======================
// HOST PLACEHOLDERS
// =======================

function hostPlaceholder(action) {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Ta funkcja jest tylko dla Hosta.", "warn");
    return;
  }

  showSystemInfo(
    `${action} — funkcja hosta zostanie podpięta w kolejnym etapie.`
  );
}

async function skipPerformerPlaceholder() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może pominąć osobę z mikrofonem.", "warn");
    return;
  }

  if (!jamCurrentPerformer) {
    showSystemInfo("Nie ma aktywnej osoby z mikrofonem.", "warn");
    return;
  }

  showSystemInfo(
    `${jamCurrentPerformer.nick} został pominięty.`
  );

  const nextUser = getNextQueueUser(jamCurrentPerformer.sessionId);

  if (!nextUser) {
    const messageId = createMessageId();

    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("performer_status", {
      message_id: messageId,
      active: false,
      session_id: jamCurrentPerformer.sessionId,
      user_id: jamCurrentPerformer.id,
      nick: jamCurrentPerformer.nick,
      created_at: new Date().toISOString()
    });

    jamCurrentPerformer = null;
    renderJamState();
    return;
  }

  await assignPerformer(nextUser, "Host");
}

// =======================
// MODAL
// =======================

function openHeadphonesModal() {
  if (headphonesModal) {
    headphonesModal.classList.remove("hidden");
  }
}

function closeHeadphonesModal() {
  if (headphonesModal) {
    headphonesModal.classList.add("hidden");
  }
}

// =======================
// EVENTS
// =======================

function bindJamEvents() {
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", () => {
      toggleRoom();
    });
  }

  if (requestMicBtn) {
    requestMicBtn.addEventListener("click", () => {
      requestMicrophone();
    });
  }

  if (performerPassNextBtn) {
    performerPassNextBtn.addEventListener("click", () => {
      performerPassNext();
    });
  }

  if (performerBackToListeningBtn) {
    performerBackToListeningBtn.addEventListener("click", () => {
      returnToListening(true);
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", () => {
      sendLocalChatMessage();
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendLocalChatMessage();
      }
    });
  }

  qsa(".jam-reaction-btn").forEach((button) => {
    button.addEventListener("click", () => {
      addReaction(button.innerText.trim());
    });
  });

  if (startJamBtn) {
    startJamBtn.addEventListener("click", () => {
      toggleJamActive();
    });
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.addEventListener("click", () => {
      hostTakeMicrophone();
    });
  }

  if (hostPassMicBtn) {
    hostPassMicBtn.addEventListener("click", () => {
      hostPassMicrophoneNext();
    });
  }

  if (nextBeatBtn) {
    nextBeatBtn.addEventListener("click", () => {
      hostPlaceholder("NEXT BEAT");
    });
  }

  if (skipPerformerBtn) {
    skipPerformerBtn.addEventListener("click", () => {
      skipPerformerPlaceholder();
    });
  }

  if (transferHostBtn) {
    transferHostBtn.addEventListener("click", () => {
      hostPlaceholder("PRZEKAŻ HOSTA");
    });
  }

  if (kickBtn) {
    kickBtn.addEventListener("click", () => {
      hostPlaceholder("KICK");
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      hostPlaceholder("MUTE");
    });
  }

  if (closeHeadphonesModalBtn) {
    closeHeadphonesModalBtn.addEventListener("click", () => {
      closeHeadphonesModal();
    });
  }

  if (confirmMicBtn) {
    confirmMicBtn.addEventListener("click", () => {
      confirmMicrophoneRequest();
    });
  }

  if (headphonesModal) {
    headphonesModal.addEventListener("click", (event) => {
      if (event.target === headphonesModal) {
        closeHeadphonesModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHeadphonesModal();
      closeSpamModal();
    }
  });

  window.addEventListener("beforeunload", () => {
    leavePresence();
  });
}

// =======================
// INIT
// =======================

function initJamRoom() {
  jamUser = getOrCreateJamUser();

  jamUser.isInQueue = false;
  jamUser.isPerformer = false;
  jamUser.queueJoinedAt = 0;
  saveJamUser();

  initSupabaseClient();
  ensureSpamModal();
  ensureInfoNotification();

  showSystemInfo("Jam Room gotowy.");

  bindJamEvents();
  renderJamState();
}

window.addEventListener("load", () => {
  initJamRoom();
});
