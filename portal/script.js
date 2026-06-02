const groups = [
  { value: "peito", label: "Peito" },
  { value: "costas", label: "Costas" },
  { value: "pernas", label: "Pernas" },
  { value: "gluteos", label: "Gluteos" },
  { value: "ombros", label: "Ombros" },
  { value: "biceps", label: "Biceps" },
  { value: "triceps", label: "Triceps" },
  { value: "cardio", label: "Aerobico" },
];

const objectiveOptions = [
  { value: "geral", label: "Geral" },
  { value: "perda_de_peso", label: "Perda de peso" },
  { value: "definicao", label: "Definicao" },
];

const userObjectiveOptions = objectiveOptions.filter((option) => option.value !== "geral");

const environmentOptions = [
  { value: "casa", label: "Casa" },
  { value: "academia", label: "Academia" },
];

const sexOptions = [
  { value: "masculino", label: "Masculino" },
  { value: "feminino", label: "Feminino" },
  { value: "outro", label: "Outro" },
];

const levelOptions = [
  { value: "iniciante", label: "Iniciante" },
  { value: "intermediario", label: "Intermediario" },
  { value: "avancado", label: "Avancado" },
];

const portalRoleOptions = [
  { value: "admin", label: "Admin" },
  { value: "instrutor", label: "Instrutor" },
  { value: "visualizador", label: "Visualizador" },
];

const portalRoleLabels = Object.fromEntries(
  portalRoleOptions.map((option) => [option.value, option.label])
);

const portalPermissionOptions = [
  { value: "students.read", label: "Ver alunos" },
  { value: "students.write", label: "Editar alunos" },
  { value: "workouts.write", label: "Editar treinos" },
  { value: "exercises.read", label: "Ver exercicios" },
  { value: "exercises.write", label: "Editar exercicios" },
  { value: "portal_users.read", label: "Ver acessos do portal" },
  { value: "portal_users.write", label: "Gerenciar acessos do portal" },
];

const rolePermissionPresets = {
  admin: portalPermissionOptions.map((item) => item.value),
  instrutor: [
    "students.read",
    "students.write",
    "workouts.write",
    "exercises.read",
    "exercises.write",
  ],
  visualizador: ["students.read", "exercises.read"],
};

const trainingDayOptions = ["2", "3", "4", "5", "6"].map((value) => ({
  value,
  label: `${value}x`,
}));

const objectiveLabels = {
  geral: "Geral",
  perda_de_peso: "Perda de peso",
  definicao: "Definicao",
};

const environmentLabels = {
  casa: "Casa",
  academia: "Academia",
};

const groupLabels = Object.fromEntries(groups.map((group) => [group.value, group.label]));
const eyeIconMarkup = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;
const eyeOffIconMarkup = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m3 3 18 18"></path>
    <path d="M10.6 5.1A12.4 12.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-4.1 4.9"></path>
    <path d="M6.7 6.7C4.2 8.4 2.7 12 2.7 12A17.3 17.3 0 0 0 12 19c1.8 0 3.4-.4 4.8-1.1"></path>
    <path d="M9.9 9.9A3 3 0 0 0 14 14.1"></path>
  </svg>
`;

const screenDefinitions = {
  dashboard: {
    eyebrow: "Portal FatBurn",
    title: "Home",
    description: "Resumo do portal e indicadores principais.",
    available: () => true,
  },
  students: {
    eyebrow: "Alunos",
    title: "Alunos",
    description: "Cadastros, edicao de perfil e manutencao da ficha semanal.",
    available: () => hasPermission("students.read"),
  },
  exercises: {
    eyebrow: "Exercicios",
    title: "Exercicios",
    description: "Biblioteca tecnica e cadastro de novos exercicios do app.",
    available: () => hasPermission("exercises.read") || hasPermission("exercises.write"),
  },
  access: {
    eyebrow: "Acessos",
    title: "Acessos do portal",
    description: "Perfis internos, permissoes e status de acesso ao painel.",
    available: () => hasPermission("portal_users.read") || hasPermission("portal_users.write"),
  },
};

const $ = (selector) => document.querySelector(selector);

const state = {
  session: null,
  instructor: null,
  portalUsers: [],
  users: [],
  exercises: [],
  studentQuery: "",
  exerciseQuery: "",
  activeScreen: "dashboard",
};

const SESSION_STORAGE_KEY = "fatburn.portal.session";
const API_BASE_URL = "https://fatburn-backend.onrender.com";
const AUTO_REFRESH_INTERVAL_MS = 60_000;
const loadingState = {
  depth: 0,
};
let autoRefreshTimer = null;
let autoRefreshInFlight = false;

function showNotice(message, tone = "info") {
  const container = $("#notice");
  container.textContent = message;
  container.dataset.tone = tone;
  container.classList.remove("hidden");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    container.classList.add("hidden");
  }, 4000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function optionMarkup(options, selectedValue) {
  return options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${
          option.value === selectedValue ? " selected" : ""
        }>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function getPasswordToggleMarkup(disabled = false) {
  return `
    <button
      class="password-toggle"
      data-password-toggle
      type="button"
      aria-label="Mostrar senha"
      title="Mostrar senha"
      ${disabled ? "disabled" : ""}
    >
      ${eyeIconMarkup}
    </button>
  `;
}

function wrapPasswordInput(inputMarkup, disabled = false) {
  return `<div class="password-input">${inputMarkup}${getPasswordToggleMarkup(disabled)}</div>`;
}

function syncPasswordToggleButton(button, visible) {
  button.dataset.visible = visible ? "true" : "false";
  button.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
  button.setAttribute("title", visible ? "Ocultar senha" : "Mostrar senha");
  button.innerHTML = visible ? eyeOffIconMarkup : eyeIconMarkup;
}

function togglePasswordVisibility(button) {
  const wrapper = button.closest(".password-input");
  const input = wrapper?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  syncPasswordToggleButton(button, visible);
}

function getPasswordValidationError(password, confirmPassword, required = false) {
  const passwordValue = String(password ?? "").trim();
  const confirmValue = String(confirmPassword ?? "").trim();

  if (required && !passwordValue) {
    return "Preencha a senha para continuar.";
  }

  if (!passwordValue && !confirmValue) {
    return null;
  }

  if (passwordValue.length < 8) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }

  if (!passwordValue || !confirmValue) {
    return "Confirme a senha para continuar.";
  }

  if (passwordValue !== confirmValue) {
    return "As senhas informadas nao conferem.";
  }

  return null;
}

function populateGroups() {
  const select = $("#exercise-group");
  select.innerHTML = optionMarkup(groups, "peito");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesQuery(parts, query) {
  if (!query) {
    return true;
  }

  return normalizeText(parts.filter(Boolean).join(" ")).includes(query);
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.token) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function persistSession(sessionPayload) {
  state.session = { token: sessionPayload.token, role: sessionPayload.role };
  state.instructor = sessionPayload.instructor ?? null;
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      token: sessionPayload.token,
      role: sessionPayload.role,
      instructor: sessionPayload.instructor ?? null,
    })
  );
}

function clearSession() {
  state.session = null;
  state.instructor = null;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  stopAutoRefresh();
}

function resetPortalUiForLoggedOut(options = {}) {
  const { preserveNotice = false } = options;

  clearSession();
  resetCollections();
  state.activeScreen = "dashboard";
  state.studentQuery = "";
  state.exerciseQuery = "";
  $("#portal-login-password").value = "";
  $("#students-search").value = "";
  $("#exercises-search").value = "";
  setLoginBusy(false);
  setSidebarOpen(false);
  syncAuthUi();
  renderUsers();
  renderExercises();
  renderPortalUsers();
  syncNavigation();

  if (!preserveNotice) {
    $("#notice").classList.add("hidden");
  }
}

function setLoading(isLoading, title = "Carregando portal", message = "Aguarde alguns segundos.") {
  const overlay = $("#portal-loading");
  const titleNode = $("#portal-loading-title");
  const messageNode = $("#portal-loading-message");

  if (isLoading) {
    loadingState.depth += 1;
    titleNode.textContent = title;
    messageNode.textContent = message;
    overlay.classList.remove("hidden");
    return;
  }

  loadingState.depth = Math.max(0, loadingState.depth - 1);
  if (loadingState.depth === 0) {
    overlay.classList.add("hidden");
  }
}

async function withLoading(title, message, task) {
  setLoading(true, title, message);
  try {
    return await task();
  } finally {
    setLoading(false);
  }
}

function setLoginBusy(isBusy) {
  const button = $("#portal-login");
  const email = $("#portal-login-email");
  const password = $("#portal-login-password");

  button.disabled = isBusy;
  email.disabled = isBusy;
  password.disabled = isBusy;
  button.textContent = isBusy ? "Entrando..." : "Entrar no portal";
}

function escapeSelectorValue(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function captureOpenEditors(selector, dataKey) {
  return [...document.querySelectorAll(`details.editor[open] ${selector}`)]
    .map((element) => element.dataset[dataKey])
    .filter(Boolean);
}

function capturePortalUiState() {
  return {
    scrollY: window.scrollY,
    openUserEditors: captureOpenEditors("[data-user-id]", "userId"),
    openExerciseEditors: captureOpenEditors("[data-exercise-id]", "exerciseId"),
    openPortalUserEditors: captureOpenEditors("[data-portal-user-id]", "portalUserId"),
  };
}

function restorePortalUiState(snapshot) {
  snapshot.openUserEditors.forEach((id) => {
    document
      .querySelector(`[data-user-id="${escapeSelectorValue(id)}"]`)
      ?.closest("details.editor")
      ?.setAttribute("open", "");
  });

  snapshot.openExerciseEditors.forEach((id) => {
    document
      .querySelector(`[data-exercise-id="${escapeSelectorValue(id)}"]`)
      ?.closest("details.editor")
      ?.setAttribute("open", "");
  });

  snapshot.openPortalUserEditors.forEach((id) => {
    document
      .querySelector(`[data-portal-user-id="${escapeSelectorValue(id)}"]`)
      ?.closest("details.editor")
      ?.setAttribute("open", "");
  });

  window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
}

function collectionsChanged(nextUsers, nextExercises, nextPortalUsers) {
  return (
    JSON.stringify(state.users) !== JSON.stringify(nextUsers) ||
    JSON.stringify(state.exercises) !== JSON.stringify(nextExercises) ||
    JSON.stringify(state.portalUsers) !== JSON.stringify(nextPortalUsers)
  );
}

function shouldDeferSilentRefresh() {
  if (document.hidden) {
    return true;
  }

  const active = document.activeElement;
  if (!active) {
    return false;
  }

  return Boolean(active.closest("input, textarea, select"));
}

function startAutoRefresh() {
  stopAutoRefresh();

  if (!state.session?.token) {
    return;
  }

  autoRefreshTimer = window.setInterval(() => {
    refreshSilently();
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function resetCollections() {
  state.portalUsers = [];
  state.users = [];
  state.exercises = [];
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle("sidebar-expanded", isOpen);
  $("#sidebar-backdrop").classList.toggle("hidden", !isOpen);
}

function syncAuthUi() {
  const gate = $("#auth-gate");
  const page = $(".page");
  const logoutButton = $("#portal-logout");
  const sessionMeta = $("#portal-session-meta");
  const loggedIn = Boolean(state.session?.token);

  gate.classList.toggle("hidden", loggedIn);
  page.classList.toggle("hidden", !loggedIn);
  logoutButton.classList.toggle("hidden", !loggedIn);
  sessionMeta.classList.toggle("hidden", !loggedIn);

  if (loggedIn && state.instructor) {
    sessionMeta.innerHTML = `
      <strong>${escapeHtml(state.instructor.name)}</strong>
      <span>${escapeHtml(portalRoleLabels[state.instructor.role] ?? state.instructor.role)}</span>
    `;
  } else {
    sessionMeta.innerHTML = "";
  }

  if (!loggedIn) {
    setSidebarOpen(false);
  }
}

function getCurrentPermissions() {
  return state.instructor?.permissions ?? [];
}

function hasPermission(permission) {
  return getCurrentPermissions().includes(permission);
}

function getPermissionsForRole(role) {
  return rolePermissionPresets[role] ?? rolePermissionPresets.instrutor;
}

function getSelectedPermissions(root) {
  return [...root.querySelectorAll("[data-permission-checkbox]:checked")].map(
    (input) => input.value
  );
}

function renderPermissionChecklist(selectedPermissions = [], disabled = false, namePrefix = "perm") {
  const selected = new Set(selectedPermissions);
  return portalPermissionOptions
    .map(
      (permission, index) => `
        <label class="permission-item">
          <input
            data-permission-checkbox
            type="checkbox"
            name="${escapeHtml(namePrefix)}-${index}"
            value="${escapeHtml(permission.value)}"
            ${selected.has(permission.value) ? "checked" : ""}
            ${disabled ? "disabled" : ""}
          />
          <span>${escapeHtml(permission.label)}</span>
        </label>
      `
    )
    .join("");
}

function syncPortalSections() {
  const canReadStudents = hasPermission("students.read");
  const canReadExercises = hasPermission("exercises.read");
  const canWriteExercises = hasPermission("exercises.write");
  const canReadPortalUsers = hasPermission("portal_users.read");
  const canWritePortalUsers = hasPermission("portal_users.write");

  $("#portal-students-card").classList.toggle("hidden", !canReadStudents);
  $("#exercise-create-section").classList.toggle("hidden", !canWriteExercises);
  $("#refresh-exercises").classList.toggle("hidden", !canReadExercises);
  $("#portal-exercises-section").classList.toggle("hidden", !canReadExercises);
  $("#portal-access-section").classList.toggle(
    "hidden",
    !(canReadPortalUsers || canWritePortalUsers)
  );
  $("#portal-user-create").classList.toggle("hidden", !canWritePortalUsers);
  $("#portal-users-list").classList.toggle("hidden", !canReadPortalUsers);
  $("#portal-users-count").classList.toggle("hidden", !canReadPortalUsers);
}

function syncCreatePortalUserPermissions() {
  const role = $("#portal-user-role").value;
  const disabled = role === "admin";
  $("#portal-user-permissions").innerHTML = renderPermissionChecklist(
    getPermissionsForRole(role),
    disabled,
    "portal-user-create"
  );
}

function syncEditorPortalUserPermissions(select) {
  const editor = select.closest("[data-portal-user-id]");
  const permissionsRoot = editor?.querySelector("[data-permissions-root]");
  if (!permissionsRoot) {
    return;
  }

  permissionsRoot.innerHTML = renderPermissionChecklist(
    getPermissionsForRole(select.value),
    select.value === "admin",
    `portal-user-${editor.dataset.portalUserId}`
  );
}

function getAvailableScreens() {
  return Object.entries(screenDefinitions)
    .filter(([, definition]) => definition.available())
    .map(([key]) => key);
}

function ensureActiveScreen() {
  const availableScreens = getAvailableScreens();
  if (!availableScreens.includes(state.activeScreen)) {
    state.activeScreen = availableScreens[0] ?? "dashboard";
  }
}

function setActiveScreen(screenKey) {
  const availableScreens = getAvailableScreens();
  state.activeScreen = availableScreens.includes(screenKey)
    ? screenKey
    : availableScreens[0] ?? "dashboard";
  syncNavigation();
  setSidebarOpen(false);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderSummaryRows(container, entries, emptyMessage) {
  if (!container) {
    return;
  }

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = entries
    .map(
      (entry) => `
        <div class="summary-row">
          <span>${escapeHtml(entry.label)}</span>
          <strong>${escapeHtml(entry.value)}</strong>
        </div>
      `
    )
    .join("");
}

function renderChips(container, values, emptyMessage) {
  if (!container) {
    return;
  }

  if (!values.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = values.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("");
}

function countBy(items, resolveKey, labels) {
  const map = new Map();
  items.forEach((item) => {
    const key = resolveKey(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  });

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, total]) => ({
      label: labels[key] ?? key,
      total,
    }));
}

function toCircleMetrics(entries) {
  const total = entries.reduce((sum, item) => sum + item.total, 0);
  let cumulativeRatio = 0;

  return {
    total,
    segments: entries.map((entry) => {
      const ratio = total ? entry.total / total : 0;
      const startRatio = cumulativeRatio;
      cumulativeRatio += ratio;
      return {
        ...entry,
        ratio,
        startRatio,
        endRatio: cumulativeRatio,
      };
    }),
  };
}

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeDonutSegment(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

function renderDonutChart(container, entries, emptyMessage, centerLabel, colors) {
  if (!container) {
    return;
  }

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const total = entries.reduce((sum, entry) => sum + entry.total, 0);
  const { segments } = toCircleMetrics(entries);
  const center = 110;
  const outerRadius = 92;
  const innerRadius = 54;
  const overlapAngle = 0.35;
  const segmentsWithMeta = segments.map((segment, index) => ({
    ...segment,
    index,
    color: colors[index % colors.length],
  }));

  container.innerHTML = `
    <div class="donut-chart">
      <div class="donut-hover-card" data-donut-hover-card>
        <div class="donut-hover-title">status</div>
        <div class="donut-hover-list" data-donut-hover-list></div>
        <div class="donut-hover-footer">
          <strong>Total</strong>
          <strong data-donut-hover-grand-total>${escapeHtml(total)}</strong>
          <span>100%</span>
        </div>
      </div>
      <div class="donut-visual">
        <div class="donut-ring">
          <svg class="donut-svg" viewBox="0 0 220 220" aria-hidden="true">
            <circle class="donut-track" cx="${center}" cy="${center}" r="73"></circle>
            ${segmentsWithMeta
              .map((entry) => {
                const percent = (entry.ratio * 100).toFixed(1);
                const startAngle = -90 + entry.startRatio * 360 - overlapAngle;
                const endAngle = -90 + entry.endRatio * 360 + overlapAngle;
                return `
                  <path
                    class="donut-segment donut-interactive"
                    data-donut-index="${entry.index}"
                    data-donut-label="${escapeHtml(entry.label)}"
                    data-donut-total="${escapeHtml(entry.total)}"
                    data-donut-percent="${escapeHtml(percent)}"
                    data-donut-color="${escapeHtml(entry.color)}"
                    fill="${entry.color}"
                    stroke="${entry.color}"
                    stroke-width="2"
                    stroke-linejoin="round"
                    d="${describeDonutSegment(center, center, outerRadius, innerRadius, startAngle, endAngle)}"
                  ></path>
                `;
              })
              .join("")}
          </svg>
          <div class="donut-hole">
            <strong data-donut-center-value>${escapeHtml(total)}</strong>
            <span data-donut-center-label>${escapeHtml(centerLabel)}</span>
          </div>
        </div>
      </div>
      <div class="donut-legend">
        ${entries
          .map((entry, index) => {
            const color = colors[index % colors.length];
            const percent = ((entry.total / total) * 100).toFixed(1);
            return `
              <div
                class="legend-row"
                data-donut-index="${index}"
              >
                <span class="legend-swatch" style="background:${color}"></span>
                <span class="legend-label">${escapeHtml(entry.label)}</span>
                <strong class="legend-total">${escapeHtml(entry.total)}</strong>
                <span class="legend-percent">${escapeHtml(percent)}%</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  const hoverCard = container.querySelector("[data-donut-hover-card]");
  const hoverTitle = container.querySelector(".donut-hover-title");
  const hoverList = container.querySelector("[data-donut-hover-list]");
  const centerValue = container.querySelector("[data-donut-center-value]");
  const centerLabelNode = container.querySelector("[data-donut-center-label]");
  const segmentNodes = [...container.querySelectorAll(".donut-segment")];
  const legendNodes = [...container.querySelectorAll(".legend-row[data-donut-index]")];
  const chartNode = container.querySelector(".donut-chart");
  const ringNode = container.querySelector(".donut-ring");

  const setActive = (index, visible) => {
    segmentNodes.forEach((node) => {
      const isCurrent = node.dataset.donutIndex === String(index);
      node.classList.toggle("active", visible && isCurrent);
      node.classList.toggle("dimmed", visible && !isCurrent);
    });
    legendNodes.forEach((node) => {
      const isCurrent = node.dataset.donutIndex === String(index);
      node.classList.toggle("active", visible && isCurrent);
      node.classList.toggle("dimmed", visible && !isCurrent);
    });
  };

  const renderHoverList = (activeIndex = null) => {
    if (!hoverList) {
      return;
    }

    hoverList.innerHTML = segmentsWithMeta
      .map((segment) => {
        const percent = `${((segment.ratio ?? 0) * 100).toFixed(1)}%`;
        return `
          <div class="donut-hover-row${activeIndex === segment.index ? " active" : ""}">
            <span class="legend-swatch" style="background:${segment.color}"></span>
            <strong>${escapeHtml(segment.label)}</strong>
            <strong>${escapeHtml(segment.total)}</strong>
            <span>${escapeHtml(percent)}</span>
          </div>
        `;
      })
      .join("");
  };

  const updateHoverPosition = (event) => {
    if (
      !hoverCard ||
      !chartNode ||
      !ringNode ||
      window.matchMedia("(max-width: 720px)").matches ||
      !(event instanceof MouseEvent || event instanceof PointerEvent)
    ) {
      return;
    }

    const chartRect = chartNode.getBoundingClientRect();
    const ringRect = ringNode.getBoundingClientRect();
    const hoverRect = hoverCard.getBoundingClientRect();
    const padding = 12;
    const cursorX = event.clientX - chartRect.left;
    const cursorY = event.clientY - chartRect.top;
    const centerX = ringRect.left - chartRect.left + ringRect.width / 2;
    const centerY = ringRect.top - chartRect.top + ringRect.height / 2;
    const dx = cursorX - centerX;
    const dy = cursorY - centerY;
    const angle = Math.atan2(dy || 0.001, dx || 0.001);
    const orbitRadiusX = ringRect.width / 2 + 24;
    const orbitRadiusY = ringRect.height / 2 + 24;
    const anchorX = centerX + Math.cos(angle) * orbitRadiusX;
    const anchorY = centerY + Math.sin(angle) * orbitRadiusY;
    const horizontalBias = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));

    let left;
    let top;

    if (horizontalBias) {
      left =
        Math.cos(angle) >= 0
          ? anchorX + 14
          : anchorX - hoverRect.width - 14;
      top = anchorY - hoverRect.height / 2;
    } else {
      left = anchorX - hoverRect.width / 2;
      top =
        Math.sin(angle) >= 0
          ? anchorY + 14
          : anchorY - hoverRect.height - 14;
    }

    const maxLeft = Math.max(padding, chartRect.width - hoverRect.width - padding);
    const maxTop = Math.max(padding, chartRect.height - hoverRect.height - padding);

    left = Math.min(Math.max(padding, left), maxLeft);
    top = Math.min(Math.max(padding, top), maxTop);

    hoverCard.style.left = `${left}px`;
    hoverCard.style.top = `${top}px`;
  };

  const showBaseState = () => {
    centerValue.textContent = String(total);
    centerLabelNode.textContent = centerLabel;
    if (hoverTitle) {
      hoverTitle.textContent = "Resumo";
    }
    hoverCard?.classList.remove("visible");
    if (hoverCard) {
      hoverCard.style.left = "";
      hoverCard.style.top = "";
    }
    renderHoverList(null);
    setActive(null, false);
  };

  const showHover = (segment, event = null) => {
    if (!hoverCard || !centerValue || !centerLabelNode) {
      return;
    }

    centerValue.textContent = String(segment.total ?? "");
    centerLabelNode.textContent = segment.label ?? "";
    if (hoverTitle) {
      hoverTitle.textContent = segment.label ?? "Resumo";
    }
    hoverCard.classList.add("visible");
    if (event) {
      updateHoverPosition(event);
    }
    renderHoverList(segment.index);
    setActive(segment.index, true);
  };

  const hideHover = () => {
    if (window.matchMedia("(max-width: 720px)").matches) {
      return;
    }
    showBaseState();
  };

  segmentNodes.forEach((node) => {
    const syncFromNode = (event) => {
      const segment = segmentsWithMeta[Number(node.dataset.donutIndex)];
      if (segment) {
        showHover(segment, event);
      }
    };

    node.addEventListener("mouseenter", syncFromNode);
    node.addEventListener("pointerenter", syncFromNode);
    node.addEventListener("pointermove", syncFromNode);
    node.addEventListener("mousemove", syncFromNode);
  });

  const visualNode = container.querySelector(".donut-visual");
  visualNode?.addEventListener("mouseleave", hideHover);
  visualNode?.addEventListener("pointerleave", hideHover);

  if (window.matchMedia("(max-width: 720px)").matches && segmentsWithMeta[0]) {
    showHover(segmentsWithMeta[0]);
  } else {
    showBaseState();
  }
}

function renderDashboard() {
  const canReadStudents = hasPermission("students.read");
  const canReadExercises = hasPermission("exercises.read");
  const canReadPortalUsers = hasPermission("portal_users.read");

  $("#dashboard-students-total").textContent = canReadStudents ? String(state.users.length) : "--";
  $("#dashboard-students-copy").textContent = canReadStudents
    ? "Cadastros, edicao de perfil e treino semanal."
    : "Modulo indisponivel para este perfil.";
  $("#dashboard-students-action").textContent = canReadStudents ? "Abrir modulo" : "Sem acesso";

  $("#dashboard-exercises-total").textContent = canReadExercises
    ? String(state.exercises.length)
    : "--";
  $("#dashboard-exercises-copy").textContent = canReadExercises
    ? "Biblioteca tecnica e manutencao dos videos."
    : "Modulo indisponivel para este perfil.";
  $("#dashboard-exercises-action").textContent = canReadExercises ? "Abrir modulo" : "Sem acesso";

  $("#dashboard-access-total").textContent = canReadPortalUsers
    ? String(state.portalUsers.length)
    : "--";
  $("#dashboard-access-copy").textContent = canReadPortalUsers
    ? "Perfis internos, papeis e permissoes do portal."
    : "Modulo indisponivel para este perfil.";
  $("#dashboard-access-action").textContent = canReadPortalUsers ? "Abrir modulo" : "Sem acesso";

  if (canReadStudents) {
    renderDonutChart(
      $("#dashboard-objectives"),
      countBy(state.users, (user) => user.objective, objectiveLabels),
      "Nenhum aluno cadastrado ainda.",
      "alunos por objetivo",
      ["#ff6a00", "#22c55e", "#38bdf8", "#a78bfa", "#facc15"]
    );
    renderDonutChart(
      $("#dashboard-environments"),
      countBy(state.users, (user) => user.trainingEnvironment, environmentLabels),
      "Nenhum ambiente de treino registrado ainda.",
      "alunos por ambiente",
      ["#ff6a00", "#3b82f6", "#10b981", "#a855f7"]
    );
  } else {
    renderDonutChart(
      $("#dashboard-objectives"),
      [],
      "Voce nao tem permissao para visualizar a distribuicao de alunos.",
      "",
      []
    );
    renderDonutChart(
      $("#dashboard-environments"),
      [],
      "Voce nao tem permissao para visualizar os ambientes dos alunos.",
      "",
      []
    );
  }
}

function syncNavigation() {
  ensureActiveScreen();
  syncPortalSections();

  const currentScreen = screenDefinitions[state.activeScreen];
  $("#screen-eyebrow").textContent = currentScreen.eyebrow;
  $("#screen-title").textContent = currentScreen.title;
  $("#screen-description").textContent = currentScreen.description;

  document.querySelectorAll("[data-screen-target]").forEach((button) => {
    const target = button.dataset.screenTarget;
    const available = screenDefinitions[target]?.available() ?? false;
    button.classList.toggle("hidden", !available);
    button.classList.toggle("current", target === state.activeScreen);
  });

  Object.keys(screenDefinitions).forEach((screenKey) => {
    const screen = $(`#screen-${screenKey}`);
    if (!screen) {
      return;
    }

    const isVisible = screenKey === state.activeScreen && screenDefinitions[screenKey].available();
    screen.classList.toggle("hidden", !isVisible);
  });

  renderDashboard();
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}),
    },
    ...options,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      resetPortalUiForLoggedOut({ preserveNotice: true });
    }
    throw new Error(data.error ?? "Falha ao carregar dados");
  }

  return data;
}

function getCompatibleExercises(user, slot, currentExerciseId) {
  const sameEnvironment = state.exercises.filter(
    (exercise) =>
      exercise.muscleGroup === slot.muscleGroup &&
      exercise.environment === user.trainingEnvironment
  );

  const strictMatches = sameEnvironment.filter(
    (exercise) => exercise.goal === "geral" || exercise.goal === user.objective
  );

  const candidates = strictMatches.length ? strictMatches : sameEnvironment;
  const withCurrent = candidates.some((exercise) => exercise.id === currentExerciseId)
    ? candidates
    : [
        state.exercises.find((exercise) => exercise.id === currentExerciseId),
        ...candidates,
      ].filter(Boolean);

  return withCurrent;
}

function renderUsers() {
  const container = $("#students-list");
  const countBadge = $("#students-count");

  if (!hasPermission("students.read")) {
    countBadge.textContent = "Acesso restrito";
    container.innerHTML = "<div class='empty-state'>Voce nao pode visualizar alunos.</div>";
    return;
  }

  const canEditStudents = hasPermission("students.write");
  const canEditWorkouts = hasPermission("workouts.write");
  const canReplaceWorkoutExercises = canEditWorkouts && hasPermission("exercises.read");
  const query = normalizeText(state.studentQuery);
  const filteredUsers = state.users.filter((user) =>
    matchesQuery(
      [
        user.name,
        user.email,
        objectiveLabels[user.objective] ?? user.objective,
        environmentLabels[user.trainingEnvironment] ?? user.trainingEnvironment,
        user.level,
        user.restrictions,
      ],
      query
    )
  );

  countBadge.textContent = query
    ? `${filteredUsers.length} de ${state.users.length} aluno(s)`
    : `${state.users.length} aluno(s)`;
  container.innerHTML = "";

  if (!state.users.length) {
    container.innerHTML = "<div class='empty-state'>Nenhum usuario cadastrado ainda.</div>";
    return;
  }

  if (!filteredUsers.length) {
    container.innerHTML =
      "<div class='empty-state'>Nenhum aluno encontrado para essa pesquisa.</div>";
    return;
  }

  filteredUsers.forEach((user) => {
    const article = document.createElement("article");
    article.className = `item${canEditStudents || canEditWorkouts ? "" : " readonly"}`;

    const workoutsMarkup = user.workoutPlan
      .map((workout) => {
        const slotsMarkup = workout.exercises
          .map((slot) => {
            const currentExercise = state.exercises.find((exercise) => exercise.id === slot.exerciseId);
            const currentName = currentExercise?.name ?? "Exercicio vinculado";
            const currentEquipment = currentExercise?.equipment ?? "-";
            const options = getCompatibleExercises(user, slot, slot.exerciseId);

            if (!canReplaceWorkoutExercises) {
              return `
                <div class="slot-editor">
                  <div class="slot-copy">
                    <strong>${escapeHtml(currentName)}</strong>
                    <span>${escapeHtml(groupLabels[slot.muscleGroup] ?? slot.muscleGroup)} | ${escapeHtml(
                      currentEquipment
                    )}</span>
                  </div>
                </div>
              `;
            }

            return `
              <div class="slot-editor">
                <div class="slot-copy">
                  <strong>${escapeHtml(currentName)}</strong>
                  <span>${escapeHtml(groupLabels[slot.muscleGroup] ?? slot.muscleGroup)} | ${escapeHtml(
                    currentEquipment
                  )}</span>
                </div>
                <div class="slot-actions">
                  <select
                    data-slot-select
                    data-user-id="${escapeHtml(user.id)}"
                    data-workout-id="${escapeHtml(workout.id)}"
                    data-slot-id="${escapeHtml(slot.slotId)}"
                  >
                    ${options
                      .map(
                        (exercise) => `
                          <option value="${escapeHtml(exercise.id)}"${
                            exercise.id === slot.exerciseId ? " selected" : ""
                          }>
                            ${escapeHtml(exercise.name)}
                          </option>
                        `
                      )
                      .join("")}
                  </select>
                  <button
                    class="secondary mini-button"
                    data-action="replace-workout-exercise"
                    data-user-id="${escapeHtml(user.id)}"
                    data-workout-id="${escapeHtml(workout.id)}"
                    data-slot-id="${escapeHtml(slot.slotId)}"
                    type="button"
                  >
                    Trocar
                  </button>
                </div>
              </div>
            `;
          })
          .join("");

        return `
          <section class="workout-block">
            <div class="workout-block-head">
              <div>
                <h4>Treino ${escapeHtml(workout.label)} - ${escapeHtml(workout.name)}</h4>
                <p class="muted-dark">${escapeHtml(workout.focus)}</p>
              </div>
              <span class="chip">${escapeHtml(workout.exercises.length)} exercicios</span>
            </div>
            <div class="stack-sm">${slotsMarkup}</div>
          </section>
        `;
      })
      .join("");

    article.innerHTML = `
      <details class="editor">
        <summary class="editor-summary">
          <div>
            <h3>${escapeHtml(user.name)}</h3>
            <p>${escapeHtml(user.email)}</p>
            <p>
              Objetivo: ${escapeHtml(objectiveLabels[user.objective] ?? user.objective)} |
              Ambiente: ${escapeHtml(environmentLabels[user.trainingEnvironment] ?? user.trainingEnvironment)} |
              IMC: ${escapeHtml(user.bmi)} (${escapeHtml(user.bmiClass)})
            </p>
          </div>
          <span class="badge">${escapeHtml(user.trainingDaysPerWeek)}x por semana</span>
        </summary>

        <div class="editor-body" data-user-id="${escapeHtml(user.id)}">
          <section class="subsection">
            <div class="section-inline-head">
              <div>
                <h4>Cadastro do aluno</h4>
                <p class="muted-dark">Salvar por aqui recalcula a ficha do aluno.</p>
              </div>
            </div>

            <div class="form-grid compact">
              <label>
                <span>Nome</span>
                <input data-field="name" type="text" value="${escapeHtml(user.name)}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Email</span>
                <input data-field="email" type="email" value="${escapeHtml(user.email)}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Nova senha temporaria</span>
                ${wrapPasswordInput(
                  `<input data-field="password" type="password" value="" placeholder="Opcional" ${!canEditStudents ? "disabled" : ""} />`,
                  !canEditStudents
                )}
              </label>
              <label>
                <span>Confirmar nova senha</span>
                ${wrapPasswordInput(
                  `<input data-field="confirmPassword" type="password" value="" placeholder="Repita a senha" ${!canEditStudents ? "disabled" : ""} />`,
                  !canEditStudents
                )}
              </label>
              <label>
                <span>Idade</span>
                <input data-field="age" type="number" min="18" value="${escapeHtml(user.age)}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Sexo</span>
                <select data-field="sex" ${!canEditStudents ? "disabled" : ""}>${optionMarkup(sexOptions, user.sex)}</select>
              </label>
              <label>
                <span>Altura (cm)</span>
                <input data-field="heightCm" type="number" min="100" value="${escapeHtml(
                  user.heightCm
                )}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Peso atual (kg)</span>
                <input data-field="weightKg" type="number" min="1" step="0.1" value="${escapeHtml(
                  user.weightKg
                )}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Meta de peso (kg)</span>
                <input data-field="targetWeightKg" type="number" min="1" step="0.1" value="${escapeHtml(
                  user.targetWeightKg
                )}" ${!canEditStudents ? "disabled" : ""} />
              </label>
              <label>
                <span>Objetivo</span>
                <select data-field="objective" ${!canEditStudents ? "disabled" : ""}>${optionMarkup(
                  userObjectiveOptions,
                  user.objective
                )}</select>
              </label>
              <label>
                <span>Ambiente</span>
                <select data-field="trainingEnvironment" ${!canEditStudents ? "disabled" : ""}>${optionMarkup(
                  environmentOptions,
                  user.trainingEnvironment
                )}</select>
              </label>
              <label>
                <span>Treinos por semana</span>
                <select data-field="trainingDaysPerWeek" ${!canEditStudents ? "disabled" : ""}>${optionMarkup(
                  trainingDayOptions,
                  String(user.trainingDaysPerWeek)
                )}</select>
              </label>
              <label>
                <span>Nivel</span>
                <select data-field="level" ${!canEditStudents ? "disabled" : ""}>${optionMarkup(levelOptions, user.level)}</select>
              </label>
              <label class="full">
                <span>Restricoes</span>
                <textarea data-field="restrictions" rows="3" ${!canEditStudents ? "disabled" : ""}>${escapeHtml(
                  user.restrictions ?? ""
                )}</textarea>
              </label>
            </div>

            ${
              canEditStudents || canEditWorkouts
                ? `
                  <div class="actions">
                    ${
                      canEditStudents
                        ? `<button data-action="save-user" data-user-id="${escapeHtml(user.id)}" type="button">Salvar cadastro</button>`
                        : ""
                    }
                    ${
                      canEditWorkouts
                        ? `
                          <button
                            class="secondary"
                            data-action="recalculate-user-workout"
                            data-user-id="${escapeHtml(user.id)}"
                            type="button"
                          >
                            Recalcular treino
                          </button>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
            }
          </section>

          <section class="subsection">
            <div class="section-inline-head">
              <div>
                <h4>Treinos do aluno</h4>
                <p class="muted-dark">Cada troca respeita grupo muscular e ambiente do aluno.</p>
              </div>
            </div>
            <div class="stack-sm">${workoutsMarkup}</div>
          </section>
        </div>
      </details>
    `;
    container.append(article);
  });
}

function renderExercises() {
  const container = $("#exercises-list");
  const countBadge = $("#exercises-count");

  if (!hasPermission("exercises.read")) {
    countBadge.textContent = "Acesso restrito";
    container.innerHTML =
      "<div class='empty-state'>Voce pode cadastrar exercicios, mas nao visualizar a biblioteca.</div>";
    return;
  }

  const canEditExercises = hasPermission("exercises.write");
  const query = normalizeText(state.exerciseQuery);
  const filteredExercises = state.exercises.filter((exercise) =>
    matchesQuery(
      [
        exercise.name,
        groupLabels[exercise.muscleGroup] ?? exercise.muscleGroup,
        environmentLabels[exercise.environment] ?? exercise.environment,
        objectiveLabels[exercise.goal] ?? exercise.goal,
        exercise.equipment,
        exercise.description,
      ],
      query
    )
  );

  countBadge.textContent = query
    ? `${filteredExercises.length} de ${state.exercises.length} exercicio(s)`
    : `${state.exercises.length} exercicio(s)`;
  container.innerHTML = "";

  if (!state.exercises.length) {
    container.innerHTML = "<div class='empty-state'>Nenhum exercicio encontrado.</div>";
    return;
  }

  if (!filteredExercises.length) {
    container.innerHTML =
      "<div class='empty-state'>Nenhum exercicio encontrado para essa pesquisa.</div>";
    return;
  }

  filteredExercises.forEach((exercise) => {
    const article = document.createElement("article");
    article.className = `item${canEditExercises ? "" : " readonly"}`;

    article.innerHTML = `
      <details class="editor">
        <summary class="editor-summary">
          <div>
            <h3>${escapeHtml(exercise.name)}</h3>
            <p>
              ${escapeHtml(groupLabels[exercise.muscleGroup] ?? exercise.muscleGroup)} |
              ${escapeHtml(environmentLabels[exercise.environment] ?? exercise.environment)} |
              ${escapeHtml(objectiveLabels[exercise.goal] ?? exercise.goal)} |
              ${escapeHtml(exercise.calories)} kcal
            </p>
            <p>${escapeHtml(exercise.description)}</p>
          </div>
          <span class="chip">${escapeHtml(exercise.equipment)}</span>
        </summary>

        <div class="editor-body" data-exercise-id="${escapeHtml(exercise.id)}">
          <div class="form-grid compact">
            <label>
              <span>Nome</span>
              <input data-field="name" type="text" value="${escapeHtml(exercise.name)}" ${!canEditExercises ? "disabled" : ""} />
            </label>
            <label>
              <span>Grupo muscular</span>
              <select data-field="muscleGroup" ${!canEditExercises ? "disabled" : ""}>${optionMarkup(groups, exercise.muscleGroup)}</select>
            </label>
            <label>
              <span>Objetivo</span>
              <select data-field="goal" ${!canEditExercises ? "disabled" : ""}>${optionMarkup(objectiveOptions, exercise.goal)}</select>
            </label>
            <label>
              <span>Ambiente</span>
              <select data-field="environment" ${!canEditExercises ? "disabled" : ""}>${optionMarkup(
                environmentOptions,
                exercise.environment
              )}</select>
            </label>
            <label>
              <span>Calorias</span>
              <input data-field="calories" type="number" min="1" value="${escapeHtml(
                exercise.calories
              )}" ${!canEditExercises ? "disabled" : ""} />
            </label>
            <label>
              <span>Equipamento</span>
              <input data-field="equipment" type="text" value="${escapeHtml(exercise.equipment)}" ${!canEditExercises ? "disabled" : ""} />
            </label>
            <label class="full">
              <span>Link do video</span>
              <input data-field="videoUrl" type="url" value="${escapeHtml(exercise.videoUrl)}" ${!canEditExercises ? "disabled" : ""} />
            </label>
            <label class="full">
              <span>Descricao</span>
              <textarea data-field="description" rows="3" ${!canEditExercises ? "disabled" : ""}>${escapeHtml(
                exercise.description
              )}</textarea>
            </label>
          </div>
          <div class="actions">
            ${
              canEditExercises
                ? `
                  <button data-action="save-exercise-edit" data-exercise-id="${escapeHtml(exercise.id)}" type="button">
                    Salvar alteracoes
                  </button>
                `
                : ""
            }
            <a class="link" href="${escapeHtml(exercise.videoUrl)}" target="_blank" rel="noreferrer">
              Abrir link atual
            </a>
          </div>
        </div>
      </details>
    `;

    container.append(article);
  });
}

function renderPortalUsers() {
  const container = $("#portal-users-list");
  const count = $("#portal-users-count");
  const canReadPortalUsers = hasPermission("portal_users.read");
  const canManagePortalUsers = hasPermission("portal_users.write");

  if (!container || !count) {
    return;
  }

  if (!canReadPortalUsers) {
    count.textContent = "Acesso restrito";
    container.innerHTML =
      "<div class='empty-state'>Voce nao pode listar os acessos internos do portal.</div>";
    return;
  }

  count.textContent = `${state.portalUsers.length} acesso(s)`;
  container.innerHTML = "";

  if (!state.portalUsers.length) {
    container.innerHTML = "<div class='empty-state'>Nenhum usuario interno cadastrado ainda.</div>";
    return;
  }

  state.portalUsers.forEach((portalUser) => {
    const article = document.createElement("article");
    article.className = `item${canManagePortalUsers ? "" : " readonly"}`;
    const canEditThisUser = canManagePortalUsers;
    const currentRolePermissions = portalUser.permissions ?? getPermissionsForRole(portalUser.role);

    article.innerHTML = `
      <details class="editor">
        <summary class="editor-summary">
          <div>
            <h3>${escapeHtml(portalUser.name)}</h3>
            <p>${escapeHtml(portalUser.email)}</p>
            <p>
              Perfil: ${escapeHtml(portalRoleLabels[portalUser.role] ?? portalUser.role)} |
              Status: ${portalUser.isActive ? "Ativo" : "Inativo"}
            </p>
          </div>
          <span class="badge">${escapeHtml(currentRolePermissions.length)} permissoes</span>
        </summary>

        <div class="editor-body" data-portal-user-id="${escapeHtml(portalUser.id)}">
          <div class="form-grid compact">
            <label>
              <span>Nome</span>
              <input data-field="name" type="text" value="${escapeHtml(portalUser.name)}" ${!canEditThisUser ? "disabled" : ""} />
            </label>
            <label>
              <span>Email</span>
              <input data-field="email" type="email" value="${escapeHtml(portalUser.email)}" ${!canEditThisUser ? "disabled" : ""} />
            </label>
            <label>
              <span>Nova senha</span>
              ${wrapPasswordInput(
                `<input data-field="password" type="password" value="" placeholder="Opcional" ${!canEditThisUser ? "disabled" : ""} />`,
                !canEditThisUser
              )}
            </label>
            <label>
              <span>Confirmar nova senha</span>
              ${wrapPasswordInput(
                `<input data-field="confirmPassword" type="password" value="" placeholder="Repita a senha" ${!canEditThisUser ? "disabled" : ""} />`,
                !canEditThisUser
              )}
            </label>
            <label>
              <span>Perfil</span>
              <select data-field="role" data-portal-role-select ${!canEditThisUser ? "disabled" : ""}>
                ${optionMarkup(portalRoleOptions, portalUser.role)}
              </select>
            </label>
            <label class="full">
              <span>Permissoes</span>
              <div class="permission-grid" data-permissions-root>
                ${renderPermissionChecklist(
                  currentRolePermissions,
                  !canEditThisUser || portalUser.role === "admin",
                  `portal-user-${portalUser.id}`
                )}
              </div>
            </label>
            <label class="full checkbox-inline">
              <input data-field="isActive" type="checkbox" ${portalUser.isActive ? "checked" : ""} ${!canEditThisUser ? "disabled" : ""} />
              <span>Usuario ativo</span>
            </label>
          </div>

          <div class="permission-summary">
            ${currentRolePermissions
              .map((permission) => `<span class="chip">${escapeHtml(permission)}</span>`)
              .join("")}
          </div>

          ${
            canEditThisUser
              ? `
                <div class="actions">
                  <button data-action="save-portal-user-edit" data-portal-user-id="${escapeHtml(portalUser.id)}" type="button">
                    Salvar acesso
                  </button>
                </div>
              `
              : ""
          }
        </div>
      </details>
    `;

    container.append(article);
  });
}

async function loadAll(options = {}) {
  const { preserveUi = false, forceRender = true } = options;
  const canReadStudents = hasPermission("students.read");
  const canReadExercises = hasPermission("exercises.read");
  const canReadPortalUsers = hasPermission("portal_users.read");
  const uiSnapshot = preserveUi ? capturePortalUiState() : null;

  const [usersPayload, exercisesPayload, portalUsersPayload] = await Promise.all([
    canReadStudents ? request("/api/users") : Promise.resolve({ users: [] }),
    canReadExercises ? request("/api/exercises") : Promise.resolve({ exercises: [] }),
    canReadPortalUsers ? request("/api/portal-users") : Promise.resolve({ portalUsers: [] }),
  ]);
  const nextUsers = usersPayload.users ?? [];
  const nextExercises = exercisesPayload.exercises ?? [];
  const nextPortalUsers = portalUsersPayload.portalUsers ?? [];
  const hasChanges = collectionsChanged(nextUsers, nextExercises, nextPortalUsers);

  state.users = nextUsers;
  state.exercises = nextExercises;
  state.portalUsers = nextPortalUsers;

  if (forceRender || hasChanges) {
    renderUsers();
    renderExercises();
    renderPortalUsers();
    syncNavigation();

    if (uiSnapshot) {
      restorePortalUiState(uiSnapshot);
    }
  }
}

async function refreshSilently() {
  if (!state.session?.token || autoRefreshInFlight || shouldDeferSilentRefresh()) {
    return;
  }

  autoRefreshInFlight = true;

  try {
    await loadAll({ preserveUi: true, forceRender: false });
  } catch (error) {
    if (state.session?.token) {
      console.error("Falha no refresh silencioso do portal:", error);
    }
  } finally {
    autoRefreshInFlight = false;
  }
}

async function loginInstructor() {
  const email = $("#portal-login-email").value.trim().toLowerCase();
  const password = $("#portal-login-password").value.trim();

  if (!email || !password) {
    showNotice("Informe email e senha do instrutor.", "error");
    return;
  }

  setLoginBusy(true);
  try {
    await withLoading(
      "Entrando no portal",
      "Validando credenciais e carregando os dados principais.",
      async () => {
        const payload = await request("/api/auth/instructor/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });

        persistSession(payload);
        syncAuthUi();
        $("#portal-login-password").value = "";
        await loadAll();
        startAutoRefresh();
        setActiveScreen("dashboard");
      }
    );
    showNotice("Portal autenticado com sucesso.", "success");
  } finally {
    setLoginBusy(false);
  }
}

async function restoreInstructorSession(storedSession) {
  state.session = { token: storedSession.token, role: storedSession.role ?? "instructor" };
  state.instructor = storedSession.instructor ?? null;

  try {
    await withLoading(
      "Recuperando sessao",
      "Validando o acesso salvo neste navegador.",
      async () => {
        const payload = await request("/api/auth/instructor/session");
        persistSession(payload);
        syncAuthUi();
        await loadAll();
        startAutoRefresh();
      }
    );
  } catch (error) {
    resetPortalUiForLoggedOut({ preserveNotice: true });
    showNotice("Sessao invalida ou expirada. Entre novamente.", "error");
  }
}

async function logoutInstructor() {
  try {
    await request("/api/auth/logout", {
      method: "POST",
    });
  } catch {
  }

  resetPortalUiForLoggedOut({ preserveNotice: true });
}

async function saveExercise() {
  const payload = {
    name: $("#exercise-name").value.trim(),
    muscleGroup: $("#exercise-group").value,
    goal: $("#exercise-goal").value,
    environment: $("#exercise-environment").value,
    calories: Number($("#exercise-calories").value),
    equipment: $("#exercise-equipment").value.trim(),
    videoUrl: $("#exercise-video").value.trim(),
    description: $("#exercise-description").value.trim(),
  };

  if (
    !payload.name ||
    !payload.calories ||
    !payload.equipment ||
    !payload.videoUrl ||
    !payload.description
  ) {
    showNotice("Preencha todos os campos do exercicio.", "error");
    return;
  }

  await request("/api/exercises", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  $("#exercise-name").value = "";
  $("#exercise-calories").value = "";
  $("#exercise-equipment").value = "";
  $("#exercise-video").value = "";
  $("#exercise-description").value = "";
  await loadAll();
  setActiveScreen("exercises");
  showNotice("Exercicio cadastrado com sucesso.", "success");
}

function readEditorFields(root) {
  return Object.fromEntries(
    [...root.querySelectorAll("[data-field]")].map((field) => [
      field.dataset.field,
      field.type === "checkbox" ? field.checked : field.value,
    ])
  );
}

async function savePortalUser() {
  const payload = {
    name: $("#portal-user-name").value.trim(),
    email: $("#portal-user-email").value.trim().toLowerCase(),
    password: $("#portal-user-password").value.trim(),
    confirmPassword: $("#portal-user-confirm-password").value.trim(),
    role: $("#portal-user-role").value,
    permissions: getSelectedPermissions($("#portal-user-permissions")),
    isActive: $("#portal-user-active").checked,
  };

  if (!payload.name || !payload.email || !payload.password) {
    showNotice("Preencha nome, email e senha do novo acesso.", "error");
    return;
  }

  const passwordError = getPasswordValidationError(
    payload.password,
    payload.confirmPassword,
    true
  );
  if (passwordError) {
    showNotice(passwordError, "error");
    return;
  }

  await request("/api/portal-users", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      confirmPassword: undefined,
    }),
  });

  $("#portal-user-name").value = "";
  $("#portal-user-email").value = "";
  $("#portal-user-password").value = "";
  $("#portal-user-confirm-password").value = "";
  $("#portal-user-role").value = "instrutor";
  $("#portal-user-active").checked = true;
  syncCreatePortalUserPermissions();
  await loadAll();
  setActiveScreen("access");
  showNotice("Acesso do portal criado com sucesso.", "success");
}

async function savePortalUserEdit(button) {
  const editor = button.closest(".editor-body[data-portal-user-id]");
  const portalUserId = editor?.dataset.portalUserId;
  if (!editor || !portalUserId) {
    return;
  }

  const raw = readEditorFields(editor);
  const permissionsRoot = editor.querySelector("[data-permissions-root]");
  const payload = {
    ...raw,
    email: String(raw.email ?? "").trim().toLowerCase(),
    password: String(raw.password ?? "").trim(),
    confirmPassword: String(raw.confirmPassword ?? "").trim(),
    permissions: permissionsRoot ? getSelectedPermissions(permissionsRoot) : [],
    isActive: Boolean(raw.isActive),
  };

  const passwordError = getPasswordValidationError(payload.password, payload.confirmPassword);
  if (passwordError) {
    showNotice(passwordError, "error");
    return;
  }

  await request(`/api/portal-users/${portalUserId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...payload,
      confirmPassword: undefined,
    }),
  });

  await loadAll();
  showNotice("Acesso do portal atualizado.", "success");
}

async function saveExerciseEdit(button) {
  const editor = button.closest(".editor-body[data-exercise-id]");
  const exerciseId = editor?.dataset.exerciseId;
  if (!editor || !exerciseId) {
    return;
  }

  const raw = readEditorFields(editor);
  await request(`/api/exercises/${exerciseId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...raw,
      calories: Number(raw.calories),
    }),
  });

  await loadAll();
  showNotice("Exercicio atualizado.", "success");
}

async function saveUser(button) {
  const editor = button.closest(".editor-body[data-user-id]");
  const userId = editor?.dataset.userId;
  if (!editor || !userId) {
    return;
  }

  const raw = readEditorFields(editor);
  const payload = {
    ...raw,
    age: Number(raw.age),
    heightCm: Number(raw.heightCm),
    weightKg: Number(raw.weightKg),
    targetWeightKg: Number(raw.targetWeightKg),
    trainingDaysPerWeek: Number(raw.trainingDaysPerWeek),
    confirmPassword: String(raw.confirmPassword ?? "").trim(),
    ...(raw.password?.trim() ? { password: raw.password.trim() } : {}),
  };

  const passwordError = getPasswordValidationError(payload.password, payload.confirmPassword);
  if (passwordError) {
    showNotice(passwordError, "error");
    return;
  }

  await request(`/api/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...payload,
      confirmPassword: undefined,
    }),
  });

  await loadAll();
  showNotice("Cadastro do aluno atualizado.", "success");
}

async function recalculateUserWorkout(button) {
  const userId = button.dataset.userId;
  if (!userId) {
    return;
  }

  await request(`/api/users/${userId}/recalculate`, {
    method: "POST",
  });

  await loadAll();
  showNotice("Treino do aluno recalculado.", "success");
}

async function replaceWorkoutExercise(button) {
  const userId = button.dataset.userId;
  const workoutId = button.dataset.workoutId;
  const slotId = button.dataset.slotId;
  const select = button.parentElement?.querySelector("[data-slot-select]");

  if (!userId || !workoutId || !slotId || !select) {
    return;
  }

  await request(`/api/users/${userId}/workouts/replace`, {
    method: "POST",
    body: JSON.stringify({
      workoutId,
      slotId,
      nextExerciseId: select.value,
    }),
  });

  await loadAll();
  showNotice("Exercicio do treino alterado.", "success");
}

populateGroups();

$("#refresh-exercises").addEventListener("click", () => {
  withLoading(
    "Atualizando biblioteca",
    "Recarregando a lista de exercicios do portal.",
    () => loadAll()
  )
    .then(() => showNotice("Biblioteca recarregada.", "success"))
    .catch((error) => showNotice(error.message, "error"));
});

$("#save-exercise").addEventListener("click", () => {
  saveExercise().catch((error) => showNotice(error.message, "error"));
});

$("#save-portal-user").addEventListener("click", () => {
  savePortalUser().catch((error) => showNotice(error.message, "error"));
});

$("#portal-login").addEventListener("click", () => {
  loginInstructor().catch((error) => showNotice(error.message, "error"));
});

$("#portal-logout").addEventListener("click", () => {
  logoutInstructor().catch((error) => showNotice(error.message, "error"));
});

$("#students-search").addEventListener("input", (event) => {
  state.studentQuery = event.target.value;
  renderUsers();
});

$("#exercises-search").addEventListener("input", (event) => {
  state.exerciseQuery = event.target.value;
  renderExercises();
});

$("#portal-user-role").addEventListener("change", () => {
  syncCreatePortalUserPermissions();
});

$("#sidebar-open").addEventListener("click", () => {
  setSidebarOpen(true);
});

$("#sidebar-close").addEventListener("click", () => {
  setSidebarOpen(false);
});

$("#sidebar-backdrop").addEventListener("click", () => {
  setSidebarOpen(false);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSidebarOpen(false);
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 960) {
    setSidebarOpen(false);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshSilently();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.matches("[data-portal-role-select]")) {
    syncEditorPortalUserPermissions(target);
  }
});

document.addEventListener("click", (event) => {
  const passwordToggle = event.target.closest("[data-password-toggle]");
  if (passwordToggle) {
    togglePasswordVisibility(passwordToggle);
    return;
  }

  const navButton = event.target.closest("[data-screen-target]");
  if (navButton) {
    setActiveScreen(navButton.dataset.screenTarget);
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  const handlers = {
    "save-exercise-edit": () => saveExerciseEdit(button),
    "save-user": () => saveUser(button),
    "recalculate-user-workout": () => recalculateUserWorkout(button),
    "replace-workout-exercise": () => replaceWorkoutExercise(button),
    "save-portal-user-edit": () => savePortalUserEdit(button),
  };

  const handler = handlers[action];
  if (!handler) {
    return;
  }

  handler().catch((error) => showNotice(error.message, "error"));
});

syncAuthUi();
syncCreatePortalUserPermissions();
renderUsers();
renderExercises();
renderPortalUsers();
syncNavigation();

const storedSession = readStoredSession();
if (storedSession) {
  restoreInstructorSession(storedSession).catch((error) => {
    console.error("Falha ao restaurar sessao do portal:", error);
  });
}
