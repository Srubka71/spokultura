// =======================
// ETAP 55A-4 — ROOM_STATE JAM_ACTIVE SOURCE OF TRUTH
// Spokultura Jam Room #1
// =======================

const JAM_LOCAL_USER_KEY = "spokulturaJamUser";
const JAM_LOCAL_NICK_KEY = "spokulturaJamNick";
const JAM_SPAM_STATE_KEY = "spokulturaJamSpamState";

const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
const SUPABASE_ANON_KEY_STABLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

const JAM_ROOM_CHANNEL = "spokultura_jam_room_1";
const JAM_ROOM_STATE_CHANNEL = "spokultura_jam_room_state_1";
const JAM_ROOM_STATE_ID = "room_1";

const JAM_SESSION_ID =
  "session_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2);

const JAM_PRESENCE_LEAVE_DEBOUNCE_MS = 1800;
const JAM_SPAM_ESCALATION_WINDOW_MS = 4 * 60 * 1000;

const JAM_ACTION_LOCK_MS = 850;
const JAM_ACTION_MIN_INTERVAL_MS = 650;

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
let jamRoomStateChannel = null;

let jamRoomState = null;
let jamRoomStateReady = false;

let jamUser = null;
let jamJoined = false;
let jamRealtimeReady = false;
let jamActive = false;

let jamQueue = [];
let jamOnlineUsers = [];
let jamCurrentPerformer = null;
let jamMicRequested = false;

let jamMicSource = null;
// null | "queue" | "queue_pass" | "skip" | "host_pick" | "host_takeover"

let jamHostTakeoverPreviousPerformer = null;

let jamActionLocked = false;
let jamLastActionAt = 0;

let jamLastChatText = "";
let jamLastChatAt = 0;
let jamLastReactionText = "";
let jamLastReactionAt = 0;

let jamRecentChatTimes = [];
let jamRecentReactionTimes = [];

let jamSpamState = loadSpamState();

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

async function runLockedAction(action, label = "akcję") {
  const now = Date.now();
  const sinceLastAction = now - jamLastActionAt;

  if (jamActionLocked) {
    showSystemInfo("Poczekaj chwilę — poprzednia akcja jeszcze się synchronizuje.", "warn");
    return;
  }

  if (sinceLastAction < JAM_ACTION_MIN_INTERVAL_MS) {
    showSystemInfo("Poczekaj moment przed kolejną akcją.", "warn");
    return;
  }

  jamActionLocked = true;
  jamLastActionAt = now;

  renderJamState();

  try {
    await action();
  } catch (error) {
    console.error(error);
    showSystemInfo(`Nie udało się wykonać akcji: ${label}. Spróbuj ponownie.`, "warn");
  } finally {
    setTimeout(() => {
      jamActionLocked = false;
      renderJamState();
    }, JAM_ACTION_LOCK_MS);
  }
}

// =======================
// USER
// =======================

function getOrCreateJamUser() {
  const savedUser = localStorage.getItem(JAM_LOCAL_USER_KEY);

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

  const newUser = {
    id:
      "jam_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2),
    nick:
      savedNick ||
      `Tester ${Math.floor(Math.random() * 900 + 100)}`,
    role: "Listener",
    joinedAt: Date.now(),
    isInQueue: false,
    isPerformer: false,
    queueJoinedAt: 0
  };

  localStorage.setItem(JAM_LOCAL_USER_KEY, JSON.stringify(newUser));
  localStorage.setItem(JAM_LOCAL_NICK_KEY, newUser.nick);

  return newUser;
}

function saveJamUser() {
  if (!jamUser) return;

  localStorage.setItem(JAM_LOCAL_USER_KEY, JSON.stringify(jamUser));
  localStorage.setItem(JAM_LOCAL_NICK_KEY, jamUser.nick);
}

function askForNick() {
  const currentNick = jamUser && jamUser.nick ? jamUser.nick : "";

  const nick = prompt("Podaj nick do Jam Roomu:", currentNick);
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
// ROLE / QUEUE HELPERS
// =======================

function getCurrentPresenceUser() {
  if (!jamUser) return null;

  return jamOnlineUsers.find((user) => {
    return user.sessionId === JAM_SESSION_ID;
  }) || null;
}

function isCurrentUserHost() {
  const currentPresenceUser = getCurrentPresenceUser();

  if (currentPresenceUser && currentPresenceUser.role === "Host") {
    return true;
  }

  if (!jamOnlineUsers.length && jamJoined) {
    return true;
  }

  return false;
}

function isCurrentUserPerformer() {
  return Boolean(
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID
  );
}

function isCurrentHostTakeoverActive() {
  return Boolean(
    isCurrentUserHost() &&
    isCurrentUserPerformer() &&
    jamMicSource === "host_takeover"
  );
}

function isCurrentHostNormalPerformer() {
  return Boolean(
    isCurrentUserHost() &&
    isCurrentUserPerformer() &&
    jamMicSource !== "host_takeover"
  );
}

function isHostSession(sessionId) {
  if (!jamOnlineUsers.length) return false;

  const host = jamOnlineUsers.find((user) => user.role === "Host");

  return Boolean(host && host.sessionId === sessionId);
}

function getFirstQueueUser() {
  if (!jamQueue.length) return null;

  return jamQueue[0];
}

function getFirstQueueUserExcept(sessionId) {
  if (!jamQueue.length) return null;

  return jamQueue.find((user) => {
    return user.sessionId !== sessionId;
  }) || null;
}

function getQueueUserAfter(sessionId) {
  if (!jamQueue.length) return null;

  if (!sessionId) {
    return getFirstQueueUser();
  }

  const currentIndex = jamQueue.findIndex((user) => {
    return user.sessionId === sessionId;
  });

  if (currentIndex < 0) {
    return getFirstQueueUser();
  }

  if (jamQueue.length === 1) {
    return null;
  }

  const nextIndex = (currentIndex + 1) % jamQueue.length;

  return jamQueue[nextIndex];
}

function sessionIsCurrentlyOnline(sessionId) {
  return jamOnlineUsers.some((user) => {
    return user.sessionId === sessionId;
  });
}

function getRestorablePreviousPerformer() {
  if (!jamHostTakeoverPreviousPerformer) {
    return null;
  }

  const previousSessionId = jamHostTakeoverPreviousPerformer.sessionId;

  if (!sessionIsCurrentlyOnline(previousSessionId)) {
    return null;
  }

  const queuedVersion = jamQueue.find((user) => {
    return user.sessionId === previousSessionId;
  });

  if (queuedVersion) {
    return queuedVersion;
  }

  return jamHostTakeoverPreviousPerformer;
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
      jamMicSource = null;
      renderJamState();
    }
  }, JAM_PRESENCE_LEAVE_DEBOUNCE_MS);

  jamPendingLeaveTimers.set(sessionId, timer);
}

// =======================
// ROOM_STATE READ / WRITE
// =======================

async function fetchJamRoomState() {
  if (!jamSupabaseClient) return;

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .select("*")
      .eq("room_id", JAM_ROOM_STATE_ID)
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] fetch error:", error);
      showSystemInfo("room_state: błąd odczytu.", "warn");
      return;
    }

    jamRoomState = data;
    jamRoomStateReady = true;

    const nextJamActive = Boolean(jamRoomState.jam_active);

    if (jamActive !== nextJamActive) {
      jamActive = nextJamActive;

      showSystemInfo(
        jamActive
          ? "room_state: Jam ustawiony jako LIVE."
          : "room_state: Jam ustawiony jako STOP.",
        "success"
      );
    }

    console.log("[JAM ROOM_STATE] loaded:", jamRoomState);

    showSystemInfo("room_state odczytany.", "success");
    renderJamState();
  } catch (error) {
    console.error("[JAM ROOM_STATE] fetch exception:", error);
    showSystemInfo("room_state: błąd połączenia.", "warn");
  }
}

function subscribeJamRoomState() {
  if (!jamSupabaseClient) return;

  if (jamRoomStateChannel) {
    try {
      jamSupabaseClient.removeChannel(jamRoomStateChannel);
    } catch (error) {
      console.error(error);
    }

    jamRoomStateChannel = null;
  }

  jamRoomStateChannel = jamSupabaseClient.channel(JAM_ROOM_STATE_CHANNEL);

  jamRoomStateChannel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "jam_room_state",
        filter: `room_id=eq.${JAM_ROOM_STATE_ID}`
      },
      (payload) => {
        if (payload && payload.new) {
          const previousJamActive = Boolean(jamActive);

          jamRoomState = payload.new;
          jamRoomStateReady = true;

          const nextJamActive = Boolean(jamRoomState.jam_active);

          if (previousJamActive !== nextJamActive) {
            jamActive = nextJamActive;

            showSystemInfo(
              jamActive
                ? "room_state realtime: Jam LIVE."
                : "room_state realtime: Jam STOP.",
              "success"
            );
          } else {
            showSystemInfo("room_state realtime update.", "success");
          }

          console.log("[JAM ROOM_STATE] realtime update:", jamRoomState);

          renderJamState();
        }
      }
    )
    .subscribe((status) => {
      console.log("[JAM ROOM_STATE] channel status:", status);

      if (status === "SUBSCRIBED") {
        jamRoomStateReady = true;
        showSystemInfo("room_state realtime podłączony.", "success");
      }

      if (status === "CHANNEL_ERROR") {
        jamRoomStateReady = false;
        showSystemInfo("room_state realtime: błąd kanału.", "warn");
      }

      if (status === "TIMED_OUT") {
        jamRoomStateReady = false;
        showSystemInfo("room_state realtime: timeout.", "warn");
      }

      renderJamState();
    });
}

function initJamRoomStateReadOnly() {
  if (!jamSupabaseClient) return;

  fetchJamRoomState();
  subscribeJamRoomState();
}

async function saveJamActiveToRoomState(nextJamActive) {
  if (!jamSupabaseClient) {
    showSystemInfo("room_state: brak połączenia Supabase.", "warn");
    return false;
  }

  if (!jamUser) {
    showSystemInfo("room_state: brak użytkownika.", "warn");
    return false;
  }

  try {
    const updatePayload = {
      jam_active: Boolean(nextJamActive),

      host_session_id: isCurrentUserHost()
        ? JAM_SESSION_ID
        : jamRoomState?.host_session_id || null,

      host_user_id: isCurrentUserHost()
        ? jamUser.id
        : jamRoomState?.host_user_id || null,

      host_nick: isCurrentUserHost()
        ? jamUser.nick
        : jamRoomState?.host_nick || null,

      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser.nick,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(updatePayload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] jam_active update error:", error);
      showSystemInfo("room_state: nie udało się zapisać jam_active.", "warn");
      return false;
    }

    jamRoomState = data;
    jamRoomStateReady = true;

    console.log("[JAM ROOM_STATE] jam_active saved:", jamRoomState);

    showSystemInfo(
      nextJamActive
        ? "room_state: jam_active zapisany jako TRUE."
        : "room_state: jam_active zapisany jako FALSE.",
      "success"
    );

    return true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] jam_active update exception:", error);
    showSystemInfo("room_state: błąd zapisu jam_active.", "warn");
    return false;
  }
}

// =======================
// INFO NOTIFICATION STACK
// =======================

function ensureInfoNotification() {
  let container = qs("#jamInfoNotificationStack");

  if (container) {
    return container;
  }

  container = document.createElement("div");
  container.id = "jamInfoNotificationStack";
  container.className = "jam-info-notification-stack";

  const style = document.createElement("style");

  style.innerHTML = `
    .jam-info-notification-stack {
      position: fixed;
      top: 16px;
      left: 50%;
      z-index: 1200;

      width: min(560px, calc(100% - 28px));

      display: flex;
      flex-direction: column;
      gap: 8px;

      transform: translateX(-50%);

      pointer-events: none;
    }

    .jam-info-notification {
      width: 100%;
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

      opacity: 0;
      transform:
        translateY(-10px)
        scale(0.98);

      transition:
        opacity 0.22s ease,
        transform 0.22s ease;
    }

    .jam-info-notification.visible {
      opacity: 1;

      transform:
        translateY(0)
        scale(1);
    }

    .jam-info-notification.leaving {
      opacity: 0;

      transform:
        translateY(-8px)
        scale(0.98);
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
          translateX(0)
          translateY(0)
          scale(1);
      }

      18% {
        transform:
          translateX(-4px)
          translateY(0)
          scale(1.01);
      }

      36% {
        transform:
          translateX(4px)
          translateY(0)
          scale(1.01);
      }

      54% {
        transform:
          translateX(-3px)
          translateY(0)
          scale(1.005);
      }

      72% {
        transform:
          translateX(3px)
          translateY(0)
          scale(1.005);
      }

      100% {
        transform:
          translateX(0)
          translateY(0)
          scale(1);
      }
    }

    @media (max-width: 620px) {
      .jam-info-notification-stack {
        top: 10px;
        width: min(100% - 18px, 560px);
        gap: 7px;
      }

      .jam-info-notification {
        border-radius: 16px;

        font-size: 12px;
        text-align: center;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(container);

  return container;
}

function showInfoNotification(message, type = "default", duration = 4200) {
  const container = ensureInfoNotification();

  const notification = document.createElement("div");
  notification.className = "jam-info-notification";

  const cleanMessage = sanitizeText(message, 180);

  notification.innerText = cleanMessage || "Info";

  if (type === "warn") {
    notification.classList.add("warn");
  }

  if (type === "success") {
    notification.classList.add("success");
  }

  container.prepend(notification);

  const maxVisibleNotifications = 5;
  const notifications = Array.from(
    container.querySelectorAll(".jam-info-notification")
  );

  notifications.slice(maxVisibleNotifications).forEach((oldNotification) => {
    oldNotification.classList.add("leaving");

    setTimeout(() => {
      oldNotification.remove();
    }, 260);
  });

  requestAnimationFrame(() => {
    notification.classList.add("visible");

    void notification.offsetWidth;
    notification.classList.add("attention");
  });

  setTimeout(() => {
    notification.classList.add("leaving");
    notification.classList.remove("visible");
  }, duration);

  setTimeout(() => {
    notification.remove();
  }, duration + 320);
}

function showSystemInfo(message, type = "default") {
  showInfoNotification(message, type);
}

// =======================
// HOST PICK MODAL
// =======================

function ensureHostPickMicModal() {
  let modal = qs("#jamHostPickMicModal");

  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "jamHostPickMicModal";
  modal.className = "jam-modal hidden";

  modal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Przekaż mikrofon</h2>

      <p>
        Wybierz osobę, której Host ma przekazać mikrofon.
      </p>

      <div id="jamHostPickMicList" class="jam-list"></div>

      <div class="jam-modal-actions">
        <button id="closeHostPickMicModalBtn" class="jam-btn" type="button">
          ANULUJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector("#closeHostPickMicModalBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeHostPickMicModal();
    });
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeHostPickMicModal();
    }
  });

  return modal;
}

function openHostPickMicModal() {
  const modal = ensureHostPickMicModal();
  const list = modal.querySelector("#jamHostPickMicList");

  if (!list) return;

  list.innerHTML = "";

  const candidates = jamOnlineUsers.filter((user) => {
    return user.sessionId !== JAM_SESSION_ID;
  });

  if (!candidates.length) {
    const emptyRow = createElement(
      "div",
      "jam-user-row",
      "Brak innych osób online"
    );

    list.appendChild(emptyRow);
  } else {
    candidates.forEach((user) => {
      const row = createElement("button", "jam-btn", "");

      row.type = "button";
      row.style.width = "100%";
      row.style.justifyContent = "space-between";
      row.style.marginBottom = "8px";
      row.innerText = `${user.nick} — ${user.role || "Listener"}`;

      row.addEventListener("click", () => {
        runLockedAction(async () => {
          closeHostPickMicModal();

          await assignPerformer({
            id: user.userId,
            sessionId: user.sessionId,
            nick: user.nick,
            joinedAt: user.queueJoinedAt || Date.now()
          }, "Host", {
            addToQueue: true,
            preserveQueue: true,
            micSource: "host_pick"
          });
        }, "przekaż mikrofon");
      });

      list.appendChild(row);
    });
  }

  modal.classList.remove("hidden");
}

function closeHostPickMicModal() {
  const modal = qs("#jamHostPickMicModal");

  if (modal) {
    modal.classList.add("hidden");
  }
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

  const hasPriorBlock = jamSpamState.lastBlockEndedAt > 0;

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
    const currentPerformerStillSame =
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === performerFromPresence.sessionId;

    jamCurrentPerformer = {
      id: performerFromPresence.userId,
      sessionId: performerFromPresence.sessionId,
      nick: performerFromPresence.nick,
      joinedAt: performerFromPresence.queueJoinedAt || Date.now()
    };

    if (!currentPerformerStillSame && !jamMicSource) {
      jamMicSource = "queue";
    }
  } else {
    jamCurrentPerformer = null;
    jamMicSource = null;
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
      const oldMicSource = jamMicSource;

      jamUser.role = currentPresence.role;
      jamUser.isInQueue = Boolean(currentPresence.isInQueue);
      jamUser.isPerformer = Boolean(currentPresence.isPerformer);
      jamUser.queueJoinedAt = Number(currentPresence.queueJoinedAt || 0);
      jamMicRequested = Boolean(jamUser.isPerformer || jamUser.isInQueue);

      if (!jamUser.isPerformer && oldMicSource === "host_takeover") {
        jamMicSource = null;
      }

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

function handleRealtimeQueueRequest(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  if (payload.session_id === JAM_SESSION_ID) {
    return;
  }

  if (payload.is_host_request) {
    showSystemInfo(`${payload.nick || "Host"} prosi o głos.`, "success");
  } else {
    showSystemInfo(`${payload.nick || "Użytkownik"} dołączył do kolejki mikrofonu.`, "success");
  }

  updatePresenceStateFromChannel();
  renderJamState();
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
  const preserveQueue = Boolean(payload.preserve_queue);
  const addToQueue = Boolean(payload.add_to_queue);
  const incomingMicSource = payload.mic_source || null;

  if (payload.clear_all && jamUser && jamUser.isPerformer && targetSessionId !== JAM_SESSION_ID) {
    jamUser.isPerformer = false;
    jamMicRequested = Boolean(jamUser.isInQueue);

    saveJamUser();
    await updateCurrentPresence();
  }

  if (active) {
    if (targetSessionId === JAM_SESSION_ID && jamUser) {
      jamUser.isPerformer = true;

      if (addToQueue) {
        jamUser.isInQueue = true;

        if (!jamUser.queueJoinedAt) {
          jamUser.queueJoinedAt = Date.now();
        }
      } else if (!preserveQueue) {
        jamUser.isInQueue = false;
        jamUser.queueJoinedAt = 0;
      }

      jamMicRequested = true;
      saveJamUser();
      await updateCurrentPresence();
    }

    jamMicSource = incomingMicSource || "queue";

    jamCurrentPerformer = {
      id: payload.user_id,
      sessionId: targetSessionId,
      nick: payload.nick || "Anon",
      joinedAt: Date.now()
    };

    if (jamMicSource === "host_takeover") {
      showSystemInfo("Host przejął mikrofon.", "success");
    } else if (isHostSession(targetSessionId)) {
      showSystemInfo(`${payload.nick || "Host"} ma teraz głos.`, "success");
    } else {
      showSystemInfo(`${payload.nick || "Użytkownik"} ma teraz mikrofon.`, "success");
    }
  } else {
    if (targetSessionId === JAM_SESSION_ID && jamUser) {
      jamUser.isPerformer = false;

      if (!preserveQueue) {
        jamUser.isInQueue = false;
        jamUser.queueJoinedAt = 0;
      }

      jamMicRequested = Boolean(jamUser.isInQueue);
      saveJamUser();
      await updateCurrentPresence();
    }

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === targetSessionId
    ) {
      jamCurrentPerformer = null;
      jamMicSource = null;
    }

    if (isHostSession(targetSessionId)) {
      showSystemInfo("Host wyłączył mikrofon.");
    } else {
      showSystemInfo(`${payload.nick || "Użytkownik"} wrócił do słuchania.`);
    }
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
            const hadPendingLeave = jamPendingLeaveTimers.has(presence.session_id);

            clearPendingLeaveNotice(presence.session_id);

            if (hadPendingLeave || sessionIsCurrentlyOnline(presence.session_id)) {
              return;
            }

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
    .on("broadcast", { event: "queue_request" }, ({ payload }) => {
      handleRealtimeQueueRequest(payload);
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

    let roleLabel = user.role || "Listener";

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === user.sessionId
    ) {
      roleLabel = `${roleLabel} — TERAZ`;
    }

    const role = createElement("span", "jam-user-role", roleLabel);

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

function setButtonBusyState(button, disabled) {
  if (!button) return;

  button.disabled = disabled;

  if (disabled) {
    button.classList.add("jam-btn-muted");
  } else {
    button.classList.remove("jam-btn-muted");
  }
}

function updateButtons() {
  const disabled = jamActionLocked;

  if (joinRoomBtn) {
    joinRoomBtn.innerText = jamJoined
      ? "OPUŚĆ POKÓJ"
      : "DOŁĄCZ DO POKOJU";

    setButtonBusyState(joinRoomBtn, disabled);
  }

  if (requestMicBtn) {
    if (isCurrentUserPerformer() || (jamUser && jamUser.isInQueue)) {
      requestMicBtn.innerText = "WRÓĆ DO SŁUCHANIA";
    } else {
      requestMicBtn.innerText = "POPROŚ O MIKROFON";
    }

    setButtonBusyState(requestMicBtn, disabled);
  }

  if (startJamBtn) {
    startJamBtn.innerText = jamActive
      ? "ZAKOŃCZ JAM"
      : "START JAM";

    setButtonBusyState(startJamBtn, disabled);
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.innerText = isCurrentHostTakeoverActive()
      ? "WYŁĄCZ MIKROFON"
      : "PRZEJMIJ MIKROFON";

    setButtonBusyState(hostTakeMicBtn, disabled);
  }

  setButtonBusyState(hostPassMicBtn, disabled);
  setButtonBusyState(skipPerformerBtn, disabled);
  setButtonBusyState(performerPassNextBtn, disabled);
  setButtonBusyState(performerBackToListeningBtn, disabled);
}

function updateStatusPills() {
  const statusPill = statusPills[0];
  const jamModePill = statusPills[1];
  const roomStatePill = statusPills[2];

  if (statusPill) {
    if (jamActionLocked) {
      statusPill.innerHTML = "Status: <strong>Synchronizacja</strong>";
    } else if (jamJoined && jamRealtimeReady) {
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

  if (roomStatePill) {
    roomStatePill.innerHTML = jamRoomStateReady
      ? "Room State: <strong>Read</strong>"
      : "Room State: <strong>Off</strong>";
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
  jamMicSource = null;
  jamHostTakeoverPreviousPerformer = null;

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
  jamMicSource = null;
  jamHostTakeoverPreviousPerformer = null;

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
    await leaveQueueCompletely(false);
  }

  await disconnectPresence();

  jamJoined = false;

  resetLocalRoomState();

  showSystemInfo(`${leavingNick} opuścił pokój.`);

  renderJamState();
}

function toggleRoom() {
  runLockedAction(async () => {
    if (jamJoined) {
      await leaveRoom();
    } else {
      joinRoom();
    }
  }, "dołącz / opuść pokój");
}

function requestMicrophone() {
  runLockedAction(async () => {
    if (!jamJoined) {
      showSystemInfo("Najpierw dołącz do pokoju.", "warn");
      return;
    }

    if (isCurrentUserPerformer() || (jamUser && jamUser.isInQueue)) {
      await returnToListening(true);
      return;
    }

    openHeadphonesModal();
  }, "prośba o mikrofon");
}

async function addSelfToMicrophoneQueue() {
  if (!jamUser || !jamJoined) return;

  const currentUserIsHost = isCurrentUserHost();

  jamUser.isInQueue = true;
  jamUser.isPerformer = false;

  if (!jamUser.queueJoinedAt) {
    jamUser.queueJoinedAt = Date.now();
  }

  jamMicRequested = true;

  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID
  ) {
    jamCurrentPerformer = null;
    jamMicSource = null;
  }

  saveJamUser();
  renderJamState();

  await updateCurrentPresence();

  if (currentUserIsHost) {
    showSystemInfo(`${jamUser.nick} prosi o głos.`, "success");
  } else {
    showSystemInfo(`${jamUser.nick} dołączył do kolejki mikrofonu.`, "success");
  }

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("queue_request", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    is_host_request: currentUserIsHost,
    created_at: new Date().toISOString()
  });
}

function confirmMicrophoneRequest() {
  runLockedAction(async () => {
    closeHeadphonesModal();
    await addSelfToMicrophoneQueue();
  }, "potwierdzenie mikrofonu");
}

async function leaveQueueCompletely(shouldBroadcast = true) {
  if (!jamUser) return;

  const wasPerformer = Boolean(jamUser.isPerformer);
  const wasInQueue = Boolean(jamUser.isInQueue);

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
    jamMicSource = null;
  }

  renderJamState();

  await updateCurrentPresence();

  if (wasPerformer || wasInQueue || shouldBroadcast) {
    showSystemInfo(`${jamUser.nick} wyszedł z kolejki.`);
  }

  if (shouldBroadcast) {
    const messageId = createMessageId();

    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("performer_status", {
      message_id: messageId,
      active: false,
      preserve_queue: false,
      mic_source: null,
      session_id: JAM_SESSION_ID,
      user_id: jamUser.id,
      nick: jamUser.nick,
      created_at: new Date().toISOString()
    });
  }
}

async function returnToListening(shouldBroadcast = true) {
  if (!jamUser) return;

  const currentUserHadMic = isCurrentUserPerformer();
  const currentUserWasQueued = Boolean(jamUser.isInQueue);
  const currentUserWasTakeover = isCurrentHostTakeoverActive();

  let nextUser = null;

  if (
    shouldBroadcast &&
    currentUserHadMic &&
    currentUserWasQueued &&
    !currentUserWasTakeover
  ) {
    nextUser = getQueueUserAfter(JAM_SESSION_ID);
  }

  await leaveQueueCompletely(shouldBroadcast);

  if (
    shouldBroadcast &&
    nextUser &&
    nextUser.sessionId !== JAM_SESSION_ID &&
    sessionIsCurrentlyOnline(nextUser.sessionId)
  ) {
    await assignPerformer(nextUser, "Kolejka", {
      addToQueue: true,
      preserveQueue: true,
      micSource: "queue"
    });
  }
}

async function setSelfPerformerState(active, options = {}) {
  if (!jamUser || !jamJoined) return;

  const addToQueue =
    options.addToQueue !== undefined
      ? Boolean(options.addToQueue)
      : true;

  const preserveQueue =
    options.preserveQueue !== undefined
      ? Boolean(options.preserveQueue)
      : true;

  const micSource = options.micSource || "queue";

  jamUser.isPerformer = Boolean(active);

  if (active) {
    jamMicSource = micSource;

    if (addToQueue) {
      jamUser.isInQueue = true;

      if (!jamUser.queueJoinedAt) {
        jamUser.queueJoinedAt = Date.now();
      }
    } else if (!preserveQueue) {
      jamUser.isInQueue = false;
      jamUser.queueJoinedAt = 0;
    }

    jamMicRequested = true;
  } else {
    if (!preserveQueue) {
      jamUser.isInQueue = false;
      jamUser.queueJoinedAt = 0;
    }

    jamMicRequested = Boolean(jamUser.isInQueue);

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === JAM_SESSION_ID
    ) {
      jamMicSource = null;
    }
  }

  saveJamUser();
  renderJamState();

  await updateCurrentPresence();
}

async function assignPerformer(targetUser, sourceLabel = "Host", options = {}) {
  if (!targetUser) {
    showSystemInfo("Nie ma osoby, której można przekazać mikrofon.", "warn");
    return;
  }

  const addToQueue =
    options.addToQueue !== undefined
      ? Boolean(options.addToQueue)
      : true;

  const preserveQueue =
    options.preserveQueue !== undefined
      ? Boolean(options.preserveQueue)
      : true;

  const micSource = options.micSource || "queue";

  const targetIsHost = isHostSession(targetUser.sessionId);

  if (targetUser.sessionId === JAM_SESSION_ID) {
    await setSelfPerformerState(true, {
      addToQueue: addToQueue,
      preserveQueue: preserveQueue,
      micSource: micSource
    });
  } else if (jamUser && jamUser.isPerformer) {
    await setSelfPerformerState(false, {
      preserveQueue: true,
      micSource: null
    });
  }

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  jamMicSource = micSource;

  jamCurrentPerformer = {
    id: targetUser.id,
    sessionId: targetUser.sessionId,
    nick: targetUser.nick,
    joinedAt: targetUser.joinedAt || Date.now()
  };

  if (micSource === "host_takeover") {
    showSystemInfo("Host przejął mikrofon.", "success");
  } else if (targetIsHost) {
    showSystemInfo(`${sourceLabel}: Host ma teraz głos.`, "success");
  } else {
    showSystemInfo(`${sourceLabel}: mikrofon przechodzi do ${targetUser.nick}.`, "success");
  }

  renderJamState();

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: true,
    clear_all: true,
    add_to_queue: addToQueue,
    preserve_queue: preserveQueue,
    mic_source: micSource,
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

  const nextUser = getQueueUserAfter(JAM_SESSION_ID);

  if (!nextUser) {
    showSystemInfo("Nie ma kolejnej osoby w kolejce.", "warn");
    return;
  }

  await assignPerformer(nextUser, "Performer", {
    addToQueue: true,
    preserveQueue: true,
    micSource: "queue_pass"
  });
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

  if (isCurrentHostTakeoverActive()) {
    await hostReleaseMicrophone();
    return;
  }

  if (isCurrentHostNormalPerformer()) {
    showSystemInfo("Host już ma mikrofon z kolejki. Użyj panelu performera: PRZEKAŻ DALEJ albo WRÓĆ DO SŁUCHANIA.", "warn");
    return;
  }

  jamHostTakeoverPreviousPerformer =
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId !== JAM_SESSION_ID
      ? {
          id: jamCurrentPerformer.id,
          sessionId: jamCurrentPerformer.sessionId,
          nick: jamCurrentPerformer.nick,
          joinedAt: jamCurrentPerformer.joinedAt || Date.now()
        }
      : null;

  await assignPerformer({
    id: jamUser.id,
    sessionId: JAM_SESSION_ID,
    nick: jamUser.nick,
    joinedAt: Date.now()
  }, "Host", {
    addToQueue: false,
    preserveQueue: true,
    micSource: "host_takeover"
  });
}

async function hostReleaseMicrophone() {
  if (!jamUser || !jamJoined) return;

  if (!isCurrentHostTakeoverActive()) {
    showSystemInfo("To nie jest awaryjne przejęcie mikrofonu. Użyj panelu performera.", "warn");
    return;
  }

  const restoreTarget = getRestorablePreviousPerformer();

  jamUser.isPerformer = false;

  jamMicRequested = Boolean(jamUser.isInQueue);

  saveJamUser();

  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID
  ) {
    jamCurrentPerformer = null;
    jamMicSource = null;
  }

  renderJamState();

  await updateCurrentPresence();

  showSystemInfo("Host wyłączył mikrofon.");

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: false,
    preserve_queue: true,
    mic_source: null,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    created_at: new Date().toISOString()
  });

  if (restoreTarget) {
    showSystemInfo(`Mikrofon wraca do ${restoreTarget.nick}.`, "success");

    await assignPerformer(restoreTarget, "Host", {
      addToQueue: true,
      preserveQueue: true,
      micSource: "queue"
    });

    jamHostTakeoverPreviousPerformer = null;
    return;
  }

  const fallbackUser = getFirstQueueUserExcept(JAM_SESSION_ID);

  if (fallbackUser && sessionIsCurrentlyOnline(fallbackUser.sessionId)) {
    await assignPerformer(fallbackUser, "Host", {
      addToQueue: true,
      preserveQueue: true,
      micSource: "queue"
    });
  }

  jamHostTakeoverPreviousPerformer = null;
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

  openHostPickMicModal();
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

  const nextJamActive = !jamActive;

  const roomStateSaved = await saveJamActiveToRoomState(nextJamActive);

  if (!roomStateSaved) {
    showSystemInfo("Jam nie został zmieniony — room_state nie zapisał stanu.", "warn");
    return;
  }

  jamActive = nextJamActive;

  if (jamActive) {
    showSystemInfo(`${jamUser.nick} wystartował jam.`, "success");

    if (!jamCurrentPerformer) {
      const firstUser = getFirstQueueUser();

      if (firstUser) {
        await assignPerformer(firstUser, "Host", {
          addToQueue: true,
          preserveQueue: true,
          micSource: "queue"
        });
      }
    }
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

  const skippedSessionId = jamCurrentPerformer.sessionId;
  const skippedNick = jamCurrentPerformer.nick;
  const nextUser = getQueueUserAfter(skippedSessionId);

  if (!nextUser) {
    showSystemInfo("Nie ma kolejnej osoby w kolejce.", "warn");
    return;
  }

  showSystemInfo(`${skippedNick} został pominięty.`);

  await assignPerformer(nextUser, "Host", {
    addToQueue: true,
    preserveQueue: true,
    micSource: "skip"
  });
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
      runLockedAction(async () => {
        await performerPassNext();
      }, "przekaż dalej");
    });
  }

  if (performerBackToListeningBtn) {
    performerBackToListeningBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await returnToListening(true);
      }, "wróć do słuchania");
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
      runLockedAction(async () => {
        await toggleJamActive();
      }, "start / zakończ jam");
    });
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await hostTakeMicrophone();
      }, "przejmij / wyłącz mikrofon");
    });
  }

  if (hostPassMicBtn) {
    hostPassMicBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await hostPassMicrophoneNext();
      }, "przekaż mikrofon");
    });
  }

  if (nextBeatBtn) {
    nextBeatBtn.addEventListener("click", () => {
      hostPlaceholder("NEXT BEAT");
    });
  }

  if (skipPerformerBtn) {
    skipPerformerBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await skipPerformerPlaceholder();
      }, "skip performer");
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
      closeHostPickMicModal();
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

  jamMicSource = null;
  jamHostTakeoverPreviousPerformer = null;
  jamActionLocked = false;
  jamLastActionAt = 0;

  saveJamUser();

  initSupabaseClient();
  initJamRoomStateReadOnly();

  ensureSpamModal();
  ensureInfoNotification();
  ensureHostPickMicModal();

  showSystemInfo("Jam Room gotowy.");

  bindJamEvents();
  renderJamState();
}

window.addEventListener("load", () => {
  initJamRoom();
});
