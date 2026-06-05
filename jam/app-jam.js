// =======================
// ETAP 55B-7B — CLEAN MERGE APP-JAM
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

const JAM_ACTION_LOCK_MS = 950;
const JAM_ACTION_MIN_INTERVAL_MS = 700;

const JAM_ACTION_COOLDOWNS = {
  join_leave: 1400,
  request_mic: 1600,
  confirm_mic: 1600,
  start_stop: 2200,
  pass_next: 1600,
  return_listening: 1700,
  host_takeover: 2200,
  host_pass_mic: 1600,
  skip: 2200,
  chat_clear: 2500,
  host_placeholder: 900
};

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
let jamActionCooldownUntil = {};
let jamReconcileInProgress = false;

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

function getActionCooldownRemaining(actionKey) {
  if (!actionKey) return 0;

  const until = Number(jamActionCooldownUntil[actionKey] || 0);

  return Math.max(0, until - Date.now());
}

function isActionCooling(actionKey) {
  return getActionCooldownRemaining(actionKey) > 0;
}

function isActionDisabled(actionKey) {
  return Boolean(jamActionLocked || isActionCooling(actionKey));
}

async function runLockedAction(action, label = "akcję", actionKey = "global") {
  const now = Date.now();
  const sinceLastAction = now - jamLastActionAt;
  const cooldownRemaining = getActionCooldownRemaining(actionKey);

  if (jamActionLocked) {
    showSystemInfo("Poczekaj chwilę — poprzednia akcja jeszcze się synchronizuje.", "warn");
    return;
  }

  if (cooldownRemaining > 0) {
    showSystemInfo("Poczekaj moment — stan pokoju jeszcze się wyrównuje.", "warn");
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
    const cooldownMs =
      JAM_ACTION_COOLDOWNS[actionKey] || JAM_ACTION_MIN_INTERVAL_MS;

    jamActionCooldownUntil[actionKey] = Date.now() + cooldownMs;

    setTimeout(() => {
      jamActionLocked = false;
      renderJamState();
    }, JAM_ACTION_LOCK_MS);

    setTimeout(() => {
      renderJamState();
    }, cooldownMs + 80);
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

  if (
    jamRoomState &&
    jamRoomState.host_session_id &&
    Array.isArray(jamOnlineUsers)
  ) {
    const roomStateHost = sortedMembers.find((user) => {
      return user.sessionId === jamRoomState.host_session_id;
    });

    if (roomStateHost) {
      return roomStateHost;
    }
  }

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

  const roomStateHostSessionId =
    jamRoomState && jamRoomState.host_session_id
      ? jamRoomState.host_session_id
      : null;

  const roomStateHostIsOnline =
    roomStateHostSessionId &&
    sortedMembers.some((member) => {
      return member.sessionId === roomStateHostSessionId;
    });

  const hostSessionId =
    roomStateHostIsOnline
      ? roomStateHostSessionId
      : sortedMembers.length > 0
        ? sortedMembers[0].sessionId
        : null;

  sortedMembers.forEach((member) => {
    const restriction = getActiveRestrictionForUserId55B6D(member.userId || member.id);
    const mutedActive = isRestrictionMutedActive55B6D(restriction);

    if (member.sessionId === hostSessionId) {
      member.role = "Host";
    } else if (mutedActive) {
      member.role = getMutedRoleLabel55B6D(restriction);
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
    .filter((member) => {
      const restriction = getActiveRestrictionForUserId55B6D(member.userId || member.id);
      const mutedActive = isRestrictionMutedActive55B6D(restriction);
      const kickedActive = isRestrictionKickActive55B6D(restriction);

      return member.isInQueue && !mutedActive && !kickedActive;
    })
    .sort((a, b) => {
      const aTime = memberQueueTime(a);
      const bTime = memberQueueTime(b);

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

    await reconcileRoomStateAfterMembersChange();
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

async function reconcileRoomStateAfterMembersChange() {
  if (
    jamReconcileInProgress ||
    !jamJoined ||
    !jamRoomStateReady ||
    !isCurrentUserHost()
  ) {
    return;
  }

  jamReconcileInProgress = true;

  try {
    if (jamCurrentPerformer && !sessionIsCurrentlyOnline(jamCurrentPerformer.sessionId)) {
      await setAllMembersPerformerFalse();
      await clearCurrentPerformerInRoomState();

      if (jamActive) {
        await fetchJamMembers({
          silent: true
        });

        const nextUser = getFirstQueueUser();

        if (nextUser) {
          await assignPerformer(nextUser, "Auto", {
            addToQueue: true,
            preserveQueue: true,
            micSource: "queue"
          });
        }
      }

      return;
    }

    if (
      jamActive &&
      jamCurrentPerformer &&
      jamMicSource !== "host_takeover"
    ) {
      const performerMember = getMemberBySessionId(jamCurrentPerformer.sessionId);

      if (!performerMember || !performerMember.isInQueue) {
        await setAllMembersPerformerFalse();
        await clearCurrentPerformerInRoomState();

        const nextUser =
          getFirstQueueUserExcept(jamCurrentPerformer.sessionId) ||
          getFirstQueueUser();

        if (nextUser && sessionIsCurrentlyOnline(nextUser.sessionId)) {
          await assignPerformer(nextUser, "Auto", {
            addToQueue: true,
            preserveQueue: true,
            micSource: "queue"
          });
        }
      }
    }
  } catch (error) {
    console.error("[JAM RECONCILE] error:", error);
  } finally {
    jamReconcileInProgress = false;
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
        }, "przekaż mikrofon", "host_pass_mic");
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
  subscribeJamRestrictions();
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

  if (payload.type === "kick" && targetMatchesCurrentUser55B6C(payload)) {
    const kickedUntil =
      payload.kicked_until ||
      new Date(Date.now() + JAM_DEFAULT_KICK_MS).toISOString();

    setLocalKick55B6C(kickedUntil, "kick");

    forceLeaveBecauseKicked55B6C(
      `Zostałeś wyrzucony z pokoju. Możesz wrócić za: ${jamFormatRestrictionTime(kickedUntil)}.`
    );

    return;
  }

  if (payload.type === "mute" && targetMatchesCurrentUser55B6C(payload)) {
    const mutedUntil =
      payload.muted_until ||
      new Date(Date.now() + JAM_DEFAULT_MUTE_MS).toISOString();

    setLocalMute55B6C(mutedUntil, "mute");

    showSystemInfo(
      `Masz MUTE. Nie możesz pisać, reagować ani prosić o mikrofon. Pozostało: ${jamFormatRestrictionTime(mutedUntil)}.`,
      "warn"
    );

    fetchJamRestrictions({ silent: true });
    return;
  }

  if (
    payload.type === "restriction_clear" &&
    jamUser &&
    payload.target_user_id === jamUser.id
  ) {
    const current = loadLocalRestrictions55B6C();

    if (payload.clear_type === "kick" || payload.clear_type === "all") {
      current.kicked_until = null;
    }

    if (payload.clear_type === "mute" || payload.clear_type === "all") {
      current.muted_until = null;
    }

    saveLocalRestrictions55B6C(current);

    fetchJamRestrictions({
      silent: true
    });

    showSystemInfo("Twoja blokada została cofnięta przez Hosta.", "success");

    return;
  }

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
// HOST PLACEHOLDERS / BASIC HOST ACTIONS
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
// HOST DEBUG PANEL
// =======================

let jamHostDebugBtn = null;
let jamHostDebugModal = null;
let jamHostDebugContent = null;
let jamHostDebugRefreshTimer = null;

function ensureHostDebugButton() {
  if (jamHostDebugBtn) {
    return jamHostDebugBtn;
  }

  const hostControls = document.querySelector(".jam-host-controls");

  if (!hostControls) {
    return null;
  }

  jamHostDebugBtn = document.createElement("button");
  jamHostDebugBtn.id = "jamHostDebugBtn";
  jamHostDebugBtn.className = "jam-btn";
  jamHostDebugBtn.type = "button";
  jamHostDebugBtn.innerText = "HOST DEBUG";

  hostControls.appendChild(jamHostDebugBtn);

  jamHostDebugBtn.addEventListener("click", () => {
    openHostDebugModal();
  });

  return jamHostDebugBtn;
}

function ensureHostDebugModal() {
  if (jamHostDebugModal) {
    return jamHostDebugModal;
  }

  jamHostDebugModal = document.createElement("div");
  jamHostDebugModal.id = "jamHostDebugModal";
  jamHostDebugModal.className = "jam-modal hidden";

  jamHostDebugModal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Host Debug</h2>

      <p>
        Panel diagnostyczny do testów Jam Roomu na kilku urządzeniach.
        Nie zmienia stanu pokoju — tylko pokazuje aktualne dane lokalne.
      </p>

      <pre id="jamHostDebugContent" style="
        white-space: pre-wrap;
        word-break: break-word;
        padding: 12px;
        border-radius: 12px;
        background: rgba(0,0,0,0.36);
        border: 1px solid rgba(234,162,33,0.22);
        color: rgba(255,255,255,0.88);
        font-family: monospace;
        font-size: 12px;
        line-height: 1.45;
        max-height: 46vh;
        overflow-y: auto;
      "></pre>

      <div class="jam-modal-actions">
        <button id="refreshHostDebugBtn" class="jam-btn jam-btn-primary" type="button">
          ODŚWIEŻ
        </button>

        <button id="closeHostDebugBtn" class="jam-btn" type="button">
          ZAMKNIJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamHostDebugModal);

  jamHostDebugContent = jamHostDebugModal.querySelector("#jamHostDebugContent");

  const refreshBtn = jamHostDebugModal.querySelector("#refreshHostDebugBtn");
  const closeBtn = jamHostDebugModal.querySelector("#closeHostDebugBtn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      updateHostDebugContent();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeHostDebugModal();
    });
  }

  jamHostDebugModal.addEventListener("click", (event) => {
    if (event.target === jamHostDebugModal) {
      closeHostDebugModal();
    }
  });

  return jamHostDebugModal;
}

function openHostDebugModal() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Host Debug jest dostępny tylko dla Hosta.", "warn");
    return;
  }

  ensureHostDebugModal();
  updateHostDebugContent();

  jamHostDebugModal.classList.remove("hidden");

  if (jamHostDebugRefreshTimer) {
    clearInterval(jamHostDebugRefreshTimer);
  }

  jamHostDebugRefreshTimer = setInterval(() => {
    updateHostDebugContent();
  }, 1500);
}

function closeHostDebugModal() {
  if (jamHostDebugModal) {
    jamHostDebugModal.classList.add("hidden");
  }

  if (jamHostDebugRefreshTimer) {
    clearInterval(jamHostDebugRefreshTimer);
    jamHostDebugRefreshTimer = null;
  }
}

function getHostDebugSnapshot() {
  const effectiveHost = getEffectiveHost ? getEffectiveHost() : null;

  return {
    local: {
      session_id: typeof JAM_SESSION_ID !== "undefined" ? JAM_SESSION_ID : null,
      user_id: jamUser ? jamUser.id : null,
      nick: jamUser ? jamUser.nick : null,
      joined: Boolean(jamJoined),
      is_host: typeof isCurrentUserHost === "function" ? isCurrentUserHost() : null,
      is_performer: typeof isCurrentUserPerformer === "function" ? isCurrentUserPerformer() : null,
      action_locked: Boolean(jamActionLocked)
    },

    room: {
      jam_active: Boolean(jamActive),
      room_state_ready: Boolean(jamRoomStateReady),
      members_ready: Boolean(jamMembersReady),
      realtime_ready: Boolean(jamRealtimeReady),
      mic_source: jamMicSource || null
    },

    host: effectiveHost
      ? {
          session_id: effectiveHost.sessionId,
          user_id: effectiveHost.userId || effectiveHost.id || null,
          nick: effectiveHost.nick
        }
      : null,
    performer: jamCurrentPerformer
      ? {
          session_id: jamCurrentPerformer.sessionId,
          user_id: jamCurrentPerformer.userId || jamCurrentPerformer.id || null,
          nick: jamCurrentPerformer.nick
        }
      : null,

    online_count: Array.isArray(jamOnlineUsers) ? jamOnlineUsers.length : 0,
    queue_count: Array.isArray(jamQueue) ? jamQueue.length : 0,

    online: Array.isArray(jamOnlineUsers)
      ? jamOnlineUsers.map((user) => ({
          nick: user.nick,
          role: user.role,
          session_id: user.sessionId,
          is_in_queue: Boolean(user.isInQueue),
          is_performer: Boolean(user.isPerformer),
          joined_at: user.joinedAt || null,
          queue_joined_at: user.queueJoinedAt || null,
          last_seen_at: user.lastSeenAt || null
        }))
      : [],

    queue: Array.isArray(jamQueue)
      ? jamQueue.map((user, index) => ({
          index: index + 1,
          nick: user.nick,
          session_id: user.sessionId,
          joined_at: user.joinedAt || null
        }))
      : [],

    room_state_raw: jamRoomState
      ? {
          room_id: jamRoomState.room_id || null,
          jam_active: jamRoomState.jam_active,
          host_session_id: jamRoomState.host_session_id,
          host_nick: jamRoomState.host_nick,
          current_performer_session_id: jamRoomState.current_performer_session_id,
          current_performer_nick: jamRoomState.current_performer_nick,
          mic_source: jamRoomState.mic_source,
          updated_by_nick: jamRoomState.updated_by_nick,
          updated_at: jamRoomState.updated_at
        }
      : null,

    restrictions: Array.isArray(jamRestrictions)
      ? jamRestrictions.map((restriction) => ({
          user_id: restriction.user_id,
          nick: restriction.nick,
          is_muted: restriction.is_muted,
          muted_until: restriction.muted_until,
          kicked_until: restriction.kicked_until,
          mute_active: isRestrictionMutedActive55B6D(restriction),
          kick_active: isRestrictionKickActive55B6D(restriction)
        }))
      : [],

    generated_at: new Date().toISOString()
  };
}

function updateHostDebugContent() {
  if (!jamHostDebugContent) {
    return;
  }

  const snapshot = getHostDebugSnapshot();

  jamHostDebugContent.textContent = JSON.stringify(snapshot, null, 2);
}

function updateHostDebugVisibility() {
  ensureHostDebugButton();

  if (!jamHostDebugBtn) {
    return;
  }

  jamHostDebugBtn.style.display = isCurrentUserHost() ? "" : "none";
}

// =======================
// TRANSFER HOST
// =======================

let jamTransferHostModal = null;
let jamTransferHostList = null;

function ensureTransferHostModal() {
  if (jamTransferHostModal) {
    return jamTransferHostModal;
  }

  jamTransferHostModal = document.createElement("div");
  jamTransferHostModal.id = "jamTransferHostModal";
  jamTransferHostModal.className = "jam-modal hidden";

  jamTransferHostModal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Przekaż Hosta</h2>

      <p>
        Wybierz osobę, która ma przejąć rolę Hosta. Po przekazaniu panel hosta
        pojawi się u wybranej osoby.
      </p>

      <div id="jamTransferHostList" class="jam-list"></div>

      <div class="jam-modal-actions">
        <button id="closeTransferHostModalBtn" class="jam-btn" type="button">
          ANULUJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamTransferHostModal);

  jamTransferHostList = jamTransferHostModal.querySelector("#jamTransferHostList");

  const closeBtn = jamTransferHostModal.querySelector("#closeTransferHostModalBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeTransferHostModal();
    });
  }

  jamTransferHostModal.addEventListener("click", (event) => {
    if (event.target === jamTransferHostModal) {
      closeTransferHostModal();
    }
  });

  return jamTransferHostModal;
}

function openTransferHostModal() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przekazać rolę Hosta.", "warn");
    return;
  }

  ensureTransferHostModal();
  renderTransferHostList();

  jamTransferHostModal.classList.remove("hidden");
}

function closeTransferHostModal() {
  if (jamTransferHostModal) {
    jamTransferHostModal.classList.add("hidden");
  }
}

function renderTransferHostList() {
  ensureTransferHostModal();

  if (!jamTransferHostList) {
    return;
  }

  jamTransferHostList.innerHTML = "";

  const candidates = jamOnlineUsers.filter((user) => {
    return user.sessionId !== JAM_SESSION_ID;
  });

  if (!candidates.length) {
    const emptyRow = createElement(
      "div",
      "jam-user-row",
      "Brak innych osób online"
    );

    jamTransferHostList.appendChild(emptyRow);
    return;
  }

  candidates.forEach((user) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "jam-btn";
    row.style.width = "100%";
    row.style.justifyContent = "space-between";
    row.style.marginBottom = "8px";

    const performerLabel =
      jamCurrentPerformer && jamCurrentPerformer.sessionId === user.sessionId
        ? " — aktualnie performer"
        : "";

    row.innerText = `${user.nick} — ${user.role || "Listener"}${performerLabel}`;

    row.addEventListener("click", () => {
      runLockedAction(async () => {
        await transferHostToUser(user);
      }, "przekaż hosta", "host_placeholder");
    });

    jamTransferHostList.appendChild(row);
  });
}

async function transferHostToUser(targetUser) {
  if (!jamSupabaseClient || !targetUser) {
    showSystemInfo("Nie można przekazać Hosta — brak danych użytkownika.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przekazać rolę Hosta.", "warn");
    return;
  }

  if (targetUser.sessionId === JAM_SESSION_ID) {
    showSystemInfo("Już jesteś Hostem.", "warn");
    return;
  }

  const targetStillOnline = jamOnlineUsers.some((user) => {
    return user.sessionId === targetUser.sessionId;
  });

  if (!targetStillOnline) {
    showSystemInfo("Ta osoba nie jest już online.", "warn");
    await fetchJamMembers({ silent: true });
    renderTransferHostList();
    return;
  }

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update({
        host_session_id: targetUser.sessionId,
        host_user_id: targetUser.userId || targetUser.id || null,
        host_nick: targetUser.nick || "Host",
        updated_by_session_id: JAM_SESSION_ID,
        updated_by_nick: jamUser ? jamUser.nick : null,
        updated_at: nowIso()
      })
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM TRANSFER HOST] error:", error);
      showSystemInfo("Nie udało się przekazać Hosta.", "warn");
      return;
    }

    closeTransferHostModal();

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "transfer host"
    });

    await fetchJamMembers({
      silent: true
    });

    showSystemInfo(`Host przekazany: ${targetUser.nick}.`, "success");

    const messageId = createMessageId();
    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("jam_status", {
      message_id: messageId,
      type: "host_transfer",
      host_session_id: targetUser.sessionId,
      host_user_id: targetUser.userId || targetUser.id || null,
      host_nick: targetUser.nick || "Host",
      session_id: JAM_SESSION_ID,
      user_id: jamUser ? jamUser.id : null,
      nick: jamUser ? jamUser.nick : "Host",
      created_at: nowIso()
    });

    renderJamState();
  } catch (error) {
    console.error("[JAM TRANSFER HOST] exception:", error);
    showSystemInfo("Błąd przekazania Hosta.", "warn");
  }
}

// =======================
// RESTRICTIONS
// =======================

const JAM_RESTRICTIONS_CHANNEL = "spokultura_jam_room_restrictions_1";
const JAM_DEFAULT_MUTE_MS = 5 * 60 * 1000;
const JAM_DEFAULT_KICK_MS = 5 * 60 * 1000;
const JAM_LOCAL_RESTRICTIONS_KEY = "spokulturaJamLocalRestrictions";

let jamRestrictionsChannel = null;
let jamRestrictions = [];
let jamRestrictionsReady = false;

let jamKickModal = null;
let jamKickList = null;

let jamMuteModal = null;
let jamMuteList = null;

let jamRestrictionsManagerBtn = null;
let jamRestrictionsManagerModal = null;
let jamRestrictionsManagerList = null;

let jamRestrictionsRoleRefreshTimer55B6D = null;

function memberQueueTime(member) {
  if (member && member.queueJoinedAt) {
    return new Date(member.queueJoinedAt).getTime();
  }

  if (member && member.joinedAt) {
    return new Date(member.joinedAt).getTime();
  }

  return Date.now();
}

function jamRestrictionIsActiveUntil(value) {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() > Date.now();
}

function jamFormatRestrictionTime(value) {
  if (!value) {
    return "brak limitu";
  }

  const diffMs = new Date(value).getTime() - Date.now();

  if (diffMs <= 0) {
    return "wygasło";
  }

  return formatRemainingTime(diffMs);
}

function normalizeRestrictionRow(row) {
  return {
    room_id: row.room_id,
    user_id: row.user_id,
    nick: row.nick || "Użytkownik",
    is_muted: Boolean(row.is_muted),
    muted_until: row.muted_until || null,
    kicked_until: row.kicked_until || null,
    updated_by_session_id: row.updated_by_session_id || null,
    updated_by_nick: row.updated_by_nick || null,
    updated_at: row.updated_at || null
  };
}

function getActiveRestrictionForUserId55B6D(userId) {
  if (!userId || !Array.isArray(jamRestrictions)) {
    return null;
  }

  return jamRestrictions.find((restriction) => {
    return restriction.user_id === userId;
  }) || null;
}

function getRestrictionForUserId(userId) {
  return getActiveRestrictionForUserId55B6D(userId);
}

function isRestrictionMutedActive55B6D(restriction) {
  if (!restriction) {
    return false;
  }
  if (!restriction.is_muted) {
    return false;
  }

  if (!restriction.muted_until) {
    return true;
  }

  return jamRestrictionIsActiveUntil(restriction.muted_until);
}

function isRestrictionKickActive55B6D(restriction) {
  if (!restriction || !restriction.kicked_until) {
    return false;
  }

  return jamRestrictionIsActiveUntil(restriction.kicked_until);
}

function getMutedRoleLabel55B6D(restriction) {
  if (!restriction) {
    return "MUTED";
  }

  if (!restriction.muted_until) {
    return "MUTED";
  }

  return `MUTED — ${jamFormatRestrictionTime(restriction.muted_until)}`;
}

function getCurrentUserRestriction() {
  if (!jamUser) {
    return null;
  }

  return getRestrictionForUserId(jamUser.id);
}

function isCurrentUserMuted() {
  const restriction = getCurrentUserRestriction();

  if (!restriction) {
    return false;
  }

  return isRestrictionMutedActive55B6D(restriction);
}

function isCurrentUserKicked() {
  const restriction = getCurrentUserRestriction();

  if (!restriction) {
    return false;
  }

  return isRestrictionKickActive55B6D(restriction);
}

function getCurrentUserKickRemainingText() {
  const restriction = getCurrentUserRestriction();

  if (!restriction || !restriction.kicked_until) {
    return "";
  }

  return jamFormatRestrictionTime(restriction.kicked_until);
}

function getCurrentUserMuteRemainingText() {
  const restriction = getCurrentUserRestriction();

  if (!restriction || !restriction.muted_until) {
    return "";
  }

  return jamFormatRestrictionTime(restriction.muted_until);
}

function getActiveRestrictions() {
  return jamRestrictions.filter((restriction) => {
    const muteActive = isRestrictionMutedActive55B6D(restriction);
    const kickActive = isRestrictionKickActive55B6D(restriction);

    return muteActive || kickActive;
  });
}

function loadLocalRestrictions55B6C() {
  const raw = localStorage.getItem(JAM_LOCAL_RESTRICTIONS_KEY);

  if (!raw) {
    return {
      kicked_until: null,
      muted_until: null,
      last_reason: null
    };
  }

  try {
    const parsed = JSON.parse(raw);

    return {
      kicked_until: parsed.kicked_until || null,
      muted_until: parsed.muted_until || null,
      last_reason: parsed.last_reason || null
    };
  } catch (error) {
    return {
      kicked_until: null,
      muted_until: null,
      last_reason: null
    };
  }
}

function saveLocalRestrictions55B6C(nextState) {
  localStorage.setItem(
    JAM_LOCAL_RESTRICTIONS_KEY,
    JSON.stringify({
      kicked_until: nextState.kicked_until || null,
      muted_until: nextState.muted_until || null,
      last_reason: nextState.last_reason || null
    })
  );
}

function setLocalKick55B6C(untilIso, reason = "kick") {
  const current = loadLocalRestrictions55B6C();

  current.kicked_until = untilIso;
  current.last_reason = reason;

  saveLocalRestrictions55B6C(current);
}

function setLocalMute55B6C(untilIso, reason = "mute") {
  const current = loadLocalRestrictions55B6C();

  current.muted_until = untilIso;
  current.last_reason = reason;

  saveLocalRestrictions55B6C(current);
}

function clearExpiredLocalRestrictions55B6C() {
  const current = loadLocalRestrictions55B6C();
  let changed = false;

  if (
    current.kicked_until &&
    new Date(current.kicked_until).getTime() <= Date.now()
  ) {
    current.kicked_until = null;
    changed = true;
  }

  if (
    current.muted_until &&
    new Date(current.muted_until).getTime() <= Date.now()
  ) {
    current.muted_until = null;
    changed = true;
  }

  if (changed) {
    saveLocalRestrictions55B6C(current);
  }

  return current;
}

function isCurrentUserLocallyKicked55B6C() {
  const current = clearExpiredLocalRestrictions55B6C();

  if (!current.kicked_until) {
    return false;
  }

  return new Date(current.kicked_until).getTime() > Date.now();
}

function isCurrentUserLocallyMuted55B6C() {
  const current = clearExpiredLocalRestrictions55B6C();

  if (!current.muted_until) {
    return false;
  }

  return new Date(current.muted_until).getTime() > Date.now();
}

function getLocalKickRemainingText55B6C() {
  const current = clearExpiredLocalRestrictions55B6C();

  if (!current.kicked_until) {
    return "";
  }

  return jamFormatRestrictionTime(current.kicked_until);
}

function getLocalMuteRemainingText55B6C() {
  const current = clearExpiredLocalRestrictions55B6C();

  if (!current.muted_until) {
    return "";
  }

  return jamFormatRestrictionTime(current.muted_until);
}

function targetMatchesCurrentUser55B6C(payload) {
  if (!payload || !jamUser) {
    return false;
  }

  const targetUserId = payload.target_user_id || null;
  const targetSessionId = payload.target_session_id || null;

  return Boolean(
    targetUserId === jamUser.id ||
    targetSessionId === JAM_SESSION_ID
  );
}

async function forceLeaveBecauseKicked55B6C(message) {
  showSystemInfo(message, "warn");

  if (jamJoined) {
    try {
      await deleteCurrentMember();
    } catch (error) {
      console.error("[JAM KICK FIX] delete member error:", error);
    }

    jamJoined = false;

    stopMembersHeartbeat();
    resetLocalRoomState();

    renderJamState();
  }
}

async function fetchJamRestrictions(options = {}) {
  if (!jamSupabaseClient) {
    return;
  }

  const silent = Boolean(options.silent);

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_restrictions")
      .select("*")
      .eq("room_id", JAM_ROOM_ID);

    if (error) {
      console.error("[JAM RESTRICTIONS] fetch error:", error);

      if (!silent) {
        showSystemInfo("Restrictions: błąd odczytu.", "warn");
      }

      return;
    }

    jamRestrictions = (data || []).map((row) => {
      return normalizeRestrictionRow(row);
    });

    jamRestrictionsReady = true;

    await enforceCurrentUserRestriction();

    await reconcileMutedUsers55B6D();

    if (jamJoined) {
      await fetchJamMembers({
        silent: true
      });
    }

    renderJamState();

    if (
      jamRestrictionsManagerModal &&
      !jamRestrictionsManagerModal.classList.contains("hidden")
    ) {
      renderRestrictionsManagerList();
    }
  } catch (error) {
    console.error("[JAM RESTRICTIONS] fetch exception:", error);

    if (!silent) {
      showSystemInfo("Restrictions: błąd połączenia.", "warn");
    }
  }
}

function subscribeJamRestrictions() {
  if (!jamSupabaseClient) {
    return;
  }

  if (jamRestrictionsChannel) {
    try {
      jamSupabaseClient.removeChannel(jamRestrictionsChannel);
    } catch (error) {
      console.error(error);
    }

    jamRestrictionsChannel = null;
  }

  jamRestrictionsChannel = jamSupabaseClient.channel(JAM_RESTRICTIONS_CHANNEL);

  jamRestrictionsChannel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "jam_room_restrictions",
        filter: `room_id=eq.${JAM_ROOM_ID}`
      },
      () => {
        fetchJamRestrictions({
          silent: true
        });
      }
    )
    .subscribe((status) => {
      console.log("[JAM RESTRICTIONS] channel status:", status);
    });
}

async function enforceCurrentUserRestriction() {
  if (!jamUser) {
    return;
  }

  if (isCurrentUserKicked() || isCurrentUserLocallyKicked55B6C()) {
    const dbRemaining = getCurrentUserKickRemainingText();
    const localRemaining = getLocalKickRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Zostałeś wyrzucony z pokoju. Możesz wrócić za: ${remaining}.`,
      "warn"
    );

    if (jamJoined) {
      await deleteCurrentMember();

      jamJoined = false;

      stopMembersHeartbeat();
      resetLocalRoomState();

      renderJamState();
    }

    return;
  }

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Nie możesz pisać, reagować ani prosić o mikrofon. Pozostało: ${remaining}.`,
      "warn"
    );
  }
}

async function setUserRestriction(targetUser, patch) {
  if (!jamSupabaseClient || !targetUser) {
    showSystemInfo("Brak danych użytkownika.", "warn");
    return false;
  }

  try {
    const payload = {
      room_id: JAM_ROOM_ID,
      user_id: targetUser.userId || targetUser.id,
      nick: targetUser.nick || "Użytkownik",

      is_muted: Boolean(patch.is_muted),
      muted_until: patch.muted_until || null,
      kicked_until: patch.kicked_until || null,

      updated_by_session_id: JAM_SESSION_ID,
      updated_by_nick: jamUser ? jamUser.nick : null,
      updated_at: nowIso()
    };

    const existing = getRestrictionForUserId(payload.user_id);

    if (existing) {
      payload.is_muted =
        patch.is_muted !== undefined
          ? Boolean(patch.is_muted)
          : Boolean(existing.is_muted);

      payload.muted_until =
        patch.muted_until !== undefined
          ? patch.muted_until
          : existing.muted_until;

      payload.kicked_until =
        patch.kicked_until !== undefined
          ? patch.kicked_until
          : existing.kicked_until;
    }

    const { error } = await jamSupabaseClient
      .from("jam_room_restrictions")
      .upsert(payload, {
        onConflict: "room_id,user_id"
      });

    if (error) {
      console.error("[JAM RESTRICTIONS] upsert error:", error);
      showSystemInfo("Nie udało się zapisać ograniczenia.", "warn");
      return false;
    }

    await fetchJamRestrictions({
      silent: true
    });

    return true;
  } catch (error) {
    console.error("[JAM RESTRICTIONS] upsert exception:", error);
    showSystemInfo("Błąd zapisu ograniczenia.", "warn");
    return false;
  }
}

async function clearUserRestriction(userId, type = "all") {
  if (!jamSupabaseClient || !userId) {
    return false;
  }

  const existing = getRestrictionForUserId(userId);

  if (!existing) {
    showSystemInfo("Ta osoba nie ma aktywnej blokady.", "warn");
    return false;
  }

  const payload = {
    updated_by_session_id: JAM_SESSION_ID,
    updated_by_nick: jamUser ? jamUser.nick : null,
    updated_at: nowIso()
  };

  if (type === "mute") {
    payload.is_muted = false;
    payload.muted_until = null;
  } else if (type === "kick") {
    payload.kicked_until = null;
  } else {
    payload.is_muted = false;
    payload.muted_until = null;
    payload.kicked_until = null;
  }

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_restrictions")
      .update(payload)
      .eq("room_id", JAM_ROOM_ID)
      .eq("user_id", userId);

    if (error) {
      console.error("[JAM RESTRICTIONS] clear error:", error);
      showSystemInfo("Nie udało się cofnąć blokady.", "warn");
      return false;
    }

    if (jamUser && userId === jamUser.id) {
      const current = loadLocalRestrictions55B6C();

      if (type === "kick" || type === "all") {
        current.kicked_until = null;
      }

      if (type === "mute" || type === "all") {
        current.muted_until = null;
      }

      saveLocalRestrictions55B6C(current);
    }

    const messageId = createMessageId();
    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("jam_status", {
      message_id: messageId,
      type: "restriction_clear",
      clear_type: type,
      target_user_id: userId,
      session_id: JAM_SESSION_ID,
      user_id: jamUser ? jamUser.id : null,
      nick: jamUser ? jamUser.nick : "Host",
      created_at: nowIso()
    });

    await fetchJamRestrictions({
      silent: true
    });

    showSystemInfo("Blokada cofnięta.", "success");
    return true;
  } catch (error) {
    console.error("[JAM RESTRICTIONS] clear exception:", error);
    showSystemInfo("Błąd cofania blokady.", "warn");
    return false;
  }
}

async function kickUser(targetUser) {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyrzucać z pokoju.", "warn");
    return;
  }

  if (!targetUser || targetUser.sessionId === JAM_SESSION_ID) {
    showSystemInfo("Nie możesz wyrzucić samego siebie.", "warn");
    return;
  }

  const confirmed = confirm(`Wyrzucić ${targetUser.nick} z pokoju na 5 minut?`);

  if (!confirmed) {
    return;
  }

  const kickedUntil = new Date(Date.now() + JAM_DEFAULT_KICK_MS).toISOString();

  const saved = await setUserRestriction(targetUser, {
    kicked_until: kickedUntil
  });

  if (!saved) {
    return;
  }

  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === targetUser.sessionId
  ) {
    await clearCurrentPerformerInRoomState();
  }

  await updateMemberFieldsBySession(targetUser.sessionId, {
    is_in_queue: false,
    queue_joined_at: null,
    is_performer: false
  });

  try {
    await jamSupabaseClient
      .from("jam_room_members")
      .delete()
      .eq("room_id", JAM_ROOM_ID)
      .eq("session_id", targetUser.sessionId);
  } catch (error) {
    console.error("[JAM KICK] member delete error:", error);
  }

  closeKickModal();

  await fetchJamMembers({
    silent: true
  });

  showSystemInfo(`${targetUser.nick} został wyrzucony na 5 minut.`, "success");

  const messageId = createMessageId();
  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("jam_status", {
    message_id: messageId,
    type: "kick",
    kicked_until: kickedUntil,
    target_user_id: targetUser.userId || targetUser.id,
    target_session_id: targetUser.sessionId,
    target_nick: targetUser.nick,
    session_id: JAM_SESSION_ID,
    user_id: jamUser ? jamUser.id : null,
    nick: jamUser ? jamUser.nick : "Host",
    created_at: nowIso()
  });

  renderJamState();
}

async function muteUser(targetUser) {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może dawać MUTE.", "warn");
    return;
  }

  if (!targetUser || targetUser.sessionId === JAM_SESSION_ID) {
    showSystemInfo("Nie możesz zmutować samego siebie.", "warn");
    return;
  }

  const confirmed = confirm(`Dać MUTE użytkownikowi ${targetUser.nick} na 5 minut?`);

  if (!confirmed) {
    return;
  }

  const mutedUntil = new Date(Date.now() + JAM_DEFAULT_MUTE_MS).toISOString();

  const saved = await setUserRestriction(targetUser, {
    is_muted: true,
    muted_until: mutedUntil
  });

  if (!saved) {
    return;
  }

  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === targetUser.sessionId
  ) {
    await clearCurrentPerformerInRoomState();
  }

  await updateMemberFieldsBySession(targetUser.sessionId, {
    is_in_queue: false,
    queue_joined_at: null,
    is_performer: false
  });

  closeMuteModal();

  await fetchJamMembers({
    silent: true
  });

  showSystemInfo(`${targetUser.nick} dostał MUTE na 5 minut.`, "success");

  const messageId = createMessageId();
  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("jam_status", {
    message_id: messageId,
    type: "mute",
    muted_until: mutedUntil,
    target_user_id: targetUser.userId || targetUser.id,
    target_session_id: targetUser.sessionId,
    target_nick: targetUser.nick,
    session_id: JAM_SESSION_ID,
    user_id: jamUser ? jamUser.id : null,
    nick: jamUser ? jamUser.nick : "Host",
    created_at: nowIso()
  });

  renderJamState();
}

// =======================
// KICK MODAL
// =======================

function ensureKickModal() {
  if (jamKickModal) {
    return jamKickModal;
  }

  jamKickModal = document.createElement("div");
  jamKickModal.id = "jamKickModal";
  jamKickModal.className = "jam-modal hidden";

  jamKickModal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Kick</h2>

      <p>
        Wybierz osobę, którą chcesz wyrzucić z pokoju na 5 minut.
      </p>

      <div id="jamKickList" class="jam-list"></div>

      <div class="jam-modal-actions">
        <button id="closeKickModalBtn" class="jam-btn" type="button">
          ANULUJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamKickModal);

  jamKickList = jamKickModal.querySelector("#jamKickList");

  const closeBtn = jamKickModal.querySelector("#closeKickModalBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeKickModal();
    });
  }

  jamKickModal.addEventListener("click", (event) => {
    if (event.target === jamKickModal) {
      closeKickModal();
    }
  });

  return jamKickModal;
}

function openKickModal() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyrzucać z pokoju.", "warn");
    return;
  }

  ensureKickModal();
  renderKickList();

  jamKickModal.classList.remove("hidden");
}

function closeKickModal() {
  if (jamKickModal) {
    jamKickModal.classList.add("hidden");
  }
}

function renderKickList() {
  ensureKickModal();

  if (!jamKickList) {
    return;
  }

  jamKickList.innerHTML = "";

  const candidates = jamOnlineUsers.filter((user) => {
    return user.sessionId !== JAM_SESSION_ID;
  });

  if (!candidates.length) {
    const emptyRow = createElement(
      "div",
      "jam-user-row",
      "Brak innych osób online"
    );

    jamKickList.appendChild(emptyRow);
    return;
  }

  candidates.forEach((user) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "jam-btn";
    row.style.width = "100%";
    row.style.justifyContent = "space-between";
    row.style.marginBottom = "8px";
    row.innerText = `${user.nick} — ${user.role || "Listener"}`;

    row.addEventListener("click", () => {
      runLockedAction(async () => {
        await kickUser(user);
      }, "kick", "host_placeholder");
    });

    jamKickList.appendChild(row);
  });
}

// =======================
// MUTE MODAL
// =======================

function ensureMuteModal() {
  if (jamMuteModal) {
    return jamMuteModal;
  }

  jamMuteModal = document.createElement("div");
  jamMuteModal.id = "jamMuteModal";
  jamMuteModal.className = "jam-modal hidden";

  jamMuteModal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Mute</h2>

      <p>
        Wybierz osobę, która ma dostać MUTE na 5 minut.
        MUTE blokuje chat, reakcje i prośbę o mikrofon.
      </p>

      <div id="jamMuteList" class="jam-list"></div>

      <div class="jam-modal-actions">
        <button id="closeMuteModalBtn" class="jam-btn" type="button">
          ANULUJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamMuteModal);

  jamMuteList = jamMuteModal.querySelector("#jamMuteList");

  const closeBtn = jamMuteModal.querySelector("#closeMuteModalBtn");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeMuteModal();
    });
  }

  jamMuteModal.addEventListener("click", (event) => {
    if (event.target === jamMuteModal) {
      closeMuteModal();
    }
  });

  return jamMuteModal;
}

function openMuteModal() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może dawać MUTE.", "warn");
    return;
  }

  ensureMuteModal();
  renderMuteList();

  jamMuteModal.classList.remove("hidden");
}

function closeMuteModal() {
  if (jamMuteModal) {
    jamMuteModal.classList.add("hidden");
  }
}

function renderMuteList() {
  ensureMuteModal();

  if (!jamMuteList) {
    return;
  }

  jamMuteList.innerHTML = "";

  const candidates = jamOnlineUsers.filter((user) => {
    return user.sessionId !== JAM_SESSION_ID;
  });

  if (!candidates.length) {
    const emptyRow = createElement(
      "div",
      "jam-user-row",
      "Brak innych osób online"
    );

    jamMuteList.appendChild(emptyRow);
    return;
  }

  candidates.forEach((user) => {
    const restriction = getRestrictionForUserId(user.userId || user.id);

    const mutedLabel =
      restriction &&
      restriction.is_muted &&
      (
        !restriction.muted_until ||
        jamRestrictionIsActiveUntil(restriction.muted_until)
      )
        ? ` — już mute: ${jamFormatRestrictionTime(restriction.muted_until)}`
        : "";

    const row = document.createElement("button");
    row.type = "button";
    row.className = "jam-btn";
    row.style.width = "100%";
    row.style.justifyContent = "space-between";
    row.style.marginBottom = "8px";
    row.innerText = `${user.nick} — ${user.role || "Listener"}${mutedLabel}`;

    row.addEventListener("click", () => {
      runLockedAction(async () => {
        await muteUser(user);
      }, "mute", "host_placeholder");
    });

    jamMuteList.appendChild(row);
  });
}

// =======================
// RESTRICTIONS MANAGER MODAL
// =======================

function ensureRestrictionsManagerButton() {
  if (jamRestrictionsManagerBtn) {
    return jamRestrictionsManagerBtn;
  }

  const hostControls = document.querySelector(".jam-host-controls");

  if (!hostControls) {
    return null;
  }

  jamRestrictionsManagerBtn = document.createElement("button");
  jamRestrictionsManagerBtn.id = "jamRestrictionsManagerBtn";
  jamRestrictionsManagerBtn.className = "jam-btn";
  jamRestrictionsManagerBtn.type = "button";
  jamRestrictionsManagerBtn.innerText = "BLOKADY";

  hostControls.appendChild(jamRestrictionsManagerBtn);

  jamRestrictionsManagerBtn.addEventListener("click", () => {
    openRestrictionsManagerModal();
  });

  return jamRestrictionsManagerBtn;
}

function ensureRestrictionsManagerModal() {
  if (jamRestrictionsManagerModal) {
    return jamRestrictionsManagerModal;
  }

  jamRestrictionsManagerModal = document.createElement("div");
  jamRestrictionsManagerModal.id = "jamRestrictionsManagerModal";
  jamRestrictionsManagerModal.className = "jam-modal hidden";

  jamRestrictionsManagerModal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Blokady</h2>

      <p>
        Lista osób z aktywnym MUTE albo KICK. Host może cofnąć blokadę,
        jeśli została nadana przez pomyłkę.
      </p>

      <div id="jamRestrictionsManagerList" class="jam-list"></div>

      <div class="jam-modal-actions">
        <button id="refreshRestrictionsManagerBtn" class="jam-btn jam-btn-primary" type="button">
          ODŚWIEŻ
        </button>

        <button id="closeRestrictionsManagerBtn" class="jam-btn" type="button">
          ZAMKNIJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamRestrictionsManagerModal);

  jamRestrictionsManagerList =
    jamRestrictionsManagerModal.querySelector("#jamRestrictionsManagerList");

  const refreshBtn =
    jamRestrictionsManagerModal.querySelector("#refreshRestrictionsManagerBtn");

  const closeBtn =
    jamRestrictionsManagerModal.querySelector("#closeRestrictionsManagerBtn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchJamRestrictions({
        silent: true
      });
      renderRestrictionsManagerList();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeRestrictionsManagerModal();
    });
  }

  jamRestrictionsManagerModal.addEventListener("click", (event) => {
    if (event.target === jamRestrictionsManagerModal) {
      closeRestrictionsManagerModal();
    }
  });

  return jamRestrictionsManagerModal;
}
function openRestrictionsManagerModal() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może zarządzać blokadami.", "warn");
    return;
  }

  ensureRestrictionsManagerModal();

  fetchJamRestrictions({
    silent: true
  });

  renderRestrictionsManagerList();

  jamRestrictionsManagerModal.classList.remove("hidden");
}

function closeRestrictionsManagerModal() {
  if (jamRestrictionsManagerModal) {
    jamRestrictionsManagerModal.classList.add("hidden");
  }
}

function renderRestrictionsManagerList() {
  ensureRestrictionsManagerModal();

  if (!jamRestrictionsManagerList) {
    return;
  }

  jamRestrictionsManagerList.innerHTML = "";

  const activeRestrictions = getActiveRestrictions();

  if (!activeRestrictions.length) {
    const emptyRow = createElement(
      "div",
      "jam-user-row",
      "Brak aktywnych blokad"
    );

    jamRestrictionsManagerList.appendChild(emptyRow);
    return;
  }

  activeRestrictions.forEach((restriction) => {
    const card = document.createElement("div");
    card.className = "jam-user-row";
    card.style.flexDirection = "column";
    card.style.alignItems = "stretch";
    card.style.gap = "8px";

    const title = document.createElement("strong");
    title.innerText = restriction.nick || restriction.user_id;

    const details = document.createElement("div");
    details.style.fontSize = "13px";
    details.style.opacity = "0.85";

    const muteActive = isRestrictionMutedActive55B6D(restriction);
    const kickActive = isRestrictionKickActive55B6D(restriction);

    const lines = [];

    if (muteActive) {
      lines.push(`MUTE: ${jamFormatRestrictionTime(restriction.muted_until)}`);
    }

    if (kickActive) {
      lines.push(`KICK: ${jamFormatRestrictionTime(restriction.kicked_until)}`);
    }

    if (restriction.updated_by_nick) {
      lines.push(`Nadał: ${restriction.updated_by_nick}`);
    }

    details.innerText = lines.join(" | ");

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";

    if (muteActive) {
      const unmuteBtn = document.createElement("button");
      unmuteBtn.type = "button";
      unmuteBtn.className = "jam-btn";
      unmuteBtn.innerText = "COFNIJ MUTE";

      unmuteBtn.addEventListener("click", () => {
        runLockedAction(async () => {
          await clearUserRestriction(restriction.user_id, "mute");
          renderRestrictionsManagerList();
        }, "cofnij mute", "host_placeholder");
      });

      actions.appendChild(unmuteBtn);
    }

    if (kickActive) {
      const unkickBtn = document.createElement("button");
      unkickBtn.type = "button";
      unkickBtn.className = "jam-btn";
      unkickBtn.innerText = "COFNIJ KICK";

      unkickBtn.addEventListener("click", () => {
        runLockedAction(async () => {
          await clearUserRestriction(restriction.user_id, "kick");
          renderRestrictionsManagerList();
        }, "cofnij kick", "host_placeholder");
      });

      actions.appendChild(unkickBtn);
    }

    const clearAllBtn = document.createElement("button");
    clearAllBtn.type = "button";
    clearAllBtn.className = "jam-btn jam-btn-danger";
    clearAllBtn.innerText = "COFNIJ WSZYSTKO";

    clearAllBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await clearUserRestriction(restriction.user_id, "all");
        renderRestrictionsManagerList();
      }, "cofnij blokady", "host_placeholder");
    });

    actions.appendChild(clearAllBtn);

    card.appendChild(title);
    card.appendChild(details);
    card.appendChild(actions);

    jamRestrictionsManagerList.appendChild(card);
  });
}

async function reconcileMutedUsers55B6D() {
  if (!jamJoined || !isCurrentUserHost()) {
    return;
  }

  const activeMutedRestrictions = jamRestrictions.filter((restriction) => {
    return isRestrictionMutedActive55B6D(restriction);
  });

  if (!activeMutedRestrictions.length) {
    return;
  }

  for (const restriction of activeMutedRestrictions) {
    const mutedMember = jamOnlineUsers.find((member) => {
      return member.userId === restriction.user_id || member.id === restriction.user_id;
    });

    if (!mutedMember) {
      continue;
    }

    if (mutedMember.isInQueue || mutedMember.isPerformer) {
      await updateMemberFieldsBySession(mutedMember.sessionId, {
        is_in_queue: false,
        queue_joined_at: null,
        is_performer: false
      });
    }

    if (
      jamCurrentPerformer &&
      jamCurrentPerformer.sessionId === mutedMember.sessionId
    ) {
      await clearCurrentPerformerInRoomState();
    }
  }

  await fetchJamMembers({
    silent: true
  });
}

function startMutedRoleRefresh55B6D() {
  if (jamRestrictionsRoleRefreshTimer55B6D) {
    clearInterval(jamRestrictionsRoleRefreshTimer55B6D);
  }

  jamRestrictionsRoleRefreshTimer55B6D = setInterval(() => {
    const hasActiveMute = jamRestrictions.some((restriction) => {
      return isRestrictionMutedActive55B6D(restriction);
    });

    if (hasActiveMute) {
      fetchJamRestrictions({
        silent: true
      });
    } else {
      renderJamState();
    }
  }, 10000);
}

function clearLocalMuteIfDbMuteExpired55B6D() {
  if (isCurrentUserMuted()) {
    return;
  }

  if (!isCurrentUserLocallyMuted55B6C()) {
    return;
  }

  const current = loadLocalRestrictions55B6C();
  current.muted_until = null;
  saveLocalRestrictions55B6C(current);
}

// =======================
// RESTRICTION ENFORCEMENT WRAPPERS
// =======================

const originalJoinRoom55B7 = joinRoom;

joinRoom = async function joinRoomWithRestrictionChecks55B7() {
  await fetchJamRestrictions({
    silent: true
  });

  const dbKickActive = isCurrentUserKicked();
  const localKickActive = isCurrentUserLocallyKicked55B6C();

  if (dbKickActive) {
    const remaining = getCurrentUserKickRemainingText() || "chwilę";

    showSystemInfo(
      `Nie możesz wejść do pokoju. KICK aktywny jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

  if (!dbKickActive && localKickActive) {
    const current = loadLocalRestrictions55B6C();
    current.kicked_until = null;
    saveLocalRestrictions55B6C(current);
  }

  await originalJoinRoom55B7();
};

const originalSendLocalChatMessage55B7 = sendLocalChatMessage;

sendLocalChatMessage = async function sendLocalChatMessageWithRestrictionChecks55B7() {
  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();

    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Chat zablokowany jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

  await originalSendLocalChatMessage55B7();
};

const originalAddReaction55B7 = addReaction;

addReaction = async function addReactionWithRestrictionChecks55B7(reaction) {
  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();

    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Reakcje zablokowane jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

  await originalAddReaction55B7(reaction);
};

const originalRequestMicrophone55B7 = requestMicrophone;

requestMicrophone = function requestMicrophoneWithRestrictionChecks55B7() {
  runLockedAction(async () => {
    await fetchJamRestrictions({
      silent: true
    });

    clearLocalMuteIfDbMuteExpired55B6D();

    if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
      const dbRemaining = getCurrentUserMuteRemainingText();
      const localRemaining = getLocalMuteRemainingText55B6C();

      const remaining = dbRemaining || localRemaining || "chwilę";

      showSystemInfo(
        `Masz MUTE. Mikrofon zablokowany jeszcze: ${remaining}.`,
        "warn"
      );

      return;
    }

    if (!jamJoined) {
      showSystemInfo("Najpierw dołącz do pokoju.", "warn");
      return;
    }

    if (isCurrentUserPerformer() || (jamUser && jamUser.isInQueue)) {
      await returnToListening(true);
      return;
    }

    openHeadphonesModal();
  }, "prośba o mikrofon", "request_mic");
};

// =======================
// FINAL RENDER ADDONS
// =======================

const originalRenderJamState55B7 = renderJamState;

renderJamState = function renderJamStateWithFinalAddons55B7() {
  originalRenderJamState55B7();

  updateHostDebugVisibility();
  ensureRestrictionsManagerButton();

  if (clearChatBtn) {
    clearChatBtn.style.display = isCurrentUserHost() ? "" : "none";
    clearChatBtn.disabled =
      isActionDisabled("chat_clear") || !isCurrentUserHost();
    clearChatBtn.classList.toggle("jam-btn-muted", clearChatBtn.disabled);
  }

  if (startJamBtn) {
    startJamBtn.disabled =
      isActionDisabled("start_stop") || !isCurrentUserHost();
    startJamBtn.classList.toggle("jam-btn-muted", startJamBtn.disabled);
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.disabled =
      isActionDisabled("host_takeover") || !isCurrentUserHost();
    hostTakeMicBtn.classList.toggle("jam-btn-muted", hostTakeMicBtn.disabled);
  }

  if (hostPassMicBtn) {
    hostPassMicBtn.disabled =
      isActionDisabled("host_pass_mic") || !isCurrentUserHost();
    hostPassMicBtn.classList.toggle("jam-btn-muted", hostPassMicBtn.disabled);
  }

  if (skipPerformerBtn) {
    skipPerformerBtn.disabled =
      isActionDisabled("skip") || !isCurrentUserHost();
    skipPerformerBtn.classList.toggle("jam-btn-muted", skipPerformerBtn.disabled);
  }

  if (transferHostBtn) {
    transferHostBtn.disabled =
      isActionDisabled("host_placeholder") || !isCurrentUserHost();
    transferHostBtn.classList.toggle("jam-btn-muted", transferHostBtn.disabled);
  }

  if (kickBtn) {
    kickBtn.disabled =
      isActionDisabled("host_placeholder") || !isCurrentUserHost();
    kickBtn.classList.toggle("jam-btn-muted", kickBtn.disabled);
  }

  if (muteBtn) {
    muteBtn.disabled =
      isActionDisabled("host_placeholder") || !isCurrentUserHost();
    muteBtn.classList.toggle("jam-btn-muted", muteBtn.disabled);
  }

  if (jamRestrictionsManagerBtn) {
    jamRestrictionsManagerBtn.style.display = isCurrentUserHost() ? "" : "none";
    jamRestrictionsManagerBtn.disabled =
      isActionDisabled("host_placeholder") || !isCurrentUserHost();

    jamRestrictionsManagerBtn.classList.toggle(
      "jam-btn-muted",
      jamRestrictionsManagerBtn.disabled
    );
  }

  if (
    jamHostDebugModal &&
    !jamHostDebugModal.classList.contains("hidden")
  ) {
    updateHostDebugContent();
  }

  if (
    jamTransferHostModal &&
    !jamTransferHostModal.classList.contains("hidden")
  ) {
    renderTransferHostList();
  }

  if (
    jamKickModal &&
    !jamKickModal.classList.contains("hidden")
  ) {
    renderKickList();
  }

  if (
    jamMuteModal &&
    !jamMuteModal.classList.contains("hidden")
  ) {
    renderMuteList();
  }

  if (
    jamRestrictionsManagerModal &&
    !jamRestrictionsManagerModal.classList.contains("hidden")
  ) {
    renderRestrictionsManagerList();
  }
};

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
      }, "przekaż dalej", "pass_next");
    });
  }

  if (performerBackToListeningBtn) {
    performerBackToListeningBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await returnToListening(true);
      }, "wróć do słuchania", "return_listening");
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", () => {
      sendLocalChatMessage();
    });
  }

  if (clearChatBtn) {
    clearChatBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await clearChatInRoomState();
      }, "wyczyść chat", "chat_clear");
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
      }, "start / zakończ jam", "start_stop");
    });
  }

  if (hostTakeMicBtn) {
    hostTakeMicBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await hostTakeMicrophone();
      }, "przejmij / wyłącz mikrofon", "host_takeover");
    });
  }

  if (hostPassMicBtn) {
    hostPassMicBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await hostPassMicrophoneNext();
      }, "przekaż mikrofon", "host_pass_mic");
    });
  }

  if (nextBeatBtn) {
    nextBeatBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        hostPlaceholder("NEXT BEAT");
      }, "next beat", "host_placeholder");
    });
  }

  if (skipPerformerBtn) {
    skipPerformerBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        await skipPerformerPlaceholder();
      }, "skip performer", "skip");
    });
  }

  if (transferHostBtn) {
    transferHostBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        openTransferHostModal();
      }, "przekaż hosta", "host_placeholder");
    });
  }

  if (kickBtn) {
    kickBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        openKickModal();
      }, "kick", "host_placeholder");
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      runLockedAction(async () => {
        openMuteModal();
      }, "mute", "host_placeholder");
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
      closeHostDebugModal();
      closeTransferHostModal();
      closeKickModal();
      closeMuteModal();
      closeRestrictionsManagerModal();
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
  jamActionCooldownUntil = {};
  jamReconcileInProgress = false;

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

  fetchJamRestrictions({
    silent: true
  });

  startJamRoomStateAutoResync();

  ensureSpamModal();
  ensureInfoNotification();
  ensureHostPickMicModal();
  ensureHostDebugModal();
  ensureHostDebugButton();
  ensureTransferHostModal();
  ensureKickModal();
  ensureMuteModal();
  ensureRestrictionsManagerModal();
  ensureRestrictionsManagerButton();
  ensureClearChatButton();
  renderChatMessages();

  startMutedRoleRefresh55B6D();

  showSystemInfo("Jam Room gotowy.");

  bindJamEvents();
  renderJamState();
}

window.addEventListener("load", () => {
  initJamRoom();
});

// =======================
// ETAP 55B-7C — CHAT CLEAR SYNC FIX
// Wyczyść chat ma czyścić u wszystkich użytkowników
// =======================

function forceRenderChatMessages55B7C(messages) {
  if (!chatFeed) return;

  const normalizedMessages = normalizeChatMessages(messages);

  jamChatMessages = normalizedMessages;
  jamChatKnownMessageIds = new Set(
    jamChatMessages.map((message) => message.id)
  );

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

// Nadpisujemy applyChatMessagesFromRoomState,
// żeby pusty chat_json zawsze wymuszał wyczyszczenie widoku.
applyChatMessagesFromRoomState = function applyChatMessagesFromRoomStateForce55B7C(rawMessages) {
  const normalizedMessages = normalizeChatMessages(rawMessages);

  if (!normalizedMessages.length) {
    forceRenderChatMessages55B7C([]);
    return;
  }

  const currentSignature = JSON.stringify(
    jamChatMessages.map((message) => message.id)
  );

  const nextSignature = JSON.stringify(
    normalizedMessages.map((message) => message.id)
  );

  if (currentSignature === nextSignature) {
    return;
  }

  forceRenderChatMessages55B7C(normalizedMessages);
};

// Nadpisujemy wysyłanie wiadomości:
// wiadomość zapisuje się do room_state.chat_json,
// więc nowa osoba po wejściu też widzi aktualny chat.
sendLocalChatMessage = async function sendLocalChatMessageSynced55B7C() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!chatInput) return;

  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Chat zablokowany jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

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
};

// Nadpisujemy czyszczenie:
// Host czyści chat_json i wysyła broadcast,
// a każdy klient wymusza lokalne wyczyszczenie widoku.
clearChatInRoomState = async function clearChatInRoomStateSynced55B7C() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyczyścić chat.", "warn");
    return;
  }

  const confirmed = confirm("Wyczyścić chat dla wszystkich w Jam Roomie?");

  if (!confirmed) {
    return;
  }

  const saved = await saveChatMessagesToRoomState([]);

  if (!saved) {
    showSystemInfo("Nie udało się wyczyścić chatu.", "warn");
    return;
  }

  forceRenderChatMessages55B7C([]);

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
};

// Nadpisujemy obsługę broadcastu chat_clear.
// Druga osoba nie tylko pobiera room_state,
// ale od razu czyści lokalny widok czatu.
handleRealtimeChatClear = function handleRealtimeChatClearSynced55B7C(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  forceRenderChatMessages55B7C([]);

  fetchJamRoomState({
    silent: true,
    reason: "chat clear broadcast"
  });
};

// Nadpisujemy obsługę broadcastu wiadomości,
// żeby po wiadomości każdy pobierał chat_json z room_state.
handleRealtimeChatMessage = function handleRealtimeChatMessageSynced55B7C(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamRoomState({
    silent: true,
    reason: "chat message broadcast"
  });
};

// =======================
// ETAP 55B-7D — CHAT PERSISTENCE FIX
// Chat nie może znikać po auto-resync, jeśli chat_json jest null/undefined
// =======================

function roomStateHasChatJson55B7D(roomState) {
  return Boolean(
    roomState &&
    Object.prototype.hasOwnProperty.call(roomState, "chat_json") &&
    Array.isArray(roomState.chat_json)
  );
}

// Nadpisujemy applyRoomStateToLocalState:
// chat aktualizujemy TYLKO jeśli room_state faktycznie ma tablicę chat_json.
// Jeśli chat_json jest null/undefined, nie czyścimy widoku.
const originalApplyRoomStateToLocalState55B7D = applyRoomStateToLocalState;

applyRoomStateToLocalState = function applyRoomStateToLocalStateChatSafe55B7D(nextRoomState, options = {}) {
  if (!nextRoomState) return;

  const hasValidChatJson = roomStateHasChatJson55B7D(nextRoomState);
  const savedChatJson = hasValidChatJson ? nextRoomState.chat_json : null;

  if (!hasValidChatJson) {
    nextRoomState = {
      ...nextRoomState,
      chat_json: jamChatMessages
    };
  }

  originalApplyRoomStateToLocalState55B7D(nextRoomState, options);

  if (hasValidChatJson) {
    applyChatMessagesFromRoomState(savedChatJson);
  }
};

// Nadpisujemy applyChatMessagesFromRoomState:
// undefined/null NIE czyści chatu.
// Pusta tablica [] czyści chat tylko wtedy, gdy przyszła świadomie z room_state.
applyChatMessagesFromRoomState = function applyChatMessagesFromRoomStateSafe55B7D(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return;
  }

  const normalizedMessages = normalizeChatMessages(rawMessages);

  if (!normalizedMessages.length) {
    forceRenderChatMessages55B7C([]);
    return;
  }

  const currentSignature = JSON.stringify(
    jamChatMessages.map((message) => message.id)
  );

  const nextSignature = JSON.stringify(
    normalizedMessages.map((message) => message.id)
  );

  if (currentSignature === nextSignature) {
    return;
  }

  forceRenderChatMessages55B7C(normalizedMessages);
};

// Nadpisujemy wysyłanie wiadomości jeszcze raz:
// najpierw zapis do chat_json, dopiero potem render/broadcast.
// Jeśli zapis się nie uda, nie udajemy że wiadomość jest trwała.
sendLocalChatMessage = async function sendLocalChatMessagePersistent55B7D() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!chatInput) return;

  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Chat zablokowany jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

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

  const existingMessages = Array.isArray(jamChatMessages)
    ? jamChatMessages
    : [];

  const nextMessages = [
    ...existingMessages,
    chatMessage
  ].slice(-JAM_CHAT_MAX_MESSAGES);

  const saved = await saveChatMessagesToRoomState(nextMessages);

  if (!saved) {
    showSystemInfo("Nie udało się zapisać wiadomości w room_state.", "warn");
    return;
  }

  jamSeenRealtimeMessageIds.add(messageId);
  chatInput.value = "";

  forceRenderChatMessages55B7C(nextMessages);

  await sendRealtimeBroadcast("chat_message", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    message: message,
    created_at: createdAt,
    saved: true
  });
};

// Po broadcastzie wiadomości pobieramy room_state, ale nie czyścimy lokalnie,
// jeśli Supabase chwilowo zwróci null/undefined.
handleRealtimeChatMessage = function handleRealtimeChatMessagePersistent55B7D(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamRoomState({
    silent: true,
    reason: "chat message broadcast"
  });
};

// Clear zostaje świadomy: tylko Host ustawia chat_json = []
// i wtedy wszyscy mają wyczyścić.
clearChatInRoomState = async function clearChatInRoomStatePersistent55B7D() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyczyścić chat.", "warn");
    return;
  }

  const confirmed = confirm("Wyczyścić chat dla wszystkich w Jam Roomie?");

  if (!confirmed) {
    return;
  }

  const saved = await saveChatMessagesToRoomState([]);

  if (!saved) {
    showSystemInfo("Nie udało się wyczyścić chatu.", "warn");
    return;
  }

  forceRenderChatMessages55B7C([]);

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
};

// =======================
// ETAP 55B-7E — CHAT TABLE FIX
// Chat przeniesiony z room_state.chat_json do osobnej tabeli jam_room_chat
// =======================

const JAM_CHAT_CHANNEL = "spokultura_jam_room_chat_1";

let jamChatChannel55B7E = null;
let jamChatTableReady55B7E = false;

// Wyłączamy aktualizowanie chatu z room_state,
// bo room_state.chat_json powodowało czyszczenie wiadomości po auto-resync.
applyChatMessagesFromRoomState = function applyChatMessagesFromRoomStateDisabled55B7E() {
  return;
};

function normalizeChatRow55B7E(row) {
  if (!row) return null;

  return {
    id: row.id || createMessageId(),
    session_id: row.session_id || "",
    user_id: row.user_id || "",
    author: row.nick || "Anon",
    message: row.message || "",
    created_at: row.created_at || nowIso()
  };
}

function sortChatMessages55B7E(messages) {
  return [...messages].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

async function fetchJamChatMessages55B7E(options = {}) {
  if (!jamSupabaseClient) return;

  const silent = Boolean(options.silent);

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_chat")
      .select("*")
      .eq("room_id", JAM_ROOM_ID)
      .order("created_at", { ascending: true })
      .limit(JAM_CHAT_MAX_MESSAGES);

    if (error) {
      console.error("[JAM CHAT TABLE] fetch error:", error);

      if (!silent) {
        showSystemInfo("Chat: błąd odczytu tabeli jam_room_chat.", "warn");
      }

      return;
    }

    jamChatTableReady55B7E = true;

    const messages = sortChatMessages55B7E(
      (data || [])
        .map((row) => normalizeChatRow55B7E(row))
        .filter(Boolean)
    );

    forceRenderChatMessages55B7C(messages);
  } catch (error) {
    console.error("[JAM CHAT TABLE] fetch exception:", error);

    if (!silent) {
      showSystemInfo("Chat: błąd połączenia z jam_room_chat.", "warn");
    }
  }
}

function subscribeJamChat55B7E() {
  if (!jamSupabaseClient) return;

  if (jamChatChannel55B7E) {
    try {
      jamSupabaseClient.removeChannel(jamChatChannel55B7E);
    } catch (error) {
      console.error(error);
    }

    jamChatChannel55B7E = null;
  }

  jamChatChannel55B7E = jamSupabaseClient.channel(JAM_CHAT_CHANNEL);

  jamChatChannel55B7E
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "jam_room_chat",
        filter: `room_id=eq.${JAM_ROOM_ID}`
      },
      () => {
        fetchJamChatMessages55B7E({
          silent: true
        });
      }
    )
    .subscribe((status) => {
      console.log("[JAM CHAT TABLE] channel status:", status);
    });
}

async function insertChatMessage55B7E(chatMessage) {
  if (!jamSupabaseClient || !chatMessage) return false;

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_chat")
      .insert({
        id: chatMessage.id,
        room_id: JAM_ROOM_ID,
        session_id: chatMessage.session_id,
        user_id: chatMessage.user_id,
        nick: chatMessage.author,
        message: chatMessage.message,
        created_at: chatMessage.created_at
      });

    if (error) {
      console.error("[JAM CHAT TABLE] insert error:", error);
      showSystemInfo("Chat: nie udało się zapisać wiadomości.", "warn");
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM CHAT TABLE] insert exception:", error);
    showSystemInfo("Chat: błąd zapisu wiadomości.", "warn");
    return false;
  }
}

async function clearChatTable55B7E() {
  if (!jamSupabaseClient) return false;

  try {
    const { error } = await jamSupabaseClient
      .from("jam_room_chat")
      .delete()
      .eq("room_id", JAM_ROOM_ID);

    if (error) {
      console.error("[JAM CHAT TABLE] clear error:", error);
      showSystemInfo("Chat: nie udało się wyczyścić tabeli.", "warn");
      return false;
    }

    return true;
  } catch (error) {
    console.error("[JAM CHAT TABLE] clear exception:", error);
    showSystemInfo("Chat: błąd czyszczenia tabeli.", "warn");
    return false;
  }
}

// Nadpisujemy wysyłanie wiadomości.
// Od teraz wiadomość trafia do jam_room_chat, a nie do room_state.chat_json.
sendLocalChatMessage = async function sendLocalChatMessageTable55B7E() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!chatInput) return;

  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Chat zablokowany jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

  const message = sanitizeText(chatInput.value, 120);

  if (!message) return;

  if (checkChatSpam(message)) return;

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

  const saved = await insertChatMessage55B7E(chatMessage);

  if (!saved) return;

  jamSeenRealtimeMessageIds.add(messageId);
  chatInput.value = "";

  // Render lokalny od razu.
  const nextMessages = sortChatMessages55B7E([
    ...(Array.isArray(jamChatMessages) ? jamChatMessages : []),
    chatMessage
  ]).slice(-JAM_CHAT_MAX_MESSAGES);

  forceRenderChatMessages55B7C(nextMessages);

  await sendRealtimeBroadcast("chat_message", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    message: message,
    created_at: createdAt,
    source: "jam_room_chat"
  });
};

// Nadpisujemy czyszczenie.
// Host kasuje rekordy z jam_room_chat, nie room_state.chat_json.
clearChatInRoomState = async function clearChatInRoomStateTable55B7E() {
  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może wyczyścić chat.", "warn");
    return;
  }

  const confirmed = confirm("Wyczyścić chat dla wszystkich w Jam Roomie?");

  if (!confirmed) return;

  const cleared = await clearChatTable55B7E();

  if (!cleared) return;

  forceRenderChatMessages55B7C([]);

  showSystemInfo("Chat wyczyszczony.", "success");

  const messageId = createMessageId();
  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("chat_clear", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser ? jamUser.id : null,
    nick: jamUser ? jamUser.nick : "System",
    created_at: nowIso(),
    source: "jam_room_chat"
  });
};

// Broadcast wiadomości tylko wymusza pobranie tabeli.
handleRealtimeChatMessage = function handleRealtimeChatMessageTable55B7E(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  fetchJamChatMessages55B7E({
    silent: true
  });
};

// Broadcast clear czyści widok i pobiera tabelę.
handleRealtimeChatClear = function handleRealtimeChatClearTable55B7E(payload) {
  if (!payload || !payload.message_id) return;

  if (jamSeenRealtimeMessageIds.has(payload.message_id)) {
    return;
  }

  jamSeenRealtimeMessageIds.add(payload.message_id);

  forceRenderChatMessages55B7C([]);

  fetchJamChatMessages55B7E({
    silent: true
  });
};

// Po wejściu do pokoju pobieramy aktualny chat z tabeli.
const originalJoinRoom55B7E = joinRoom;

joinRoom = async function joinRoomWithChatTable55B7E() {
  await originalJoinRoom55B7E();

  if (jamJoined) {
    await fetchJamChatMessages55B7E({
      silent: true
    });
  }
};

// Init chatu tabelowego.
window.addEventListener("load", () => {
  setTimeout(() => {
    subscribeJamChat55B7E();

    fetchJamChatMessages55B7E({
      silent: true
    });
  }, 1800);
});

// =======================
// ETAP 55B-7F — REACTIONS PERSISTENCE FIX
// Reakcje zapisują się do jam_room_chat tak jak tekst
// =======================

addReaction = async function addReactionTable55B7F(reaction) {
  if (!jamJoined) {
    showSystemInfo("Dołącz do pokoju, żeby wysyłać reakcje.", "warn");
    return;
  }

  await fetchJamRestrictions({
    silent: true
  });

  clearLocalMuteIfDbMuteExpired55B6D();

  if (isCurrentUserMuted() || isCurrentUserLocallyMuted55B6C()) {
    const dbRemaining = getCurrentUserMuteRemainingText();
    const localRemaining = getLocalMuteRemainingText55B6C();
    const remaining = dbRemaining || localRemaining || "chwilę";

    showSystemInfo(
      `Masz MUTE. Reakcje zablokowane jeszcze: ${remaining}.`,
      "warn"
    );

    return;
  }

  const cleanReaction = sanitizeText(reaction, 12);

  if (!cleanReaction) {
    return;
  }

  if (checkReactionSpam(cleanReaction)) {
    return;
  }

  const messageId = createMessageId();
  const createdAt = nowIso();

  const reactionMessage = {
    id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    author: jamUser.nick,
    message: cleanReaction,
    created_at: createdAt
  };

  const saved = await insertChatMessage55B7E(reactionMessage);

  if (!saved) {
    return;
  }

  jamSeenRealtimeMessageIds.add(messageId);

  const nextMessages = sortChatMessages55B7E([
    ...(Array.isArray(jamChatMessages) ? jamChatMessages : []),
    reactionMessage
  ]).slice(-JAM_CHAT_MAX_MESSAGES);

  forceRenderChatMessages55B7C(nextMessages);

  await sendRealtimeBroadcast("chat_message", {
    message_id: messageId,
    session_id: JAM_SESSION_ID,
    user_id: jamUser.id,
    nick: jamUser.nick,
    message: cleanReaction,
    created_at: createdAt,
    source: "jam_room_chat",
    kind: "reaction"
  });
};

// Dodatkowe zabezpieczenie:
// po każdym czyszczeniu chatu wymuszamy ponowny odczyt pustej tabeli,
// żeby żadna stara lokalna reakcja nie wróciła z DOM-u.
const originalClearChatInRoomState55B7F = clearChatInRoomState;

clearChatInRoomState = async function clearChatInRoomStateWithReactionFix55B7F() {
  await originalClearChatInRoomState55B7F();

  setTimeout(() => {
    fetchJamChatMessages55B7E({
      silent: true
    });
  }, 400);
};

// =======================
// ETAP 55B-8-FINAL — CLEAN JAM LOOPER PLAYER
// Jeden czysty panel: cover+#, metadane z /looper/config.js, next beat, host-only controls.
// =======================

const JAM_BEAT_COUNT_FINAL = 36;
const JAM_LOOPER_CONFIG_SRC_FINAL = "/looper/config.js";

let jamLooperConfigLoadedFinal = false;
let jamLooperConfigLoadingFinal = false;
let jamLooperConfigLoadPromiseFinal = null;

let jamBeatPickerModalFinal = null;
let jamBeatPickerGridFinal = null;
let jamLooperPlayerMountedFinal = false;

// =======================
// CONFIG / BEAT METADATA
// =======================

function loadLooperConfigFinal() {
  if (typeof beats !== "undefined" && Array.isArray(beats)) {
    jamLooperConfigLoadedFinal = true;
    return Promise.resolve(true);
  }

  if (jamLooperConfigLoadedFinal) {
    return Promise.resolve(true);
  }

  if (jamLooperConfigLoadingFinal && jamLooperConfigLoadPromiseFinal) {
    return jamLooperConfigLoadPromiseFinal;
  }

  jamLooperConfigLoadingFinal = true;

  jamLooperConfigLoadPromiseFinal = new Promise((resolve) => {
    const existingScript = Array.from(document.querySelectorAll("script")).find((script) => {
      return script.src && script.src.includes("/looper/config.js");
    });

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        jamLooperConfigLoadedFinal = true;
        jamLooperConfigLoadingFinal = false;
        resolve(true);
      });

      existingScript.addEventListener("error", () => {
        jamLooperConfigLoadedFinal = false;
        jamLooperConfigLoadingFinal = false;
        resolve(false);
      });

      return;
    }

    const script = document.createElement("script");
    script.src = JAM_LOOPER_CONFIG_SRC_FINAL;
    script.async = false;

    script.onload = () => {
      jamLooperConfigLoadedFinal = true;
      jamLooperConfigLoadingFinal = false;
      resolve(true);
    };

    script.onerror = () => {
      console.error("[JAM LOOPER CONFIG] Nie udało się załadować /looper/config.js");
      jamLooperConfigLoadedFinal = false;
      jamLooperConfigLoadingFinal = false;
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return jamLooperConfigLoadPromiseFinal;
}

function getLooperBeatsFinal() {
  if (typeof beats !== "undefined" && Array.isArray(beats)) {
    return beats;
  }

  return [];
}

function normalizeBeatIndexFinal(index) {
  const parsed = Number(index || 1);

  if (!Number.isFinite(parsed)) return 1;
  if (parsed < 1) return 1;
  if (parsed > JAM_BEAT_COUNT_FINAL) return JAM_BEAT_COUNT_FINAL;

  return parsed;
}

function getNextBeatIndexFinal(index) {
  const safeIndex = normalizeBeatIndexFinal(index);

  return safeIndex >= JAM_BEAT_COUNT_FINAL
    ? 1
    : safeIndex + 1;
}

function getPreviousBeatIndexFinal(index) {
  const safeIndex = normalizeBeatIndexFinal(index);

  return safeIndex <= 1
    ? JAM_BEAT_COUNT_FINAL
    : safeIndex - 1;
}

function getLooperBeatByIndexFinal(index) {
  const safeIndex = normalizeBeatIndexFinal(index);
  const list = getLooperBeatsFinal();

  return list.find((beat) => {
    return Number(beat.id) === Number(safeIndex);
  }) || null;
}

function toLooperAssetUrlFinal(path, fallback = "") {
  if (!path) return fallback;

  const value = String(path);

  if (value.startsWith("/")) return value;
  if (value.startsWith("looper/")) return `/${value}`;
  if (value.startsWith("assets/")) return `/looper/${value}`;

  return `/looper/${value}`;
}

function getBeatAudioUrlFinal(index) {
  const beat = getLooperBeatByIndexFinal(index);

  if (beat && beat.file) {
    return toLooperAssetUrlFinal(beat.file, `/looper/assets/audio/beat${Number(index)}.mp3`);
  }

  return `/looper/assets/audio/beat${Number(index)}.mp3`;
}

function getBeatImageUrlFinal(index) {
  const beat = getLooperBeatByIndexFinal(index);

  if (beat && beat.image) {
    return toLooperAssetUrlFinal(beat.image, "");
  }

  return "";
}

function getBeatTitleFinal(index) {
  const beat = getLooperBeatByIndexFinal(index);

  if (beat && beat.title) {
    return String(beat.title).trim() || `Beat ${index}`;
  }

  return `Beat ${String(Number(index)).padStart(2, "0")}`;
}

function getBeatProducerFinal(index) {
  const beat = getLooperBeatByIndexFinal(index);

  if (beat && beat.producer) {
    return String(beat.producer).trim() || "Unknown";
  }

  return "Unknown";
}

function getBeatBpmFinal(index) {
  const beat = getLooperBeatByIndexFinal(index);

  if (beat && beat.bpm !== null && beat.bpm !== undefined) {
    return beat.bpm;
  }

  return null;
}

function formatBeatBpmFinal(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return String(value);
  }

  return Number.isInteger(parsed)
    ? String(parsed)
    : parsed.toFixed(2);
}

function getBeatStateFinal() {
  const state = jamRoomState || {};

  const currentIndex = normalizeBeatIndexFinal(state.current_beat_index || 1);
  const nextIndex = normalizeBeatIndexFinal(
    state.next_beat_index || getNextBeatIndexFinal(currentIndex)
  );

  return {
    currentIndex,
    currentTitle: getBeatTitleFinal(currentIndex),
    currentProducer: getBeatProducerFinal(currentIndex),
    currentBpm: getBeatBpmFinal(currentIndex),
    currentUrl: getBeatAudioUrlFinal(currentIndex),
    currentImage: getBeatImageUrlFinal(currentIndex),

    nextIndex,
    nextTitle: getBeatTitleFinal(nextIndex),
    nextProducer: getBeatProducerFinal(nextIndex),
    nextBpm: getBeatBpmFinal(nextIndex),
    nextUrl: getBeatAudioUrlFinal(nextIndex),
    nextImage: getBeatImageUrlFinal(nextIndex),

    updatedBy: state.beat_updated_by_nick || "System",
    updatedAt: state.beat_updated_at || null
  };
}

function buildBeatPayloadFinal(index) {
  const currentIndex = normalizeBeatIndexFinal(index);
  const nextIndex = getNextBeatIndexFinal(currentIndex);

  return {
    current_beat_index: currentIndex,
    current_beat_title: getBeatTitleFinal(currentIndex),
    current_beat_url: getBeatAudioUrlFinal(currentIndex),

    next_beat_index: nextIndex,
    next_beat_title: getBeatTitleFinal(nextIndex),
    next_beat_url: getBeatAudioUrlFinal(nextIndex),

    beat_updated_by_session_id: JAM_SESSION_ID,
    beat_updated_by_nick: jamUser ? jamUser.nick : "Host",
    beat_updated_at: nowIso(),

    updated_by_session_id: JAM_SESSION_ID,
    updated_by_nick: jamUser ? jamUser.nick : "Host",
    updated_at: nowIso()
  };
}

// =======================
// HOST CONTROL GUARD
// =======================

function isCurrentUserHostFinal() {
  if (!jamJoined) return false;

  if (typeof isCurrentUserHost === "function" && isCurrentUserHost()) {
    return true;
  }

  const host =
    typeof getEffectiveHost === "function"
      ? getEffectiveHost()
      : null;

  return Boolean(host && host.sessionId === JAM_SESSION_ID);
}

// =======================
// STYLES
// =======================

function ensureJamLooperPlayerStylesFinal() {
  if (document.querySelector("#jamLooperPlayerStylesFinal")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "jamLooperPlayerStylesFinal";

  style.innerHTML = `
    .jam-current-beat-final-clean > .jam-now-playing,
    .jam-current-beat-final-clean > .jam-track,
    .jam-current-beat-final-clean > .jam-track-row,
    .jam-current-beat-final-clean > .jam-track-meta,
    .jam-current-beat-final-clean > .jam-integrated-looper-55b8b2,
    .jam-current-beat-final-clean > #jamBeatPanel55B8B,
    .jam-current-beat-final-clean #jamMainBeatCover55B8D,
    .jam-current-beat-final-clean #jamMainBeatMeta55B8D,
    .jam-current-beat-final-clean #jamMainNextBeatBox55B8D2,
    .jam-current-beat-final-clean #jamCleanMainPlayer55B8D3,
    .jam-current-beat-final-clean #jamTopPlayer55B8D1Final {
      display: none !important;
    }

    #jamBeatPanel55B8B,
    .jam-beat-panel {
      display: none !important;
    }

    .jam-card:has(> h2) .jam-old-looper-final-hidden {
      display: none !important;
    }

    #jamLooperPlayerFinal {
      display: block;
      margin-top: 14px;
    }

    .jam-looper-final-top {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr) minmax(230px, 320px);
      gap: 18px;
      align-items: center;
      width: 100%;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(234,162,33,0.18);
    }

    .jam-looper-final-square {
      width: 104px;
      height: 104px;
      min-width: 104px;
      min-height: 104px;
      border-radius: 18px;
      border: 1px solid rgba(234,162,33,0.38);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(234,162,33,0.98);
      font-size: 34px;
      font-weight: 900;
      line-height: 1;
      text-shadow:
        0 2px 10px rgba(0,0,0,0.95),
        0 0 14px rgba(0,0,0,0.85);
      box-shadow:
        inset 0 0 0 999px rgba(0,0,0,0.34),
        inset 0 -34px 44px rgba(0,0,0,0.48),
        0 12px 28px rgba(0,0,0,0.28);
      cursor: pointer;
      user-select: none;
    }

    .jam-looper-final-square.not-host {
      cursor: not-allowed;
      opacity: 0.66;
    }

    .jam-looper-final-meta {
      min-width: 0;
    }

    .jam-looper-final-title {
      margin: 0 0 8px;
      color: rgba(234,162,33,0.98);
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1.05;
      font-weight: 900;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .jam-looper-final-main-meta {
      margin: 0 0 8px;
      color: rgba(255,255,255,0.86);
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }

    .jam-looper-final-subline {
      margin: 0 0 4px;
      color: rgba(255,255,255,0.62);
      font-size: 13px;
      font-weight: 800;
    }

    .jam-looper-final-next {
      min-height: 100px;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid rgba(234,162,33,0.34);
      background: rgba(0,0,0,0.26);
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
    }

    .jam-looper-final-next p {
      margin: 0;
      color: rgba(234,162,33,0.84);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }

    .jam-looper-final-next strong {
      color: rgba(255,255,255,0.94);
      font-size: 18px;
      line-height: 1.1;
    }

    .jam-looper-final-next span {
      color: rgba(255,255,255,0.66);
      font-size: 12px;
      line-height: 1.3;
    }

    .jam-looper-final-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 14px;
    }

    .jam-looper-final-controls.host-hidden {
      display: none !important;
    }

    .jam-looper-final-hint {
      margin-top: 12px;
      color: rgba(255,255,255,0.58);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .jam-looper-final-pitch {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: min(100%, 280px);
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid rgba(234,162,33,0.24);
      background: rgba(0,0,0,0.24);
    }

    .jam-looper-final-pitch input {
      flex: 1;
      accent-color: rgba(234,162,33,0.96);
    }

    .jam-looper-final-pitch span {
      min-width: 48px;
      text-align: right;
      color: rgba(255,255,255,0.78);
      font-size: 12px;
      font-weight: 900;
    }

    @media (max-width: 860px) {
      .jam-looper-final-top {
        grid-template-columns: 104px minmax(0, 1fr);
      }

      .jam-looper-final-next {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 560px) {
      .jam-looper-final-top {
        grid-template-columns: 1fr;
        text-align: center;
      }

      .jam-looper-final-square {
        margin: 0 auto;
      }

      .jam-looper-final-controls {
        justify-content: center;
      }
    }
  `;

  document.head.appendChild(style);
}

// =======================
// DOM PLAYER
// =======================

function findCurrentBeatCardFinal() {
  const cards = Array.from(document.querySelectorAll(".jam-card"));

  return cards.find((card) => {
    const h2 = card.querySelector("h2");
    return h2 && h2.innerText.trim().toLowerCase() === "aktualny beat";
  }) || null;
}

function hideOldLooperCardsFinal() {
  const cards = Array.from(document.querySelectorAll(".jam-card"));

  cards.forEach((card) => {
    const h2 = card.querySelector("h2");

    if (!h2) return;

    const title = h2.innerText.trim().toLowerCase();

    if (
      title === "funkcje loopera w pokoju" &&
      card.innerText.includes("Docelowo host będzie sterował beatem")
    ) {
      card.style.display = "none";
    }
  });
}

function ensureJamLooperPlayerFinal() {
  ensureJamLooperPlayerStylesFinal();

  const card = findCurrentBeatCardFinal();

  if (!card) {
    return null;
  }

  hideOldLooperCardsFinal();

  card.classList.add("jam-current-beat-final-clean");

  let player = card.querySelector("#jamLooperPlayerFinal");

  if (player) {
    return player;
  }

  player = document.createElement("div");
  player.id = "jamLooperPlayerFinal";

  player.innerHTML = `
    <div class="jam-looper-final-top">
      <button id="jamLooperBeatSquareFinal" class="jam-looper-final-square" type="button">
        #1
      </button>

      <div class="jam-looper-final-meta">
        <h3 id="jamLooperBeatTitleFinal" class="jam-looper-final-title">Beat</h3>

        <p id="jamLooperBeatMetaFinal" class="jam-looper-final-main-meta">
          Producent: -- | BPM: --
        </p>

        <p id="jamLooperPerformerFinal" class="jam-looper-final-subline">
          Aktualnie skreczuje: nikt
        </p>

        <p id="jamLooperHostFinal" class="jam-looper-final-subline">
          Host: brak
        </p>
      </div>

      <div class="jam-looper-final-next">
        <p>Następny beat</p>
        <strong id="jamLooperNextTitleFinal">#-- — Beat</strong>
        <span id="jamLooperNextMetaFinal">Producent: -- | BPM: --</span>
      </div>
    </div>

    <div id="jamLooperControlsFinal" class="jam-looper-final-controls">
      <button class="jam-btn" type="button" id="jamPrevBeatFinal">PREVIOUS BEAT</button>
      <button class="jam-btn" type="button" id="jamChooseBeatFinal">CHOOSE BEAT</button>
      <button class="jam-btn" type="button" id="jamNextBeatFinal">NEXT BEAT</button>

      <button class="jam-btn jam-btn-primary" type="button" id="jamStartBeatFinal">START</button>
      <button class="jam-btn jam-btn-danger" type="button" id="jamStopBeatFinal">STOP</button>

      <button class="jam-btn" type="button" id="jamLoopInfinityFinal">INFINITY</button>
      <button class="jam-btn" type="button" id="jamLoop1Final">LOOP 1X</button>
      <button class="jam-btn" type="button" id="jamLoop2Final">LOOP 2X</button>
      <button class="jam-btn" type="button" id="jamLoop4Final">LOOP 4X</button>
      <button class="jam-btn" type="button" id="jamLoop6Final">LOOP 6X</button>
      <button class="jam-btn" type="button" id="jamLoop8Final">LOOP 8X</button>

      <button class="jam-btn" type="button" id="jamPitchMinusFinal">PITCH -</button>

      <div class="jam-looper-final-pitch">
        <input id="jamPitchSliderFinal" type="range" min="-12" max="12" step="1" value="0">
        <span id="jamPitchValueFinal">0%</span>
      </div>

      <button class="jam-btn" type="button" id="jamPitchPlusFinal">PITCH +</button>
    </div>

    <div id="jamLooperHintFinal" class="jam-looper-final-hint">
      Sterowanie beatem widoczne jest tylko dla Hosta.
    </div>
  `;

  const h2 = card.querySelector("h2");

  if (h2 && h2.parentNode) {
    h2.parentNode.insertBefore(player, h2.nextSibling);
  } else {
    card.prepend(player);
  }

  bindJamLooperPlayerEventsFinal(player);

  jamLooperPlayerMountedFinal = true;

  return player;
}

function getPitchValueFinal() {
  const slider = document.querySelector("#jamPitchSliderFinal");

  return slider ? Number(slider.value || 0) : 0;
}

function updatePitchValueFinal(value) {
  const safeValue = Math.max(-12, Math.min(12, Number(value || 0)));
  const slider = document.querySelector("#jamPitchSliderFinal");
  const label = document.querySelector("#jamPitchValueFinal");

  if (slider) {
    slider.value = String(safeValue);
  }

  if (label) {
    label.innerText = `${safeValue}%`;
  }
}

function changePitchFinal(delta) {
  updatePitchValueFinal(getPitchValueFinal() + Number(delta || 0));
}

function bindJamLooperPlayerEventsFinal(player) {
  if (!player) return;

  const square = player.querySelector("#jamLooperBeatSquareFinal");
  const chooseBtn = player.querySelector("#jamChooseBeatFinal");
  const prevBtn = player.querySelector("#jamPrevBeatFinal");
  const nextBtn = player.querySelector("#jamNextBeatFinal");
  const startBtn = player.querySelector("#jamStartBeatFinal");
  const stopBtn = player.querySelector("#jamStopBeatFinal");
  const pitchMinus = player.querySelector("#jamPitchMinusFinal");
  const pitchPlus = player.querySelector("#jamPitchPlusFinal");
  const pitchSlider = player.querySelector("#jamPitchSliderFinal");

  const openPicker = () => {
    if (!jamJoined) {
      showSystemInfo("Najpierw dołącz do pokoju.", "warn");
      return;
    }

    if (!isCurrentUserHostFinal()) {
      showSystemInfo("Tylko Host może wybierać beat.", "warn");
      return;
    }

    openBeatPickerModalFinal();
  };

  if (square) square.onclick = openPicker;
  if (chooseBtn) chooseBtn.onclick = openPicker;

  if (prevBtn) {
    prevBtn.onclick = () => {
      runLockedAction(async () => {
        const beatState = getBeatStateFinal();
        await saveBeatStateToRoomFinal(getPreviousBeatIndexFinal(beatState.currentIndex), "Previous Beat");
      }, "previous beat", "host_placeholder");
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      runLockedAction(async () => {
        const beatState = getBeatStateFinal();
        await saveBeatStateToRoomFinal(getNextBeatIndexFinal(beatState.currentIndex), "Next Beat");
      }, "next beat", "host_placeholder");
    };
  }

  if (startBtn) {
    startBtn.onclick = () => {
      showSystemInfo("START audio podłączymy w kolejnym etapie.");
    };
  }

  if (stopBtn) {
    stopBtn.onclick = () => {
      showSystemInfo("STOP audio podłączymy w kolejnym etapie.");
    };
  }

  [
    ["#jamLoopInfinityFinal", "INFINITY"],
    ["#jamLoop1Final", "LOOP 1X"],
    ["#jamLoop2Final", "LOOP 2X"],
    ["#jamLoop4Final", "LOOP 4X"],
    ["#jamLoop6Final", "LOOP 6X"],
    ["#jamLoop8Final", "LOOP 8X"]
  ].forEach(([selector, label]) => {
    const button = player.querySelector(selector);

    if (button) {
      button.onclick = () => {
        showSystemInfo(`${label} podłączymy do lokalnego playera.`);
      };
    }
  });

  if (pitchMinus) {
    pitchMinus.onclick = () => changePitchFinal(-1);
  }

  if (pitchPlus) {
    pitchPlus.onclick = () => changePitchFinal(1);
  }

  if (pitchSlider) {
    pitchSlider.oninput = () => updatePitchValueFinal(Number(pitchSlider.value || 0));
  }
}

function renderJamLooperPlayerFinal() {
  const player = ensureJamLooperPlayerFinal();

  if (!player) return;

  const beatState = getBeatStateFinal();
  const isHost = isCurrentUserHostFinal();

  const square = player.querySelector("#jamLooperBeatSquareFinal");
  const title = player.querySelector("#jamLooperBeatTitleFinal");
  const meta = player.querySelector("#jamLooperBeatMetaFinal");
  const performer = player.querySelector("#jamLooperPerformerFinal");
  const hostLine = player.querySelector("#jamLooperHostFinal");
  const nextTitle = player.querySelector("#jamLooperNextTitleFinal");
  const nextMeta = player.querySelector("#jamLooperNextMetaFinal");
  const controls = player.querySelector("#jamLooperControlsFinal");
  const hint = player.querySelector("#jamLooperHintFinal");

  if (square) {
    square.innerText = `#${beatState.currentIndex}`;
    square.style.backgroundImage = beatState.currentImage
      ? `url("${beatState.currentImage}")`
      : "";
    square.classList.toggle("not-host", !isHost);
    square.title = isHost
      ? "Kliknij, żeby wybrać beat"
      : "Tylko Host może wybierać beat";
  }

  if (title) {
    title.innerText = beatState.currentTitle || `Beat ${beatState.currentIndex}`;
  }

  if (meta) {
    meta.innerText =
      `Producent: ${beatState.currentProducer} | BPM: ${formatBeatBpmFinal(beatState.currentBpm)}`;
  }

  if (performer) {
    const performerName =
      jamActive && jamCurrentPerformer
        ? jamCurrentPerformer.nick
        : "nikt";

    performer.innerText = `Aktualnie skreczuje: ${performerName}`;
  }

  if (hostLine) {
    const host =
      typeof getEffectiveHost === "function"
        ? getEffectiveHost()
        : null;

    hostLine.innerText = `Host: ${host ? host.nick : "brak"}`;
  }

  if (nextTitle) {
    nextTitle.innerText =
      `#${String(beatState.nextIndex).padStart(2, "0")} — ${beatState.nextTitle}`;
  }

  if (nextMeta) {
    nextMeta.innerText =
      `Producent: ${beatState.nextProducer} | BPM: ${formatBeatBpmFinal(beatState.nextBpm)}`;
  }

  if (controls) {
    controls.classList.toggle("host-hidden", !isHost);
  }

  if (hint) {
    hint.style.display = isHost ? "none" : "";
  }

  updatePitchValueFinal(getPitchValueFinal());
}

// =======================
// BEAT PICKER MODAL
// =======================

function ensureBeatPickerModalFinal() {
  if (jamBeatPickerModalFinal) {
    return jamBeatPickerModalFinal;
  }

  jamBeatPickerModalFinal = document.createElement("div");
  jamBeatPickerModalFinal.id = "jamBeatPickerModalFinal";
  jamBeatPickerModalFinal.className = "jam-modal hidden";

  jamBeatPickerModalFinal.innerHTML = `
    <div class="jam-modal-box">
      <h2>Wybierz beat</h2>

      <p>
        Wybór beatu #1–#36. Zmiana jest zapisywana do room_state i widoczna u wszystkich.
      </p>

      <div id="jamBeatPickerGridFinal" style="
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      "></div>

      <div class="jam-modal-actions">
        <button id="closeBeatPickerModalFinal" class="jam-btn" type="button">
          ZAMKNIJ
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(jamBeatPickerModalFinal);

  jamBeatPickerGridFinal =
    jamBeatPickerModalFinal.querySelector("#jamBeatPickerGridFinal");

  const closeBtn =
    jamBeatPickerModalFinal.querySelector("#closeBeatPickerModalFinal");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeBeatPickerModalFinal();
    });
  }

  jamBeatPickerModalFinal.addEventListener("click", (event) => {
    if (event.target === jamBeatPickerModalFinal) {
      closeBeatPickerModalFinal();
    }
  });

  return jamBeatPickerModalFinal;
}

function openBeatPickerModalFinal() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHostFinal()) {
    showSystemInfo("Tylko Host może wybierać beat.", "warn");
    return;
  }

  ensureBeatPickerModalFinal();
  renderBeatPickerGridFinal();

  jamBeatPickerModalFinal.classList.remove("hidden");
}

function closeBeatPickerModalFinal() {
  if (jamBeatPickerModalFinal) {
    jamBeatPickerModalFinal.classList.add("hidden");
  }
}

function renderBeatPickerGridFinal() {
  if (!jamBeatPickerGridFinal) return;

  const beatState = getBeatStateFinal();

  jamBeatPickerGridFinal.innerHTML = "";

  for (let index = 1; index <= JAM_BEAT_COUNT_FINAL; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jam-btn";
    button.innerText = `#${index}`;
    button.title = `${getBeatTitleFinal(index)} — ${getBeatAudioUrlFinal(index)}`;

    if (index === beatState.currentIndex) {
      button.classList.add("jam-btn-primary");
    }

    button.addEventListener("click", () => {
      runLockedAction(async () => {
        await saveBeatStateToRoomFinal(index, "Choose Beat");
        closeBeatPickerModalFinal();
      }, "wybierz beat", "host_placeholder");
    });

    jamBeatPickerGridFinal.appendChild(button);
  }
}

// =======================
// SAVE BEAT STATE
// =======================

async function saveBeatStateToRoomFinal(index, sourceLabel = "Host") {
  if (!jamSupabaseClient) {
    showSystemInfo("Brak połączenia Supabase — nie zapisano beatu.", "warn");
    return false;
  }

  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return false;
  }

  if (!isCurrentUserHostFinal()) {
    showSystemInfo("Tylko Host może zmieniać beat.", "warn");
    return false;
  }

  const payload = buildBeatPayloadFinal(index);

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(payload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM BEAT STATE FINAL] update error:", error);
      showSystemInfo("Nie udało się zapisać beatu w room_state.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "beat state write"
    });

    renderJamLooperPlayerFinal();

    showSystemInfo(
      `${sourceLabel}: ustawiono ${payload.current_beat_title}.`,
      "success"
    );

    const messageId = createMessageId();
    jamSeenRealtimeMessageIds.add(messageId);

    await sendRealtimeBroadcast("jam_status", {
      message_id: messageId,
      type: "beat_change",
      current_beat_index: payload.current_beat_index,
      current_beat_title: payload.current_beat_title,
      current_beat_url: payload.current_beat_url,
      next_beat_index: payload.next_beat_index,
      next_beat_title: payload.next_beat_title,
      next_beat_url: payload.next_beat_url,
      session_id: JAM_SESSION_ID,
      user_id: jamUser ? jamUser.id : null,
      nick: jamUser ? jamUser.nick : "Host",
      created_at: nowIso()
    });

    return true;
  } catch (error) {
    console.error("[JAM BEAT STATE FINAL] update exception:", error);
    showSystemInfo("Błąd zapisu beatu.", "warn");
    return false;
  }
}

// =======================
// REALTIME / RENDER HOOKS
// =======================

const previousHandleRealtimeJamStatusFinal = handleRealtimeJamStatus;

handleRealtimeJamStatus = function handleRealtimeJamStatusFinal(payload) {
  if (payload && payload.type === "beat_change") {
    fetchJamRoomState({
      silent: true,
      reason: "beat change broadcast"
    });

    setTimeout(() => {
      renderJamLooperPlayerFinal();
    }, 250);

    return;
  }

  previousHandleRealtimeJamStatusFinal(payload);
};

const previousRenderJamStateFinal = renderJamState;

renderJamState = function renderJamStateWithLooperPlayerFinal() {
  previousRenderJamStateFinal();

  setTimeout(() => {
    renderJamLooperPlayerFinal();
  }, 40);
};

const previousApplyRoomStateToLocalStateFinal = applyRoomStateToLocalState;

applyRoomStateToLocalState = function applyRoomStateWithLooperPlayerFinal(nextRoomState, options = {}) {
  previousApplyRoomStateToLocalStateFinal(nextRoomState, options);

  setTimeout(() => {
    renderJamLooperPlayerFinal();
  }, 40);
};

window.addEventListener("load", () => {
  loadLooperConfigFinal().then(() => {
    renderJamLooperPlayerFinal();

    setTimeout(() => {
      renderJamLooperPlayerFinal();
    }, 1200);

    setTimeout(() => {
      renderJamLooperPlayerFinal();
    }, 3200);
  });
});

// =======================
// ETAP 55B-9A-FIX — HOST INTERCOM ROOM_STATE ONLY
// Interkom Hosta nie używa kolejki ani is_performer w jam_room_members.
// Dzięki temu realtime/members resync nie cofa mikrofonu po ułamku sekundy.
// =======================

function isHostIntercomSource55B9AFix(source) {
  return source === "host_takeover" || source === "host_intercom";
}

function isQueueMicSource55B9AFix(source) {
  return source === "queue" || source === "queue_pass" || source === "skip";
}

function getOnlineUserBySession55B9AFix(sessionId) {
  if (!sessionId) return null;

  return jamOnlineUsers.find((user) => {
    return user.sessionId === sessionId;
  }) || null;
}

function getCurrentRoomSpeaker55B9AFix() {
  if (!jamCurrentPerformer) return null;

  return {
    id: jamCurrentPerformer.id || jamCurrentPerformer.userId,
    userId: jamCurrentPerformer.userId || jamCurrentPerformer.id,
    sessionId: jamCurrentPerformer.sessionId,
    nick: jamCurrentPerformer.nick,
    joinedAt: jamCurrentPerformer.joinedAt || Date.now()
  };
}

async function saveIntercomSpeakerToRoomState55B9AFix(targetUser, micSource) {
  if (!jamSupabaseClient || !targetUser) {
    showSystemInfo("Brak danych do przekazania mikrofonu.", "warn");
    return false;
  }

  const payload = {
    current_performer_session_id: targetUser.sessionId,
    current_performer_user_id: targetUser.userId || targetUser.id || targetUser.sessionId,
    current_performer_nick: targetUser.nick || "Użytkownik",
    mic_source: micSource,

    updated_by_session_id: JAM_SESSION_ID,
    updated_by_nick: jamUser ? jamUser.nick : "Host",
    updated_at: nowIso()
  };

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(payload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM HOST INTERCOM] room_state update error:", error);
      showSystemInfo("Nie udało się zapisać mikrofonu w room_state.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "host intercom"
    });

    return true;
  } catch (error) {
    console.error("[JAM HOST INTERCOM] room_state exception:", error);
    showSystemInfo("Błąd przekazania mikrofonu.", "warn");
    return false;
  }
}

async function clearIntercomSpeakerInRoomState55B9AFix() {
  if (!jamSupabaseClient) {
    return false;
  }

  const payload = {
    current_performer_session_id: null,
    current_performer_user_id: null,
    current_performer_nick: null,
    mic_source: null,

    updated_by_session_id: JAM_SESSION_ID,
    updated_by_nick: jamUser ? jamUser.nick : "Host",
    updated_at: nowIso()
  };

  try {
    const { data, error } = await jamSupabaseClient
      .from("jam_room_state")
      .update(payload)
      .eq("room_id", JAM_ROOM_STATE_ID)
      .select()
      .single();

    if (error) {
      console.error("[JAM HOST INTERCOM] clear error:", error);
      showSystemInfo("Nie udało się wyłączyć mikrofonu.", "warn");
      return false;
    }

    applyRoomStateToLocalState(data, {
      silent: true,
      source: "host intercom clear"
    });

    return true;
  } catch (error) {
    console.error("[JAM HOST INTERCOM] clear exception:", error);
    showSystemInfo("Błąd wyłączania mikrofonu.", "warn");
    return false;
  }
}

async function setAllMembersPerformerFalseSafe55B9AFix() {
  try {
    await setAllMembersPerformerFalse();
  } catch (error) {
    console.error("[JAM HOST INTERCOM] clear member performers error:", error);
  }

  if (jamUser) {
    jamUser.isPerformer = false;
    jamMicRequested = Boolean(jamUser.isInQueue);
    saveJamUser();
  }

  try {
    if (jamJoined) {
      await updateCurrentMemberFields({
        is_performer: false
      });
    }
  } catch (error) {
    console.error("[JAM HOST INTERCOM] update self performer false error:", error);
  }
}

async function assignHostIntercomSpeaker55B9AFix(targetUser, micSource = "host_intercom") {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return false;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może sterować mikrofonem.", "warn");
    return false;
  }

  if (!targetUser || !targetUser.sessionId) {
    showSystemInfo("Nie wybrano osoby do mikrofonu.", "warn");
    return false;
  }

  await setAllMembersPerformerFalseSafe55B9AFix();

  jamCurrentPerformer = {
    id: targetUser.userId || targetUser.id || targetUser.sessionId,
    userId: targetUser.userId || targetUser.id || targetUser.sessionId,
    sessionId: targetUser.sessionId,
    nick: targetUser.nick || "Użytkownik",
    joinedAt: targetUser.joinedAt || Date.now()
  };

  jamMicSource = micSource;

  const saved = await saveIntercomSpeakerToRoomState55B9AFix(
    jamCurrentPerformer,
    micSource
  );

  if (!saved) {
    return false;
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
    add_to_queue: false,
    preserve_queue: true,
    mic_source: micSource,
    session_id: jamCurrentPerformer.sessionId,
    user_id: jamCurrentPerformer.userId,
    nick: jamCurrentPerformer.nick,
    created_at: nowIso()
  });

  showSystemInfo(
    micSource === "host_takeover"
      ? "Host przejął mikrofon."
      : `Mikrofon przekazany: ${jamCurrentPerformer.nick}.`,
    "success"
  );

  return true;
}

// PRZEJMIJ MIKROFON: działa niezależnie od jam_active i kolejki.
hostTakeMicrophone = async function hostTakeMicrophoneRoomStateOnly55B9AFix() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przejąć mikrofon.", "warn");
    return;
  }

  // Jeśli Host już mówi w trybie awaryjnym/interkomowym — klik oznacza WYŁĄCZ.
  if (
    jamCurrentPerformer &&
    jamCurrentPerformer.sessionId === JAM_SESSION_ID &&
    isHostIntercomSource55B9AFix(jamMicSource)
  ) {
    await hostReleaseMicrophone();
    return;
  }

  await assignHostIntercomSpeaker55B9AFix({
    id: jamUser.id,
    userId: jamUser.id,
    sessionId: JAM_SESSION_ID,
    nick: jamUser.nick,
    joinedAt: Date.now(),
    isInQueue: Boolean(jamUser.isInQueue),
    queueJoinedAt: jamUser.queueJoinedAt || null
  }, "host_takeover");
};

// WYŁĄCZ MIKROFON: w trybie interkomowym zawsze czyści room_state.
// Nie oddaje automatycznie głosu nikomu z ONLINE.
hostReleaseMicrophone = async function hostReleaseMicrophoneRoomStateOnly55B9AFix() {
  if (!jamJoined || !isCurrentUserHost()) {
    return;
  }

  if (!jamCurrentPerformer) {
    showSystemInfo("Nikt aktualnie nie ma mikrofonu.", "warn");
    return;
  }

  const oldSpeaker = getCurrentRoomSpeaker55B9AFix();
  const oldSource = jamMicSource;

  await setAllMembersPerformerFalseSafe55B9AFix();

  jamCurrentPerformer = null;
  jamMicSource = null;

  const cleared = await clearIntercomSpeakerInRoomState55B9AFix();

  if (!cleared) {
    return;
  }

  await fetchJamMembers({
    silent: true
  });

  renderJamState();

  const messageId = createMessageId();
  jamSeenRealtimeMessageIds.add(messageId);

  await sendRealtimeBroadcast("performer_status", {
    message_id: messageId,
    active: false,
    clear_all: true,
    preserve_queue: true,
    mic_source: null,
    session_id: oldSpeaker ? oldSpeaker.sessionId : null,
    user_id: oldSpeaker ? oldSpeaker.userId : null,
    nick: oldSpeaker ? oldSpeaker.nick : null,
    created_at: nowIso()
  });

  if (isHostIntercomSource55B9AFix(oldSource)) {
    showSystemInfo("Mikrofon wyłączony.", "success");
    return;
  }

  showSystemInfo("Mikrofon wyłączony.", "success");
};

// Modal PRZEKAŻ MIKROFON: wybór z ONLINE, bez dopisywania do kolejki.
openHostPickMicModal = function openHostPickMicModalRoomStateOnly55B9AFix() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przekazać mikrofon.", "warn");
    return;
  }

  const modal = ensureHostPickMicModal();
  const list = modal.querySelector("#jamHostPickMicList");

  if (!list) return;

  list.innerHTML = "";

  const currentSpeakerSessionId =
    jamCurrentPerformer && jamCurrentPerformer.sessionId
      ? jamCurrentPerformer.sessionId
      : null;

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
      const row = document.createElement("button");
      row.type = "button";
      row.className = "jam-btn";
      row.style.width = "100%";
      row.style.justifyContent = "space-between";
      row.style.marginBottom = "8px";

      const currentLabel =
        currentSpeakerSessionId === user.sessionId
          ? " — TERAZ MÓWI"
          : "";

      row.innerText = `${user.nick} — ${user.role || "Listener"}${currentLabel}`;

      row.addEventListener("click", () => {
        runLockedAction(async () => {
          closeHostPickMicModal();

          if (currentSpeakerSessionId === user.sessionId) {
            await hostReleaseMicrophone();
            return;
          }

          await assignHostIntercomSpeaker55B9AFix({
            id: user.userId || user.id,
            userId: user.userId || user.id,
            sessionId: user.sessionId,
            nick: user.nick,
            joinedAt: user.joinedAt || Date.now(),
            isInQueue: Boolean(user.isInQueue),
            queueJoinedAt: user.queueJoinedAt || null
          }, "host_intercom");
        }, "przekaż mikrofon", "host_pass_mic");
      });

      list.appendChild(row);
    });
  }

  const stopRow = document.createElement("button");
  stopRow.type = "button";
  stopRow.className = "jam-btn jam-btn-danger";
  stopRow.style.width = "100%";
  stopRow.style.justifyContent = "center";
  stopRow.style.marginTop = "10px";
  stopRow.innerText = "WYŁĄCZ AKTUALNY MIKROFON";

  stopRow.addEventListener("click", () => {
    runLockedAction(async () => {
      closeHostPickMicModal();
      await hostReleaseMicrophone();
    }, "wyłącz mikrofon", "host_takeover");
  });

  list.appendChild(stopRow);

  modal.classList.remove("hidden");
};

hostPassMicrophoneNext = async function hostPassMicrophoneNextRoomStateOnly55B9AFix() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHost()) {
    showSystemInfo("Tylko Host może przekazać mikrofon.", "warn");
    return;
  }

  openHostPickMicModal();
};

// Reconcile nie powinien ubijać interkomu tylko dlatego, że user nie jest w kolejce.
const previousReconcileRoomStateAfterMembersChange55B9AFix =
  reconcileRoomStateAfterMembersChange;

reconcileRoomStateAfterMembersChange = async function reconcileRoomStateAfterMembersChangeIntercomSafe55B9AFix() {
  if (isHostIntercomSource55B9AFix(jamMicSource)) {
    if (
      jamCurrentPerformer &&
      !sessionIsCurrentlyOnline(jamCurrentPerformer.sessionId)
    ) {
      if (isCurrentUserHost()) {
        await hostReleaseMicrophone();
      }
    }

    return;
  }

  await previousReconcileRoomStateAfterMembersChange55B9AFix();
};

// Stary NEXT BEAT w panelu hosta chowamy — beatami steruje player.
function hideLegacyHostNextBeat55B9AFix() {
  if (nextBeatBtn) {
    nextBeatBtn.style.display = "none";
  }
}

const previousRenderJamState55B9AFix = renderJamState;

renderJamState = function renderJamStateHostIntercomRoomStateOnly55B9AFix() {
  previousRenderJamState55B9AFix();
  hideLegacyHostNextBeat55B9AFix();
};

window.addEventListener("load", () => {
  setTimeout(() => {
    hideLegacyHostNextBeat55B9AFix();
  }, 1000);

  setTimeout(() => {
    hideLegacyHostNextBeat55B9AFix();
  }, 3000);
});

// =======================
// ETAP 55B-10 — LOCAL AUDIO START / STOP
// Lokalny player audio w /jam dla aktualnego beatu
// =======================

let jamLocalAudioFinal = null;
let jamLocalAudioUrlFinal = null;
let jamLocalAudioPlayingFinal = false;
let jamLocalAudioLoadingFinal = false;

function ensureJamLocalAudioFinal() {
  if (jamLocalAudioFinal) {
    return jamLocalAudioFinal;
  }

  jamLocalAudioFinal = new Audio();
  jamLocalAudioFinal.preload = "auto";

  jamLocalAudioFinal.addEventListener("ended", () => {
    jamLocalAudioPlayingFinal = false;
    updateJamLocalAudioUiFinal();
    showSystemInfo("Beat zakończony.");
  });

  jamLocalAudioFinal.addEventListener("error", () => {
    jamLocalAudioPlayingFinal = false;
    jamLocalAudioLoadingFinal = false;
    updateJamLocalAudioUiFinal();
    showSystemInfo("Nie udało się odtworzyć pliku audio.", "warn");
  });

  jamLocalAudioFinal.addEventListener("canplay", () => {
    jamLocalAudioLoadingFinal = false;
    updateJamLocalAudioUiFinal();
  });

  return jamLocalAudioFinal;
}

function getCurrentBeatAudioUrlForPlayerFinal() {
  const beatState =
    typeof getBeatStateFinal === "function"
      ? getBeatStateFinal()
      : null;

  if (!beatState || !beatState.currentUrl) {
    return "";
  }

  return beatState.currentUrl;
}

function getCurrentBeatLabelForPlayerFinal() {
  const beatState =
    typeof getBeatStateFinal === "function"
      ? getBeatStateFinal()
      : null;

  if (!beatState) {
    return "Beat";
  }

  return `#${beatState.currentIndex} — ${beatState.currentTitle}`;
}

function ensureJamAudioStatusFinal() {
  const player = document.querySelector("#jamLooperPlayerFinal");

  if (!player) {
    return null;
  }

  let status = player.querySelector("#jamAudioStatusFinal");

  if (status) {
    return status;
  }

  status = document.createElement("div");
  status.id = "jamAudioStatusFinal";
  status.style.marginTop = "10px";
  status.style.color = "rgba(255,255,255,0.62)";
  status.style.fontSize = "12px";
  status.style.fontWeight = "900";
  status.style.letterSpacing = "0.5px";
  status.style.textTransform = "uppercase";
  status.innerText = "Audio: gotowe lokalnie";

  const controls = player.querySelector("#jamLooperControlsFinal");

  if (controls && controls.parentNode) {
    controls.parentNode.insertBefore(status, controls.nextSibling);
  } else {
    player.appendChild(status);
  }

  return status;
}

function updateJamLocalAudioUiFinal() {
  const startBtn = document.querySelector("#jamStartBeatFinal");
  const stopBtn = document.querySelector("#jamStopBeatFinal");
  const status = ensureJamAudioStatusFinal();

  if (startBtn) {
    startBtn.disabled = jamLocalAudioLoadingFinal;
    startBtn.classList.toggle("jam-btn-muted", jamLocalAudioLoadingFinal);
    startBtn.innerText = jamLocalAudioPlayingFinal
      ? "PLAYING"
      : jamLocalAudioLoadingFinal
        ? "LOADING"
        : "START";
  }

  if (stopBtn) {
    stopBtn.disabled = !jamLocalAudioPlayingFinal && !jamLocalAudioLoadingFinal;
    stopBtn.classList.toggle("jam-btn-muted", stopBtn.disabled);
  }

  if (status) {
    if (jamLocalAudioLoadingFinal) {
      status.innerText = "Audio: ładowanie...";
    } else if (jamLocalAudioPlayingFinal) {
      status.innerText = `Audio: gra lokalnie — ${getCurrentBeatLabelForPlayerFinal()}`;
    } else if (jamLocalAudioUrlFinal) {
      status.innerText = "Audio: zatrzymane lokalnie";
    } else {
      status.innerText = "Audio: gotowe lokalnie";
    }
  }
}

async function loadJamLocalAudioFinal(url) {
  const audio = ensureJamLocalAudioFinal();

  if (!url) {
    showSystemInfo("Brak ścieżki audio dla aktualnego beatu.", "warn");
    return false;
  }

  if (jamLocalAudioUrlFinal === url && audio.src) {
    return true;
  }

  jamLocalAudioLoadingFinal = true;
  updateJamLocalAudioUiFinal();

  try {
    audio.pause();
    audio.currentTime = 0;

    jamLocalAudioUrlFinal = url;
    audio.src = url;
    audio.load();

    return true;
  } catch (error) {
    console.error("[JAM LOCAL AUDIO] load error:", error);

    jamLocalAudioLoadingFinal = false;
    jamLocalAudioPlayingFinal = false;
    updateJamLocalAudioUiFinal();

    showSystemInfo("Nie udało się załadować audio.", "warn");
    return false;
  }
}

async function startJamLocalAudioFinal() {
  if (!jamJoined) {
    showSystemInfo("Najpierw dołącz do pokoju.", "warn");
    return;
  }

  if (!isCurrentUserHostFinal()) {
    showSystemInfo("Tylko Host może uruchomić audio w panelu.", "warn");
    return;
  }

  const audio = ensureJamLocalAudioFinal();
  const url = getCurrentBeatAudioUrlForPlayerFinal();

  const loaded = await loadJamLocalAudioFinal(url);

  if (!loaded) {
    return;
  }

  try {
    jamLocalAudioLoadingFinal = false;

    await audio.play();

    jamLocalAudioPlayingFinal = true;
    updateJamLocalAudioUiFinal();

    showSystemInfo(`START: ${getCurrentBeatLabelForPlayerFinal()}`, "success");
  } catch (error) {
    console.error("[JAM LOCAL AUDIO] play error:", error);

    jamLocalAudioPlayingFinal = false;
    jamLocalAudioLoadingFinal = false;
    updateJamLocalAudioUiFinal();

    showSystemInfo(
      "Przeglądarka zablokowała start audio. Kliknij START jeszcze raz.",
      "warn"
    );
  }
}

function stopJamLocalAudioFinal(showMessage = true) {
  const audio = ensureJamLocalAudioFinal();

  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (error) {
    console.error("[JAM LOCAL AUDIO] stop error:", error);
  }

  jamLocalAudioPlayingFinal = false;
  jamLocalAudioLoadingFinal = false;

  updateJamLocalAudioUiFinal();

  if (showMessage) {
    showSystemInfo("STOP audio.", "success");
  }
}

async function restartJamLocalAudioAfterBeatChangeFinal() {
  if (!jamLocalAudioPlayingFinal) {
    return;
  }

  const nextUrl = getCurrentBeatAudioUrlForPlayerFinal();

  if (!nextUrl) {
    stopJamLocalAudioFinal(false);
    return;
  }

  if (nextUrl === jamLocalAudioUrlFinal) {
    return;
  }

  stopJamLocalAudioFinal(false);

  await loadJamLocalAudioFinal(nextUrl);

  try {
    await jamLocalAudioFinal.play();

    jamLocalAudioPlayingFinal = true;
    jamLocalAudioLoadingFinal = false;
    updateJamLocalAudioUiFinal();

    showSystemInfo(`Audio przełączone: ${getCurrentBeatLabelForPlayerFinal()}`, "success");
  } catch (error) {
    console.error("[JAM LOCAL AUDIO] restart after beat change error:", error);

    jamLocalAudioPlayingFinal = false;
    jamLocalAudioLoadingFinal = false;
    updateJamLocalAudioUiFinal();

    showSystemInfo("Beat zmieniony, ale audio nie wystartowało automatycznie.", "warn");
  }
}

function bindJamLocalAudioButtonsFinal() {
  const startBtn = document.querySelector("#jamStartBeatFinal");
  const stopBtn = document.querySelector("#jamStopBeatFinal");

  if (startBtn && startBtn.dataset.audioBoundFinal !== "true") {
    startBtn.dataset.audioBoundFinal = "true";

    startBtn.onclick = () => {
      startJamLocalAudioFinal();
    };
  }

  if (stopBtn && stopBtn.dataset.audioBoundFinal !== "true") {
    stopBtn.dataset.audioBoundFinal = "true";

    stopBtn.onclick = () => {
      stopJamLocalAudioFinal(true);
    };
  }

  updateJamLocalAudioUiFinal();
}

const previousRenderJamLooperPlayerFinal55B10 = renderJamLooperPlayerFinal;

renderJamLooperPlayerFinal = function renderJamLooperPlayerWithAudioFinal55B10() {
  previousRenderJamLooperPlayerFinal55B10();

  bindJamLocalAudioButtonsFinal();
  updateJamLocalAudioUiFinal();
};

const previousApplyRoomStateToLocalState55B10 = applyRoomStateToLocalState;

applyRoomStateToLocalState = function applyRoomStateWithLocalAudio55B10(nextRoomState, options = {}) {
  const previousUrl = getCurrentBeatAudioUrlForPlayerFinal();

  previousApplyRoomStateToLocalState55B10(nextRoomState, options);

  const nextUrl = getCurrentBeatAudioUrlForPlayerFinal();

  if (previousUrl && nextUrl && previousUrl !== nextUrl) {
    setTimeout(() => {
      restartJamLocalAudioAfterBeatChangeFinal();
    }, 80);
  }

  setTimeout(() => {
    bindJamLocalAudioButtonsFinal();
    updateJamLocalAudioUiFinal();
  }, 120);
};

window.addEventListener("load", () => {
  setTimeout(() => {
    ensureJamLocalAudioFinal();
    bindJamLocalAudioButtonsFinal();
    updateJamLocalAudioUiFinal();
  }, 1600);

  setTimeout(() => {
    bindJamLocalAudioButtonsFinal();
    updateJamLocalAudioUiFinal();
  }, 3600);
});

// =======================
// ETAP 55B-11A — INFINITY LOOP ONLY
// Bezpieczne zapętlenie lokalnego audio bez render-loopów
// =======================

let jamInfinityLoopEnabled55B11A = true;

function applyInfinityLoop55B11A() {
  const audio = ensureJamLocalAudioFinal();

  if (!audio) {
    return;
  }

  audio.loop = Boolean(jamInfinityLoopEnabled55B11A);
}

function updateInfinityLoopUi55B11A() {
  const infinityBtn = document.querySelector("#jamLoopInfinityFinal");
  const status = ensureJamAudioStatusFinal();

  if (infinityBtn) {
    infinityBtn.classList.toggle("jam-btn-primary", jamInfinityLoopEnabled55B11A);
    infinityBtn.innerText = jamInfinityLoopEnabled55B11A
      ? "INFINITY ON"
      : "INFINITY";
  }

  if (status && !jamLocalAudioPlayingFinal && !jamLocalAudioLoadingFinal) {
    status.innerText = jamInfinityLoopEnabled55B11A
      ? "Audio: gotowe lokalnie | Infinity loop ON"
      : "Audio: gotowe lokalnie";
  }
}

function bindInfinityLoopButton55B11A() {
  const infinityBtn = document.querySelector("#jamLoopInfinityFinal");

  if (!infinityBtn || infinityBtn.dataset.infinityBound55B11A === "true") {
    return;
  }

  infinityBtn.dataset.infinityBound55B11A = "true";

  infinityBtn.onclick = () => {
    jamInfinityLoopEnabled55B11A = !jamInfinityLoopEnabled55B11A;

    applyInfinityLoop55B11A();
    updateInfinityLoopUi55B11A();

    showSystemInfo(
      jamInfinityLoopEnabled55B11A
        ? "INFINITY LOOP ON"
        : "INFINITY LOOP OFF",
      "success"
    );
  };
}

const previousEnsureJamLocalAudioFinal55B11A = ensureJamLocalAudioFinal;

ensureJamLocalAudioFinal = function ensureJamLocalAudioInfinity55B11A() {
  const audio = previousEnsureJamLocalAudioFinal55B11A();

  audio.loop = Boolean(jamInfinityLoopEnabled55B11A);

  return audio;
};

const previousStartJamLocalAudioFinal55B11A = startJamLocalAudioFinal;

startJamLocalAudioFinal = async function startJamLocalAudioInfinity55B11A() {
  applyInfinityLoop55B11A();

  await previousStartJamLocalAudioFinal55B11A();

  applyInfinityLoop55B11A();
  updateInfinityLoopUi55B11A();
};

const previousLoadJamLocalAudioFinal55B11A = loadJamLocalAudioFinal;

loadJamLocalAudioFinal = async function loadJamLocalAudioInfinity55B11A(url) {
  const loaded = await previousLoadJamLocalAudioFinal55B11A(url);

  applyInfinityLoop55B11A();
  updateInfinityLoopUi55B11A();

  return loaded;
};

const previousBindJamLocalAudioButtonsFinal55B11A = bindJamLocalAudioButtonsFinal;

bindJamLocalAudioButtonsFinal = function bindJamLocalAudioButtonsInfinity55B11A() {
  previousBindJamLocalAudioButtonsFinal55B11A();

  bindInfinityLoopButton55B11A();
  applyInfinityLoop55B11A();
  updateInfinityLoopUi55B11A();
};

window.addEventListener("load", () => {
  setTimeout(() => {
    bindInfinityLoopButton55B11A();
    applyInfinityLoop55B11A();
    updateInfinityLoopUi55B11A();
  }, 1800);

  setTimeout(() => {
    bindInfinityLoopButton55B11A();
    applyInfinityLoop55B11A();
    updateInfinityLoopUi55B11A();
  }, 3600);
});

// =======================
// ETAP 55B-11B-FIX — PITCH UI + PLAYBACKRATE ONLY
// Poprawny układ: [suwak pitch] / [PITCH -] [0%] [PITCH +]
// Bez BPM, bez finite loopów, bez render-loopów
// =======================

let jamPitchRate55B11BFix = 1;

function getJamPitchPercent55B11BFix() {
  return Math.round((jamPitchRate55B11BFix - 1) * 100);
}

function clampJamPitchRate55B11BFix(value) {
  const parsed = Number(value || 1);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(0.8, Math.min(1.2, parsed));
}

function applyJamPitchRate55B11BFix() {
  const audio = ensureJamLocalAudioFinal();

  if (!audio) {
    return;
  }

  audio.playbackRate = jamPitchRate55B11BFix;
}

function ensurePitchPanelStyles55B11BFix() {
  if (document.querySelector("#jamPitchPanelStyles55B11BFix")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "jamPitchPanelStyles55B11BFix";

  style.innerHTML = `
    .jam-pitch-panel-55b11bfix {
      width: min(100%, 360px);
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: 16px;
      border: 1px solid rgba(234,162,33,0.24);
      background: rgba(0,0,0,0.22);
    }

    .jam-pitch-panel-55b11bfix input[type="range"] {
      width: 100%;
      accent-color: rgba(234,162,33,0.96);
      cursor: pointer;
    }

    .jam-pitch-actions-55b11bfix {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
      align-items: center;
    }

    .jam-pitch-actions-55b11bfix .jam-btn {
      min-height: 36px;
      padding: 7px 10px;
      justify-content: center;
      font-size: 12px;
    }

    #jamPitchReset55B11BFix {
      border-color: rgba(234,162,33,0.62);
      color: rgba(234,162,33,0.98);
      font-weight: 900;
    }

    #jamPitchReset55B11BFix.active-zero {
      background: rgba(234,162,33,0.16);
      box-shadow:
        0 0 0 1px rgba(234,162,33,0.18),
        0 0 22px rgba(234,162,33,0.12);
    }

    .jam-loop-group-55b11bfix {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .jam-loop-group-55b11bfix .jam-btn {
      min-height: 36px;
    }

    .jam-pitch-readout-55b11bfix {
      color: rgba(255,255,255,0.62);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      text-align: center;
    }
  `;

  document.head.appendChild(style);
}

function ensureLoopPitchLayout55B11BFix() {
  ensurePitchPanelStyles55B11BFix();

  const controls = document.querySelector("#jamLooperControlsFinal");

  if (!controls) {
    return;
  }

  const loopButtons = [
    document.querySelector("#jamLoopInfinityFinal"),
    document.querySelector("#jamLoop1Final"),
    document.querySelector("#jamLoop2Final"),
    document.querySelector("#jamLoop4Final"),
    document.querySelector("#jamLoop6Final"),
    document.querySelector("#jamLoop8Final")
  ].filter(Boolean);

  let loopGroup = document.querySelector("#jamLoopGroup55B11BFix");

  if (!loopGroup) {
    loopGroup = document.createElement("div");
    loopGroup.id = "jamLoopGroup55B11BFix";
    loopGroup.className = "jam-loop-group-55b11bfix";

    const firstLoopButton = loopButtons[0];

    if (firstLoopButton && firstLoopButton.parentNode) {
      firstLoopButton.parentNode.insertBefore(loopGroup, firstLoopButton);
    } else {
      controls.appendChild(loopGroup);
    }
  }

  loopButtons.forEach((button) => {
    loopGroup.appendChild(button);
  });

  const slider = document.querySelector("#jamPitchSliderFinal");
  const minusBtn = document.querySelector("#jamPitchMinusFinal");
  const plusBtn = document.querySelector("#jamPitchPlusFinal");

  if (!slider || !minusBtn || !plusBtn) {
    return;
  }

  let pitchPanel = document.querySelector("#jamPitchPanel55B11BFix");

  if (!pitchPanel) {
    pitchPanel = document.createElement("div");
    pitchPanel.id = "jamPitchPanel55B11BFix";
    pitchPanel.className = "jam-pitch-panel-55b11bfix";

    const pitchReadout = document.createElement("div");
    pitchReadout.id = "jamPitchReadout55B11BFix";
    pitchReadout.className = "jam-pitch-readout-55b11bfix";
    pitchReadout.innerText = "Pitch: 0%";

    const actions = document.createElement("div");
    actions.id = "jamPitchActions55B11BFix";
    actions.className = "jam-pitch-actions-55b11bfix";

    let resetBtn = document.querySelector("#jamPitchReset55B11BFix");

    if (!resetBtn) {
      resetBtn = document.createElement("button");
      resetBtn.id = "jamPitchReset55B11BFix";
      resetBtn.type = "button";
      resetBtn.className = "jam-btn";
      resetBtn.innerText = "0%";
    }

    const oldPitchBox = slider.closest(".jam-looper-final-pitch");

    if (oldPitchBox && oldPitchBox.parentNode) {
      oldPitchBox.parentNode.insertBefore(pitchPanel, oldPitchBox);
    } else {
      controls.appendChild(pitchPanel);
    }

    pitchPanel.appendChild(slider);
    pitchPanel.appendChild(pitchReadout);
    pitchPanel.appendChild(actions);

    actions.appendChild(minusBtn);
    actions.appendChild(resetBtn);
    actions.appendChild(plusBtn);

    if (oldPitchBox && oldPitchBox.children.length === 0) {
      oldPitchBox.remove();
    }
  }

  minusBtn.innerText = "PITCH -";
  plusBtn.innerText = "PITCH +";

  slider.min = "0.8";
  slider.max = "1.2";
  slider.step = "0.01";
  slider.value = String(jamPitchRate55B11BFix);
}

function updatePitchUi55B11BFix() {
  const slider = document.querySelector("#jamPitchSliderFinal");
  const resetBtn = document.querySelector("#jamPitchReset55B11BFix");
  const readout = document.querySelector("#jamPitchReadout55B11BFix");
  const status = ensureJamAudioStatusFinal();

  const percent = getJamPitchPercent55B11BFix();

  if (slider) {
    slider.value = String(jamPitchRate55B11BFix);
  }

  if (resetBtn) {
    resetBtn.innerText = "0%";
    resetBtn.classList.toggle("active-zero", percent === 0);
    resetBtn.classList.toggle("jam-btn-primary", percent === 0);
    resetBtn.title = "Reset pitch do 0%";
  }

  if (readout) {
    readout.innerText = `Pitch: ${percent > 0 ? "+" : ""}${percent}%`;
  }

  if (status && !jamLocalAudioLoadingFinal) {
    const baseText = jamLocalAudioPlayingFinal
      ? `Audio: gra lokalnie — ${getCurrentBeatLabelForPlayerFinal()}`
      : jamLocalAudioUrlFinal
        ? "Audio: zatrzymane lokalnie"
        : "Audio: gotowe lokalnie";

    const loopText = jamInfinityLoopEnabled55B11A
      ? "Infinity loop ON"
      : "Infinity loop OFF";

    status.innerText =
      `${baseText} | ${loopText} | Pitch: ${percent > 0 ? "+" : ""}${percent}%`;
  }
}

function setJamPitchRate55B11BFix(nextRate, showMessage = false) {
  jamPitchRate55B11BFix = clampJamPitchRate55B11BFix(nextRate);

  applyJamPitchRate55B11BFix();
  updatePitchUi55B11BFix();

  if (showMessage) {
    const percent = getJamPitchPercent55B11BFix();

    showSystemInfo(
      percent === 0
        ? "Pitch reset 0%"
        : `Pitch: ${percent > 0 ? "+" : ""}${percent}%`,
      "success"
    );
  }
}

function changeJamPitch55B11BFix(deltaRate) {
  setJamPitchRate55B11BFix(
    jamPitchRate55B11BFix + Number(deltaRate || 0),
    true
  );
}

function bindPitchControls55B11BFix() {
  ensureLoopPitchLayout55B11BFix();

  const slider = document.querySelector("#jamPitchSliderFinal");
  const minusBtn = document.querySelector("#jamPitchMinusFinal");
  const plusBtn = document.querySelector("#jamPitchPlusFinal");
  const resetBtn = document.querySelector("#jamPitchReset55B11BFix");

  if (slider && slider.dataset.pitchBound55B11BFix !== "true") {
    slider.dataset.pitchBound55B11BFix = "true";

    slider.oninput = () => {
      setJamPitchRate55B11BFix(Number(slider.value || 1), false);
    };
  }

  if (minusBtn && minusBtn.dataset.pitchMinusBound55B11BFix !== "true") {
    minusBtn.dataset.pitchMinusBound55B11BFix = "true";

    minusBtn.onclick = () => {
      changeJamPitch55B11BFix(-0.01);
    };
  }

  if (plusBtn && plusBtn.dataset.pitchPlusBound55B11BFix !== "true") {
    plusBtn.dataset.pitchPlusBound55B11BFix = "true";

    plusBtn.onclick = () => {
      changeJamPitch55B11BFix(0.01);
    };
  }

  if (resetBtn && resetBtn.dataset.pitchResetBound55B11BFix !== "true") {
    resetBtn.dataset.pitchResetBound55B11BFix = "true";

    resetBtn.onclick = () => {
      setJamPitchRate55B11BFix(1, true);
    };
  }

  applyJamPitchRate55B11BFix();
  updatePitchUi55B11BFix();
}

const previousEnsureJamLocalAudioFinal55B11BFix = ensureJamLocalAudioFinal;

ensureJamLocalAudioFinal = function ensureJamLocalAudioPitch55B11BFix() {
  const audio = previousEnsureJamLocalAudioFinal55B11BFix();

  audio.playbackRate = jamPitchRate55B11BFix;

  return audio;
};

const previousStartJamLocalAudioFinal55B11BFix = startJamLocalAudioFinal;

startJamLocalAudioFinal = async function startJamLocalAudioPitch55B11BFix() {
  await previousStartJamLocalAudioFinal55B11BFix();

  applyJamPitchRate55B11BFix();
  updatePitchUi55B11BFix();
};

const previousLoadJamLocalAudioFinal55B11BFix = loadJamLocalAudioFinal;

loadJamLocalAudioFinal = async function loadJamLocalAudioPitch55B11BFix(url) {
  const loaded = await previousLoadJamLocalAudioFinal55B11BFix(url);

  applyJamPitchRate55B11BFix();
  updatePitchUi55B11BFix();

  return loaded;
};

const previousRenderJamLooperPlayerFinal55B11BFix = renderJamLooperPlayerFinal;

renderJamLooperPlayerFinal = function renderJamLooperPlayerPitch55B11BFix() {
  previousRenderJamLooperPlayerFinal55B11BFix();

  setTimeout(() => {
    bindPitchControls55B11BFix();
  }, 30);
};

window.addEventListener("load", () => {
  setTimeout(() => {
    bindPitchControls55B11BFix();
  }, 1800);

  setTimeout(() => {
    bindPitchControls55B11BFix();
  }, 3600);
});
