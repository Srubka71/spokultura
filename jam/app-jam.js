// =======================
// ETAP 55B-2 — QUEUE + MICROPHONE STABILIZATION
// Spokultura Jam Room #1
// =======================

const JAM_LOCAL_USER_KEY = "spokulturaJamUser";
const JAM_LOCAL_NICK_KEY = "spokulturaJamNick";
const JAM_SPAM_STATE_KEY = "spokulturaJamSpamState";

const SUPABASE_URL = "https://hlruehdtrwfrfagqoyve.supabase.co";
const SUPABASE_ANON_KEY_STABLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscnVlaGR0cndmcmZhZ3FveXZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTE3ODEsImV4cCI6MjA5NDI2Nzc4MX0.W3KbmBFpkAkI7y81HfDzUyUL8n8b85i33qENiXJYLDA";

const JAM_ROOM_ID = "room_1";
const JAM_ROOM_STATE_ID = "room_1";

const JAM_ROOM_CHANNEL = "spokultura_jam_room_1";
const JAM_ROOM_STATE_CHANNEL = "spokultura_jam_room_state_1";
const JAM_ROOM_MEMBERS_CHANNEL = "spokultura_jam_room_members_1";

const JAM_SESSION_ID =
  "session_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2);

const JAM_ACTION_LOCK_MS = 850;
const JAM_ACTION_MIN_INTERVAL_MS = 650;

const JAM_ROOM_STATE_RESYNC_MS = 3500;
const JAM_MEMBERS_HEARTBEAT_MS = 2500;
const JAM_MEMBERS_RESYNC_MS = 2500;
const JAM_MEMBERS_STALE_MS = 9500;

const JAM_CHAT_MAX_MESSAGES = 80;
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
let jamBroadcastChannel = null;
let jamRoomStateChannel = null;
let jamMembersChannel = null;

let jamRoomState = null;
let jamRoomStateReady = false;
let jamRoomStateResyncTimer = null;

let jamMembersHeartbeatTimer = null;
let jamMembersResyncTimer = null;

let jamUser = null;
let jamJoined = false;
let jamRealtimeReady = false;
let jamMembersReady = false;
let jamActive = false;

let jamOnlineUsers = [];
let jamQueue = [];
let jamCurrentPerformer = null;
let jamMicSource = null;
let jamMicRequested = false;

let jamHostTakeoverPreviousPerformer = null;

let jamActionLocked = false;
let jamLastActionAt = 0;

let jamLastChatText = "";
let jamLastChatAt = 0;
let jamChatMessages = [];
let jamChatKnownMessageIds = new Set();

let jamLastReactionText = "";
let jamLastReactionAt = 0;

let jamRecentChatTimes = [];
let jamRecentReactionTimes = [];

let jamSpamState = loadSpamState();

const jamSeenRealtimeMessageIds = new Set();

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

function nowIso() {
  return new Date().toISOString();
}

function getStaleCutoffIso() {
  return new Date(Date.now() - JAM_MEMBERS_STALE_MS).toISOString();
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
    showSystemInfo(`Nie udało się wykonać akcji: ${label}.`, "warn");
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
let clearChatBtn = null;

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
// ROLES / MEMBERS
// =======================

function getSortedActiveMembers() {
  return [...jamOnlineUsers].sort((a, b) => {
    const aTime = new Date(a.joinedAt || a.joined_at || 0).getTime();
    const bTime = new Date(b.joinedAt || b.joined_at || 0).getTime();

    return aTime - bTime;
  });
}

function getEffectiveHost() {
  const sortedMembers = getSortedActiveMembers();

  if (sortedMembers.length) {
    return sortedMembers[0];
  }

  if (jamJoined && jamUser) {
    return {
      id: jamUser.id,
      userId: jamUser.id,
      sessionId: JAM_SESSION_ID,
      nick: jamUser.nick
    };
  }

  return null;
}

function getEffectiveHostSessionId() {
  const host = getEffectiveHost();

  return host ? host.sessionId : null;
}

function isCurrentUserHost() {
  return Boolean(jamJoined && getEffectiveHostSessionId() === JAM_SESSION_ID);
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
  return Boolean(sessionId && getEffectiveHostSessionId() === sessionId);
}

function sessionIsCurrentlyOnline(sessionId) {
  return jamOnlineUsers.some((user) => {
    return user.sessionId === sessionId;
  });
}

function getMemberBySessionId(sessionId) {
  return jamOnlineUsers.find((user) => {
    return user.sessionId === sessionId;
  }) || null;
}

function getFirstQueueUser() {
  if (!jamQueue.length) return null;

  return jamQueue[0];
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

function getFirstQueueUserExcept(sessionId) {
  if (!jamQueue.length) return null;

  return jamQueue.find((user) => {
    return user.sessionId !== sessionId;
  }) || null;
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

function normalizeMemberRow(row) {
  return {
    id: row.user_id || row.session_id,
    userId: row.user_id || row.session_id,
    sessionId: row.session_id,
    nick: row.nick || "Anon",
    role: "Listener",
    joinedAt: row.joined_at || nowIso(),
    lastSeenAt: row.last_seen_at || nowIso(),
    isInQueue: Boolean(row.is_in_queue),
    queueJoinedAt: row.queue_joined_at || null,
    isPerformer: Boolean(row.is_performer)
  };
}

function assignRolesAndQueueFromMembers(members) {
  const sortedMembers = [...members].sort((a, b) => {
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });

  const hostSessionId =
    sortedMembers.length > 0
      ? sortedMembers[0].sessionId
      : null;

  sortedMembers.forEach((member) => {
    if (member.sessionId === hostSessionId) {
      member.role = "Host";
    } else if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === member.sessionId
    ) {
      member.role = "Performer";
    } else {
      member.role = "Listener";
    }
  });

  jamQueue = sortedMembers
    .filter((member) => member.isInQueue)
    .sort((a, b) => {
      const aTime = a.queueJoinedAt
        ? new Date(a.queueJoinedAt).getTime()
        : new Date(a.joinedAt).getTime();

      const bTime = b.queueJoinedAt
        ? new Date(b.queueJoinedAt).getTime()
        : new Date(b.joinedAt).getTime();

      return aTime - bTime;
    })
    .map((member) => {
      return {
        id: member.userId,
        userId: member.userId,
        sessionId: member.sessionId,
        nick: member.nick,
        joinedAt: member.queueJoinedAt || member.joinedAt
      };
    });

  return sortedMembers;
}

function syncLocalUserFromMembers() {
  if (!jamUser || !jamJoined) return;

  const currentMember = jamOnlineUsers.find((member) => {
    return member.sessionId === JAM_SESSION_ID;
  });

  if (!currentMember) return;

  jamUser.role = currentMember.role || "Listener";
  jamUser.isInQueue = Boolean(currentMember.isInQueue);
  jamUser.queueJoinedAt = currentMember.queueJoinedAt
    ? new Date(currentMember.queueJoinedAt).getTime()
    : 0;

  jamUser.isPerformer = isCurrentUserPerformer();
  jamMicRequested = Boolean(jamUser.isInQueue || jamUser.isPerformer);

  saveJamUser();
}

// =======================
// MEMBERS TABLE
// =======================

async function fetchJamMembers(options = {}) {
  if (!jamSupabaseClient) return;

  const silent = Boolean(options.silent);

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_members")
      .select("*")
      .eq("room_id", JAM_ROOM_ID)
      .gt("last_seen_at", getStaleCutoffIso())
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("[JAM MEMBERS] fetch error:", error);

      if (!silent) {
        showSystemInfo("Members: błąd odczytu online.", "warn");
      }

      return;
    }

    jamMembersReady = true;

    const members = (data || []).map((row) => normalizeMemberRow(row));

    jamOnlineUsers = assignRolesAndQueueFromMembers(members);
    syncLocalUserFromMembers();

    await syncHostFieldsToRoomStateIfNeeded();

    renderJamState();
  } catch (error) {
    console.error("[JAM MEMBERS] fetch exception:", error);

    if (!silent) {
      showSystemInfo("Members: błąd połączenia.", "warn");
    }
  }
}

async function upsertCurrentMember(options = {}) {
  if (!jamSupabaseClient || !jamUser || !jamJoined) return false;

  const preserveJoinedAt = Boolean(options.preserveJoinedAt);
  const joinedAtValue =
    preserveJoinedAt && jamUser.joinedAt
      ? new Date(jamUser.joinedAt).toISOString()
      : new Date(jamUser.joinedAt || Date.now()).toISOString();

  const payload = {
    room_id: JAM_ROOM_ID,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    joined_at: joinedAtValue,
    last_seen_at: nowIso(),
    is_in_queue: Boolean(jamUser.isInQueue),
    queue_joined_at: jamUser.isInQueue && jamUser.queueJoinedAt
      ? new Date(jamUser.queueJoinedAt).toISOString()
      : null,
    is_performer: Boolean(isCurrentUserPerformer())
  };

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_members")
      .upsert(payload, {
        onConflict: "room_id,session_id"
      });

    if (error) {
      console.error("[JAM MEMBERS] upsert error:", error);
      showSystemInfo("Members: nie udało się zapisać obecności.", "warn");
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM MEMBERS] upsert exception:", error);
    showSystemInfo("Members: błąd zapisu obecności.", "warn");
    return false;
  }
}

async function updateCurrentMemberFields(fields = {}) {
  if (!jamSupabaseClient || !jamUser || !jamJoined) return false;

  const payload = {
    ...fields,
    last_seen_at: nowIso()
  };

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_members")
      .update(payload)
      .eq("room_id", JAM_ROOM_ID)
      .eq("session_id", JAM_SESSION_ID);

    if (error) {
      console.error("[JAM MEMBERS] update self error:", error);
      showSystemInfo("Members: nie udało się zmienić statusu.", "warn");
      return false;
    }

    await fetchJamMembers({
      silent: true
    });

    return true;
  } catch (error) {
    console.error("[JAM MEMBERS] update self exception:", error);
    showSystemInfo("Members: błąd zmiany statusu.", "warn");
    return false;
  }
}

async function updateMemberFieldsBySession(sessionId, fields = {}) {
  if (!jamSupabaseClient || !sessionId) return false;

  const payload = {
    ...fields,
    last_seen_at: nowIso()
  };

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_members")
      .update(payload)
      .eq("room_id", JAM_ROOM_ID)
      .eq("session_id", sessionId);

    if (error) {
      console.error("[JAM MEMBERS] update member error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM MEMBERS] update member exception:", error);
    return false;
  }
}

async function setAllMembersPerformerFalse() {
  if (!jamSupabaseClient) return false;

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_members")
      .update({
        is_performer: false
      })
      .eq("room_id", JAM_ROOM_ID);

    if (error) {
      console.error("[JAM MEMBERS] clear performers error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM MEMBERS] clear performers exception:", error);
    return false;
  }
}

async function setMemberPerformer(targetUser, active, options = {}) {
  if (!jamSupabaseClient || !targetUser || !targetUser.sessionId) {
    return false;
  }

  const addToQueue =
    options.addToQueue !== undefined
      ? Boolean(options.addToQueue)
      : true;

  const preserveQueue =
    options.preserveQueue !== undefined
      ? Boolean(options.preserveQueue)
      : true;

  const existingMember = getMemberBySessionId(targetUser.sessionId);

  const payload = {
    is_performer: Boolean(active),
    last_seen_at: nowIso()
  };

  if (active) {
    if (addToQueue) {
      payload.is_in_queue = true;
      payload.queue_joined_at =
        existingMember && existingMember.queueJoinedAt
          ? existingMember.queueJoinedAt
          : nowIso();
    } else if (!preserveQueue) {
      payload.is_in_queue = false;
      payload.queue_joined_at = null;
    }
  } else if (!preserveQueue) {
    payload.is_in_queue = false;
    payload.queue_joined_at = null;
  }

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_members")
      .update(payload)
      .eq("room_id", JAM_ROOM_ID)
      .eq("session_id", targetUser.sessionId);

    if (error) {
      console.error("[JAM MEMBERS] set performer error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM MEMBERS] set performer exception:", error);
    return false;
  }
}

async function deleteCurrentMember() {
  if (!jamSupabaseClient || !jamUser) return;

  try {
    await jamSupabaseClient
      .from("jam_room_members")
      .delete()
      .eq("room_id", JAM_ROOM_ID)
      .eq("session_id", JAM_SESSION_ID);
  } catch (error) {
    console.error("[JAM MEMBERS] delete self exception:", error);
  }
}

function startMembersHeartbeat() {
  stopMembersHeartbeat();

  jamMembersHeartbeatTimer = setInterval(() => {
    if (!jamJoined) return;

    upsertCurrentMember({
      preserveJoinedAt: true
    });
  }, JAM_MEMBERS_HEARTBEAT_MS);

  jamMembersResyncTimer = setInterval(() => {
    if (!jamJoined) return;

    fetchJamMembers({
      silent: true
    });
  }, JAM_MEMBERS_RESYNC_MS);
}

function stopMembersHeartbeat() {
  if (jamMembersHeartbeatTimer) {
    clearInterval(jamMembersHeartbeatTimer);
    jamMembersHeartbeatTimer = null;
  }

  if (jamMembersResyncTimer) {
    clearInterval(jamMembersResyncTimer);
    jamMembersResyncTimer = null;
  }
}

function subscribeJamMembers() {
  if (!jamSupabaseClient) return;

  if (jamMembersChannel) {
    try {
      jamSupabaseClient.removeChannel(jamMembersChannel);
    } catch (error) {
      console.error(error);
    }

    jamMembersChannel = null;
  }

  jamMembersChannel = jamSupabaseClient.channel(JAM_ROOM_MEMBERS_CHANNEL);

  jamMembersChannel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "jam_room_members",
        filter: `room_id=eq.${JAM_ROOM_ID}`
      },
      () => {
        fetchJamMembers({
          silent: true
        });
      }
    )
    .subscribe((status) => {
      console.log("[JAM MEMBERS] channel status:", status);
    });
}

// =======================
// ROOM STATE
// =======================

function applyRoomStateToLocalState(nextRoomState, options = {}) {
  if (!nextRoomState) return;

  const silent = Boolean(options.silent);
  const source = options.source || "room_state";

  const previousJamActive = Boolean(jamActive);
  const previousPerformerSessionId =
    jamCurrentPerformer && jamCurrentPerformer.sessionId
      ? jamCurrentPerformer.sessionId
      : null;

  jamRoomState = nextRoomState;
  jamRoomStateReady = true;

  const nextJamActive = Boolean(nextRoomState.jam_active);

  if (previousJamActive !== nextJamActive) {
    jamActive = nextJamActive;

    if (!silent) {
      showSystemInfo(
        jamActive
          ? `${source}: Jam LIVE.`
          : `${source}: Jam STOP.`,
        "success"
      );
    }
  }

  const nextPerformerSessionId =
    nextRoomState.current_performer_session_id || null;

  if (nextPerformerSessionId) {
    jamCurrentPerformer = {
      id: nextRoomState.current_performer_user_id || nextPerformerSessionId,
      userId: nextRoomState.current_performer_user_id || nextPerformerSessionId,
      sessionId: nextPerformerSessionId,
      nick: nextRoomState.current_performer_nick || "Performer",
      joinedAt: Date.now()
    };

    jamMicSource = nextRoomState.mic_source || "queue";
  } else {
    jamCurrentPerformer = null;
    jamMicSource = null;
  }

  const performerChanged = previousPerformerSessionId !== nextPerformerSessionId;

  if (performerChanged && !silent) {
    if (nextPerformerSessionId) {
      showSystemInfo(
        `${source}: mikrofon ma ${jamCurrentPerformer.nick}.`,
        "success"
      );
    } else {
      showSystemInfo(`${source}: mikrofon wyłączony.`);
    }
  }

  applyChatMessagesFromRoomState(nextRoomState.chat_json);

  syncLocalUserFromMembers();
  renderJamState();
}

async function fetchJamRoomState(options = {}) {
  if (!jamSupabaseClient) return;

  const silent = Boolean(options.silent);
  const reason = options.reason || "manual";

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .select("*")
      .eq("room_id", JAM_ROOM_STATE_ID)
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] fetch error:", error);

      if (!silent) {
        showSystemInfo("room_state: błąd odczytu.", "warn");
      }

      return;
    }

    applyRoomStateToLocalState(data, {
      silent: silent,
      source: reason
    });
  } catch (error) {
    console.error("[JAM ROOM_STATE] fetch exception:", error);

    if (!silent) {
      showSystemInfo("room_state: błąd połączenia.", "warn");
    }
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
          applyRoomStateToLocalState(payload.new, {
            silent: true,
            source: "room_state realtime"
          });
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

function startJamRoomStateAutoResync() {
  if (jamRoomStateResyncTimer) {
    clearInterval(jamRoomStateResyncTimer);
    jamRoomStateResyncTimer = null;
  }

  jamRoomStateResyncTimer = setInterval(() => {
    fetchJamRoomState({
      silent: true,
      reason: "interval"
    });
  }, JAM_ROOM_STATE_RESYNC_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchJamRoomState({
        silent: true,
        reason: "visibilitychange"
      });

      if (jamJoined) {
        upsertCurrentMember({
          preserveJoinedAt: true
        });

        fetchJamMembers({
          silent: true
        });
      }
    }
  });

  window.addEventListener("focus", () => {
    fetchJamRoomState({
      silent: true,
      reason: "focus"
    });

    if (jamJoined) {
      upsertCurrentMember({
        preserveJoinedAt: true
      });

      fetchJamMembers({
        silent: true
      });
    }
  });
}

async function syncHostFieldsToRoomStateIfNeeded() {
  if (!jamSupabaseClient || !jamRoomState || !jamOnlineUsers.length) {
    return;
  }

  const host = getEffectiveHost();

  if (!host) return;

  const currentHostSessionId = jamRoomState.host_session_id || null;

  if (currentHostSessionId === host.sessionId) {
    return;
  }

  if (!isCurrentUserHost()) {
    return;
  }

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update({
        host_session_id: host.sessionId,
        host_user_id: host.userId || host.id,
        host_nick: host.nick,
        updated_by_session_id: JAM_SESSION_ID,
        updated_by_nick: jamUser ? jamUser.nick : null,
        updated_at: nowIso()
      })
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] host sync error:", error);
      return;
    }

    jamRoomState = data;
    jamRoomStateReady = true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] host sync exception:", error);
  }
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

  const host = getEffectiveHost();

  try {
    const updatePayload = {
      jam_active: Boolean(nextJamActive),

      host_session_id: host ? host.sessionId : null,
      host_user_id: host ? (host.userId || host.id) : null,
      host_nick: host ? host.nick : null,

      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser.nick,
      updated_at: nowIso()
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

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "jam_active write"
    });

    showSystemInfo(
      nextJamActive
        ? "Jam wystartowany."
        : "Jam zakończony.",
      "success"
    );

    return true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] jam_active update exception:", error);
    showSystemInfo("room_state: błąd zapisu jam_active.", "warn");
    return false;
  }
}

async function saveCurrentPerformerToRoomState(targetUser, micSource) {
  if (!jamSupabaseClient || !targetUser) {
    return false;
  }

  try {
    const updatePayload = {
      current_performer_session_id: targetUser.sessionId || null,
      current_performer_user_id: targetUser.id || targetUser.userId || null,
      current_performer_nick: targetUser.nick || null,
      mic_source: micSource || null,

      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser ? jamUser.nick : null,
      updated_at: nowIso()
    };

    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(updatePayload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] performer update error:", error);
      showSystemInfo("room_state: nie udało się zapisać performera.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "performer write"
    });

    return true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] performer update exception:", error);
    showSystemInfo("room_state: błąd zapisu performera.", "warn");
    return false;
  }
}

async function clearCurrentPerformerInRoomState() {
  if (!jamSupabaseClient) {
    return false;
  }

  try {
    const updatePayload = {
      current_performer_session_id: null,
      current_performer_user_id: null,
      current_performer_nick: null,
      mic_source: null,

      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser ? jamUser.nick : null,
      updated_at: nowIso()
    };

    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(updatePayload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] performer clear error:", error);
      showSystemInfo("room_state: nie udało się wyczyścić performera.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "performer clear"
    });

    return true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] performer clear exception:", error);
    showSystemInfo("room_state: błąd czyszczenia performera.", "warn");
    return false;
  }
}

// =======================
// CHAT
// =======================

function normalizeChatMessage(rawMessage) {
  if (!rawMessage) return null;

  const id = sanitizeText(rawMessage.id || rawMessage.message_id || createMessageId(), 80);
  const author = sanitizeText(rawMessage.author || rawMessage.nick || "Anon", 28);
  const message = sanitizeText(rawMessage.message || rawMessage.text || "", 180);
  const sessionId = sanitizeText(rawMessage.session_id || rawMessage.sessionId || "", 80);
  const userId = sanitizeText(rawMessage.user_id || rawMessage.userId || "", 80);
  const createdAt = rawMessage.created_at || rawMessage.createdAt || nowIso();

  if (!message) {
    return null;
  }

  return {
    id,
    session_id: sessionId,
    user_id: userId,
    author,
    message,
    created_at: createdAt
  };
}

function normalizeChatMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages
    .map((message) => normalizeChatMessage(message))
    .filter(Boolean)
    .slice(-JAM_CHAT_MAX_MESSAGES);
}

function applyChatMessagesFromRoomState(rawMessages) {
  const normalizedMessages = normalizeChatMessages(rawMessages);

  const currentSignature = JSON.stringify(
    jamChatMessages.map((message) => message.id)
  );
  const nextSignature = JSON.stringify(
    normalizedMessages.map((message) => message.id)
  );

  if (currentSignature === nextSignature) {
    return;
  }

  jamChatMessages = normalizedMessages;
  jamChatKnownMessageIds = new Set(
    jamChatMessages.map((message) => message.id)
  );

  renderChatMessages();
}

function renderChatMessages() {
  if (!chatFeed) return;

  chatFeed.innerHTML = "";

  if (!jamChatMessages.length) {
    const row = createElement("div", "jam-chat-row");
    row.innerHTML = "<strong>System:</strong> Chat jest pusty.";
    chatFeed.appendChild(row);
    return;
  }

  jamChatMessages.forEach((message) => {
    appendChatMessageToFeed(message, false);
  });

  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function appendChatMessageToFeed(message, shouldScroll = true) {
  if (!chatFeed || !message) return;

  const cleanAuthor = sanitizeText(message.author || "Anon", 28) || "Anon";
  const cleanMessage = sanitizeText(message.message || "", 180);

  if (!cleanMessage) return;

  const row = createElement("div", "jam-chat-row");
  row.innerHTML = `<strong>${cleanAuthor}:</strong> ${cleanMessage}`;

  chatFeed.appendChild(row);

  if (shouldScroll) {
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }
}

async function saveChatMessagesToRoomState(messages) {
  if (!jamSupabaseClient) {
    showSystemInfo("Chat: brak połączenia Supabase.", "warn");
    return false;
  }

  try {
    const updatePayload = {
      chat_json: normalizeChatMessages(messages),
      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser ? jamUser.nick : null,
      updated_at: nowIso()
    };

    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(updatePayload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM ROOM_STATE] chat update error:", error);
      showSystemInfo("Chat: brak kolumny chat_json albo błąd zapisu.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "chat write"
    });

    return true;
  } catch (error) {
    console.error("[JAM ROOM_STATE] chat update exception:", error);
    showSystemInfo("Chat: błąd zapisu wiadomości.", "warn");
    return false;
  }
}

async function appendChatMessageToRoomState(messageObject) {
  const normalizedMessage = normalizeChatMessage(messageObject);

  if (!normalizedMessage) {
    return false;
  }

  const existingMessages = normalizeChatMessages(
    jamRoomState && Array.isArray(jamRoomState.chat_json)
      ? jamRoomState.chat_json
      : jamChatMessages
  );

  const withoutDuplicate = existingMessages.filter((message) => {
    return message.id !== normalizedMessage.id;
  });

  const nextMessages = [
    ...withoutDuplicate,
    normalizedMessage
  ].slice(-JAM_CHAT_MAX_MESSAGES);

  jamChatMessages = nextMessages;
  jamChatKnownMessageIds = new Set(
    jamChatMessages.map((message) => message.id)
  );
  renderChatMessages();

  return saveChatMessagesToRoomState(nextMessages);
}

async function clearChatInRoomState() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyczyścić chat.", "warn");
    return;
  }

  const confirmed = confirm("Wyczyścić chat dla wszystkich w Jam Roomie?");

  if (!confirmed) {
    return;
  }

  const saved = await saveChatMessagesToRoomState([]);

  if (saved) {
    jamChatMessages = [];
    jamChatKnownMessageIds = new Set();
    renderChatMessages();
    showSystemInfo("Chat wyczyszczony.", "success");

    const messageId = createMessageId();
    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("chat_clear", {
      message_id: messageId,
      session_id: JAM_SESSION_ID,
      user_id: jamUser ? jamUser.id : null,
      nick: jamUser ? jamUser.nick : "System",
      created_at: nowIso()
    });
  }
}

function ensureClearChatButton() {
  if (clearChatBtn) {
    return clearChatBtn;
  }

  const chatForm = qs(".jam-chat-form");

  if (!chatForm) {
    return null;
  }

  clearChatBtn = document.createElement("button");
  clearChatBtn.id = "clearJamChatBtn";
  clearChatBtn.className = "jam-btn jam-btn-danger";
  clearChatBtn.type = "button";
  clearChatBtn.innerText = "WYCZYŚĆ CHAT";

  chatForm.appendChild(clearChatBtn);

  return clearChatBtn;
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
      0% { transform: translateX(0) translateY(0) scale(1); }
      18% { transform: translateX(-4px) translateY(0) scale(1.01); }
      36% { transform: translateX(4px) translateY(0) scale(1.01); }
      54% { transform: translateX(-3px) translateY(0) scale(1.005); }
      72% { transform: translateX(3px) translateY(0) scale(1.005); }
      100% { transform: translateX(0) translateY(0) scale(1); }
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
// MODALS
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
            userId: user.userId,
            sessionId: user.sessionId,
            nick: user.nick,
            joinedAt: user.queueJoinedAt || user.joinedAt || Date.now()
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
// SUPABASE / REALTIME
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

function connectBroadcastChannel() {
  if (!jamSupabaseClient || jamBroadcastChannel) return;

  jamBroadcastChannel = jamSupabaseClient.channel(JAM_ROOM_CHANNEL, {
    config: {
      broadcast: {
        self: false
      }
    }
  });

  jamBroadcastChannel
    .on("broadcast", { event: "chat_message" }, ({ payload }) => {
      handleRealtimeChatMessage(payload);
    })
    .on("broadcast", { event: "chat_clear" }, ({ payload }) => {
      handleRealtimeChatClear(payload);
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
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        jamRealtimeReady = true;
        renderJamState();
      }

      if (status === "CHANNEL_ERROR") {
        jamRealtimeReady = false;
        showSystemInfo("Błąd połączenia realtime.", "warn");
        renderJamState();
      }

      if (status === "TIMED_OUT") {
        jamRealtimeReady = false;
        showSystemInfo("Realtime timeout — stan naprawi auto-resync.", "warn");
        renderJamState();
      }
    });
}

async function sendRealtimeBroadcast(eventName, payload) {
  if (!jamBroadcastChannel || !jamRealtimeReady) {
    return;
  }

  try {
    await jamBroadcastChannel.send({
      type: "broadcast",
      event: eventName,
      payload: payload
    });
  } catch (error) {
    console.error("[JAM BROADCAST] error:", error);
  }
}

function initRealtime() {
  if (!jamSupabaseClient) return;

  connectBroadcastChannel();
  subscribeJamRoomState();
  subscribeJamMembers();
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

  fetchJamRoomState({
    silent: true,
    reason: "chat broadcast"
  });
}

function handleRealtimeChatClear(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamRoomState({
    silent: true,
    reason: "chat clear broadcast"
  });
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

  fetchJamMembers({
    silent: true
  });
}

function handleRealtimeJamStatus(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamRoomState({
    silent: true,
    reason: "jam status broadcast"
  });
}

function handleRealtimePerformerStatus(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamRoomState({
    silent: true,
    reason: "performer status broadcast"
  });

  fetchJamMembers({
    silent: true
  });
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

function ensureOnlineCardLabels() {
  if (!onlineCard) return;

  let title = onlineCard.querySelector("h2");

  if (!title) {
    title = createElement("h2", "", "Online");
    onlineCard.prepend(title);
  } else if (!title.innerText.trim()) {
    title.innerText = "Online";
  }

  let label = onlineCard.querySelector(".jam-small-label");

  if (!label) {
    label = createElement("p", "jam-small-label", "Uczestnicy");

    if (title.nextSibling) {
      onlineCard.insertBefore(label, title.nextSibling);
    } else {
      onlineCard.appendChild(label);
    }
  } else if (!label.innerText.trim()) {
    label.innerText = "Uczestnicy";
  }
}

function renderOnlineUsers() {
  ensureOnlineCardLabels();

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

    setButtonBusyState(startJamBtn, disabled || !isCurrentUserHost());
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.innerText = isCurrentHostTakeoverActive()
      ? "WYŁĄCZ MIKROFON"
      : "PRZEJMIJ MIKROFON";

    setButtonBusyState(hostTakeMicBtn, disabled || !isCurrentUserHost());
  }

  if (clearChatBtn) {
    clearChatBtn.style.display = isCurrentUserHost()
      ? ""
      : "none";

    setButtonBusyState(clearChatBtn, disabled || !isCurrentUserHost());
  }

  setButtonBusyState(hostPassMicBtn, disabled || !isCurrentUserHost());
  setButtonBusyState(skipPerformerBtn, disabled || !isCurrentUserHost());
  setButtonBusyState(performerPassNextBtn, disabled || !isCurrentUserPerformer());
  setButtonBusyState(performerBackToListeningBtn, disabled || !isCurrentUserPerformer());
}

function updateStatusPills() {
  const statusPill = statusPills[0];
  const jamModePill = statusPills[1];
  const roomStatePill = statusPills[2];

  if (statusPill) {
    if (!jamJoined) {
      statusPill.innerHTML = "Status: <strong>Poza pokojem</strong>";
    } else if (jamActionLocked) {
      statusPill.innerHTML = "Status: <strong>Synchronizacja</strong>";
    } else if (jamMembersReady && jamRoomStateReady) {
      statusPill.innerHTML = "Status: <strong>Online</strong>";
    } else {
      statusPill.innerHTML = "Status: <strong>Łączenie</strong>";
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
// CHAT / REACTIONS
// =======================

function addChatMessage(author, message, type = "normal") {
  if (type === "system") {
    showSystemInfo(message || author || "Info");
    return;
  }

  const normalizedMessage = normalizeChatMessage({
    id: createMessageId(),
    session_id: "local",
    user_id: "local",
    author,
    message,
    created_at: nowIso()
  });

  if (!normalizedMessage) return;

  appendChatMessageToFeed(normalizedMessage);
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
  const createdAt = nowIso();

  const chatMessage = {
    id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    author: jamUser.nick,
    message: message,
    created_at: createdAt
  };

  jamSeenRealtimeMessageIds.add(messageId);
  chatInput.value = "";

  const saved = await appendChatMessageToRoomState(chatMessage);

  await sendRealtimeBroadcast("chat_message", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    message: message,
    created_at: createdAt,
    saved: saved
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
    created_at: nowIso()
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
  jamMembersReady = false;
  jamMicSource = null;
  jamHostTakeoverPreviousPerformer = null;

  if (jamUser) {
    jamUser.isInQueue = false;
    jamUser.isPerformer = false;
    jamUser.queueJoinedAt = 0;
    saveJamUser();
  }
}

async function joinRoom() {
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
  jamMicSource = null;
  jamHostTakeoverPreviousPerformer = null;

  jamUser.role = "Listener";
  jamUser.joinedAt = Date.now();
  jamUser.isInQueue = false;
  jamUser.isPerformer = false;
  jamUser.queueJoinedAt = 0;

  saveJamUser();

  showSystemInfo(`${jamUser.nick} dołącza do pokoju...`);

  if (!jamSupabaseClient) {
    showSystemInfo("Supabase niedostępny.", "warn");
    renderJamState();
    return;
  }

  await upsertCurrentMember({
    preserveJoinedAt: true
  });

  await fetchJamRoomState({
    silent: true,
    reason: "join"
  });

  await fetchJamMembers({
    silent: true
  });

  startMembersHeartbeat();

  renderJamState();
}

async function leaveRoom() {
  if (!jamJoined) {
    return;
  }

  const leavingNick = jamUser && jamUser.nick ? jamUser.nick : "Użytkownik";
  const wasPerformer = isCurrentUserPerformer();

  if (wasPerformer) {
    await clearCurrentPerformerInRoomState();
  }

  await deleteCurrentMember();

  jamJoined = false;

  stopMembersHeartbeat();
  resetLocalRoomState();

  await fetchJamMembers({
    silent: true
  });

  showSystemInfo(`${leavingNick} opuścił pokój.`);

  renderJamState();
}

function toggleRoom() {
  runLockedAction(async () => {
    if (jamJoined) {
      await leaveRoom();
    } else {
      await joinRoom();
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

  jamUser.isInQueue = true;
  jamUser.isPerformer = false;
  jamUser.queueJoinedAt = Date.now();
  jamMicRequested = true;

  saveJamUser();

  await updateCurrentMemberFields({
    is_in_queue: true,
    queue_joined_at: new Date(jamUser.queueJoinedAt).toISOString(),
    is_performer: false
  });

  await fetchJamMembers({
    silent: true
  });

  showSystemInfo(`${jamUser.nick} dołączył do kolejki mikrofonu.`, "success");

  if (jamActive && !jamCurrentPerformer) {
    const firstUser = getFirstQueueUser();

    if (firstUser) {
      await assignPerformer(firstUser, "Kolejka", {
        addToQueue: true,
        preserveQueue: true,
        micSource: "queue"
      });
    }
  }

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("queue_request", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    created_at: nowIso()
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

  const wasPerformer = isCurrentUserPerformer();
  const wasInQueue = Boolean(jamUser.isInQueue);

  jamMicRequested = false;

  jamUser.isPerformer = false;
  jamUser.isInQueue = false;
  jamUser.queueJoinedAt = 0;

  saveJamUser();

  await updateCurrentMemberFields({
    is_in_queue: false,
    queue_joined_at: null,
    is_performer: false
  });

  if (wasPerformer) {
    await clearCurrentPerformerInRoomState();
  }

  if (wasPerformer || wasInQueue || shouldBroadcast) {
    showSystemInfo(`${jamUser.nick} wrócił do słuchania.`);
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
      created_at: nowIso()
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

  await fetchJamMembers({
    silent: true
  });

  if (
    shouldBroadcast &&
    jamActive &&
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
  }

  saveJamUser();

  await updateCurrentMemberFields({
    is_in_queue: Boolean(jamUser.isInQueue),
    queue_joined_at: jamUser.isInQueue && jamUser.queueJoinedAt
      ? new Date(jamUser.queueJoinedAt).toISOString()
      : null,
    is_performer: Boolean(active)
  });
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

  await setAllMembersPerformerFalse();

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

  await setMemberPerformer(targetUser, true, {
    addToQueue: addToQueue,
    preserveQueue: preserveQueue
  });

  jamMicSource = micSource;

  jamCurrentPerformer = {
    id: targetUser.id || targetUser.userId,
    userId: targetUser.id || targetUser.userId,
    sessionId: targetUser.sessionId,
    nick: targetUser.nick,
    joinedAt: targetUser.joinedAt || Date.now()
  };

  await saveCurrentPerformerToRoomState(jamCurrentPerformer, micSource);

  if (micSource === "host_takeover") {
    showSystemInfo("Host przejął mikrofon.", "success");
  } else if (targetIsHost) {
    showSystemInfo(`${sourceLabel}: Host ma teraz głos.`, "success");
  } else {
    showSystemInfo(`${sourceLabel}: mikrofon przechodzi do ${targetUser.nick}.`, "success");
  }

  await fetchJamMembers({
    silent: true
  });

  renderJamState();

  const messageId = createMessageId();

  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: true,
    clear_all: true,
    add_to_queue: addToQueue,
    preserve_queue: preserveQueue,
    mic_source: micSource,
    session_id: targetUser.sessionId,
    user_id: targetUser.id || targetUser.userId,
    nick: targetUser.nick,
    created_at: nowIso()
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
          userId: jamCurrentPerformer.userId,
          sessionId: jamCurrentPerformer.sessionId,
          nick: jamCurrentPerformer.nick,
          joinedAt: jamCurrentPerformer.joinedAt || Date.now()
        }
      : null;

  await assignPerformer({
    id: jamUser.id,
    userId: jamUser.id,
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
    showSystemInfo("To nie jest awaryjne przejęcie mikrofonu.", "warn");
    return;
  }

  const restoreTarget = getRestorablePreviousPerformer();

  jamUser.isPerformer = false;
  jamMicRequested = Boolean(jamUser.isInQueue);

  saveJamUser();

  await updateCurrentMemberFields({
    is_performer: false
  });

  await clearCurrentPerformerInRoomState();

  showSystemInfo("Host wyłączył mikrofon.");

  if (jamActive && restoreTarget) {
    showSystemInfo(`Mikrofon wraca do ${restoreTarget.nick}.`, "success");

    await assignPerformer(restoreTarget, "Host", {
      addToQueue: true,
      preserveQueue: true,
      micSource: "queue"
    });

    jamHostTakeoverPreviousPerformer = null;
    return;
  }

  if (jamActive) {
    const fallbackUser = getFirstQueueUserExcept(JAM_SESSION_ID);

    if (fallbackUser && sessionIsCurrentlyOnline(fallbackUser.sessionId)) {
      await assignPerformer(fallbackUser, "Host", {
        addToQueue: true,
        preserveQueue: true,
        micSource: "queue"
      });
    }
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
    if (!jamCurrentPerformer) {
      await fetchJamMembers({
        silent: true
      });

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
    await setAllMembersPerformerFalse();
    await clearCurrentPerformerInRoomState();
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
    created_at: nowIso()
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

  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", () => {
      clearChatInRoomState();
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
    if (jamJoined) {
      deleteCurrentMember();
    }
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
  initRealtime();

  fetchJamRoomState({
    silent: false,
    reason: "init"
  });

  fetchJamMembers({
    silent: true
  });

  startJamRoomStateAutoResync();

  ensureSpamModal();
  ensureInfoNotification();
  ensureHostPickMicModal();
  ensureClearChatButton();
  renderChatMessages();

  showSystemInfo("Jam Room gotowy.");

  bindJamEvents();
  renderJamState();
}

window.addEventListener("load", () => {
  initJamRoom();
});
