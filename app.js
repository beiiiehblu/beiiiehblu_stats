const DATA_URL = "public_viewers.json";
const FALLBACK_URL = "public_viewers.example.json";
const REFRESH_MS = 5 * 60 * 1000;

const TOP_ALWAYS = 25;
const ACTIVE_DAYS = 30;
const MIN_MESSAGES_ACTIVE = 5;

const names = {
  level: "Уровни",
  watchtime: "Время",
  messages: "Сообщения",
  visits: "Визиты",
  clips: "Клипы",
  raids: "Рейды"
};

let data = null;
let current = "level";
let period = "all";
let search = "";
let selected = null;

const $ = (s) => document.querySelector(s);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

function num(v) {
  return new Intl.NumberFormat("ru-RU").format(Number(v) || 0);
}

function duration(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}ч ${m}м` : `${m}м`;
}

function levelText(level) {
  return `${Number(level) || 0} ур.`;
}

function lastVisit(value) {
  if (!value) return { time: "—", date: "" };

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { time: "—", date: String(value) };
  }

  return {
    time: d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    date: d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    })
  };
}

function profile(username) {
  return data?.profiles?.[username] || null;
}

function isHiddenProfile(p) {
  return Boolean(p?.is_bot || p?.is_broadcaster);
}

function isActive(p) {
  if (!p || isHiddenProfile(p)) return false;

  const last = p.last_seen || p.last_visit_at;
  if (!last) return false;

  const d = new Date(last);
  if (Number.isNaN(d.getTime())) return false;

  const ageDays = (Date.now() - d.getTime()) / 86400000;
  if (ageDays < 0 || ageDays > ACTIVE_DAYS) return false;

  // Импорт мог дать зрителю свежий last_seen без реального
  // присутствия в чате. Поэтому активность подтверждаем
  // минимум пятью сообщениями.
  return Number(p.messages) >= MIN_MESSAGES_ACTIVE;
}

function periodData() {
  // Текущий public_viewers.json от Бешенного хранит
  // all-time leaderboard напрямую в data.leaderboards.
  // Неделя/месяц пока не трогаем — после стрима добавим
  // полноценную поддержку периодов.
  if (data?.leaderboards) {
    if (period === "all") {
      return {
        leaderboards: data.leaderboards
      };
    }

    // Если в будущем VPS начнёт отдавать периоды в старом формате,
    // продолжаем поддерживать и его.
    return data?.periods?.[period] || null;
  }

  // Совместимость со старым форматом JSON.
  return data?.periods?.[period] || null;
}

function boardRows() {
  const p = periodData();
  if (!p?.leaderboards) return [];
  return p.leaderboards[current] || [];
}

function valueFor(row) {
  if (current === "level") {
    if (period !== "all") return `+${num(row.value)} XP`;
    return levelText(row.level);
  }

  if (current === "watchtime") return duration(row.value ?? row.watch_seconds);
  return num(row.value ?? row[current]);
}

function matches(target) {
  const q = search.trim().toLocaleLowerCase("ru-RU");
  if (!q) return true;

  const username = target?.username || "";
  const displayName = target?.display_name || "";

  return `${username} ${displayName}`
    .toLocaleLowerCase("ru-RU")
    .includes(q);
}

function searchRows() {
  const q = search.trim();
  if (!q) return [];

  const board = boardRows();
  const byName = new Map(
    board.map(row => [String(row.username || "").toLowerCase(), row])
  );

  return Object.values(data?.profiles || {})
    .filter(p => !isHiddenProfile(p) && matches(p))
    .map(p => {
      const username = String(p.username || "").toLowerCase();
      const row = byName.get(username);

      if (row) return row;

      // Пользователь существует в базе, но в выбранном рейтинге
      // у него нет ненулевого значения. Всё равно показываем его
      // в результате поиска, сохраняя настоящий rank, если он есть.
      return {
        rank: p.rank ?? "—",
        username,
        display_name: p.display_name || username,
        level: Number(p.level) || 0,
        xp: Number(p.xp) || 0,
        value:
          current === "level" ? Number(p.xp) || 0 :
          current === "watchtime" ? Number(p.watch_seconds) || 0 :
          Number(p[current]) || 0,
        watch_seconds: Number(p.watch_seconds) || 0,
        messages: Number(p.messages) || 0,
        visits: Number(p.visits) || 0,
        clips: Number(p.clips) || 0,
        raids: Number(p.raids) || 0,
        avatar: p.avatar || null
      };
    });
}

function visibleRows() {
  const allRows = boardRows();

  if (search.trim()) {
    return searchRows();
  }

  const top = allRows.filter(row => Number(row.rank) <= TOP_ALWAYS);
  const topNames = new Set(top.map(row => row.username));

  const active = allRows.filter(row =>
    Number(row.rank) > TOP_ALWAYS &&
    !topNames.has(row.username) &&
    isActive(profile(row.username))
  );

  return [...top, ...active];
}

function avatar(url, large = false) {
  if (!url) {
    return `<div class="avatar ${large ? "large" : ""} avatar-empty"></div>`;
  }

  return `<img class="avatar ${large ? "large" : ""}" src="${esc(url)}" alt="" loading="lazy">`;
}

function renderBoard() {
  const pData = periodData();
  const rows = visibleRows();
  const total = Number(data?.count) || Object.keys(data?.profiles || {}).length;
  const active = Object.values(data?.profiles || {}).filter(isActive).length;

  $("#boardTitle").textContent = names[current];

  if (search.trim()) {
    $("#count").textContent = `${rows.length} найдено`;
  } else if (!pData) {
    $("#count").textContent = "Нет данных";
  } else {
    $("#count").textContent = `${TOP_ALWAYS} лидеров · ${active} активных · ${total} всего`;
  }

  if (!pData) {
    $("#board").innerHTML = `
      <div class="profile-empty">
        Для периода «${esc(periodLabel())}» данных по этому рейтингу пока нет.
      </div>`;
    closeProfile();
    return;
  }

  if (!rows.length) {
    $("#board").innerHTML = `
      <div class="profile-empty">
        Для этого рейтинга в периоде «${esc(periodLabel())}» пока нет данных.
      </div>`;
    closeProfile();
    return;
  }

  let previousTop = null;

  $("#board").innerHTML = rows.map(row => {
    const p = profile(row.username) || {};
    const isTop = Number(row.rank) <= TOP_ALWAYS;
    const divider = !search.trim() && previousTop === true && !isTop
      ? `<div class="section-divider">АКТИВНЫЕ ЗРИТЕЛИ</div>`
      : "";

    previousTop = isTop;

    return `
      ${divider}
      <button class="row" type="button" data-user="${esc(row.username)}">
        <span class="rank">${
          Number.isFinite(Number(row.rank)) && Number(row.rank) > 0
            ? num(row.rank)
            : "—"
        }</span>
        <span class="user">
          ${avatar(p.avatar || row.avatar)}
          <span class="user-name">${esc(p.display_name || row.display_name || row.username)}</span>
        </span>
        <span class="value">${esc(valueFor(row))}</span>
      </button>`;
  }).join("");

  document.querySelectorAll(".row").forEach(row => {
    row.addEventListener("click", () => openProfile(row.dataset.user));
  });
}

function periodLabel() {
  return {
    week: "Неделя",
    month: "Месяц",
    all: "Всё время"
  }[period] || period;
}

function openProfile(username) {
  const p = profile(username);
  if (!p) return;

  selected = username;

  const last = lastVisit(p.last_visit_at || p.last_seen);
  const nextLevel = Number(p.level || 0) + 1;
  const progress = Math.max(0, Math.min(1, Number(p.progress) || 0));

  $("#profileName").textContent = p.display_name || username;

  const flags = [
    p.is_followed ? `<span class="flag follower">Follower</span>` : "",
    p.is_subscriber ? `<span class="flag subscriber">Subscriber</span>` : "",
    p.is_vip ? `<span class="flag vip">VIP</span>` : "",
    p.is_moderator ? `<span class="flag moderator">Moderator</span>` : ""
  ].join("");

  $("#profile").innerHTML = `
    <div class="profile">
      <div class="profile-top">
        ${avatar(p.avatar, true)}
        <div>
          <strong>${esc(p.display_name || username)}</strong>
          <div class="profile-level">${levelText(p.level)}</div>
        </div>
      </div>

      <div class="progress-wrap">
        <div class="progress-meta">
          <span>${num(p.xp)} XP</span>
          <span>${num(p.xp_to_next)} до ${levelText(nextLevel)}</span>
        </div>
        <div class="progress"><span style="width:${progress * 100}%"></span></div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-label">Время</div><div class="stat-value">${duration(p.watch_seconds)}</div></div>
        <div class="stat"><div class="stat-label">Сообщения</div><div class="stat-value">${num(p.messages)}</div></div>
        <div class="stat"><div class="stat-label">Визиты</div><div class="stat-value">${num(p.visits)}</div></div>
        <div class="stat"><div class="stat-label">Клипы</div><div class="stat-value">${num(p.clips)}</div></div>
        <div class="stat"><div class="stat-label">Рейды</div><div class="stat-value">${num(p.raids)}</div></div>
        <div class="stat">
          <div class="stat-label">Последний визит</div>
          <div class="stat-value visit-value">
            <span>${esc(last.time)}</span>
            <small>${esc(last.date)}</small>
          </div>
        </div>
      </div>

      <div class="flags">${flags}</div>
    </div>`;

  $("#profilePanel").classList.add("open");
  $("#profilePanel").setAttribute("aria-hidden", "false");
}

function closeProfile() {
  selected = null;
  $("#profilePanel").classList.remove("open");
  $("#profilePanel").setAttribute("aria-hidden", "true");
}

function updatePeriods() {
  const has = data?.periods;
  $("#periods").hidden = !has;

  if (!has) return;

  document.querySelectorAll(".period").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.period === period);
  });
}

async function fetchJson(url) {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(
    `${url}${separator}t=${Date.now()}`,
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function load() {
  try {
    try {
      data = await fetchJson(DATA_URL);
    } catch {
      data = await fetchJson(FALLBACK_URL);
    }

    $("#updated").textContent = data.updated_at
      ? `Обновлено: ${new Date(data.updated_at).toLocaleString("ru-RU")}`
      : "Обновление раз в 5 минут";

    updatePeriods();
    renderBoard();

    if (selected && profile(selected)) {
      openProfile(selected);
    }
  } catch (error) {
    console.error("[TWITCH WIDGET]", error);
    $("#updated").textContent = "Не удалось загрузить статистику";
    $("#board").innerHTML = `<div class="profile-empty">Не удалось загрузить данные.</div>`;
    closeProfile();
  }
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    current = tab.dataset.board;

    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    tab.classList.add("active");

    // Вкладка периода НЕ сбрасывается.
    // Профиль закрываем только потому, что его данные могут относиться
    // к другой категории.
    closeProfile();
    renderBoard();
  });
});

document.querySelectorAll(".period").forEach(btn => {
  btn.addEventListener("click", () => {
    period = btn.dataset.period;

    document.querySelectorAll(".period").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");

    closeProfile();
    renderBoard();
  });
});

$("#search").addEventListener("input", e => {
  search = e.target.value;
  closeProfile();
  renderBoard();
});

$("#closeProfile").addEventListener("click", closeProfile);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeProfile();
});

load();
setInterval(load, REFRESH_MS);
