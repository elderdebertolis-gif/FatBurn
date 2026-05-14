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

const $ = (selector) => document.querySelector(selector);

const state = {
  session: null,
  instructor: null,
  portalUsers: [],
  users: [],
  exercises: [],
  studentQuery: "",
  exerciseQuery: "",
};

const SESSION_STORAGE_KEY = "fatburn.portal.session";

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

const API_BASE_URL = "https://fatburn-backend.onrender.com";

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
    sessionMeta.textContent = `${state.instructor.name} | ${
      portalRoleLabels[state.instructor.role] ?? state.instructor.role
    }`;
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
  $("#exercise-create-section").classList.toggle("hidden", !hasPermission("exercises.write"));
  $("#portal-students-section").classList.toggle(
    "hidden",
    !hasPermission("students.read") && !hasPermission("exercises.read")
  );
  $("#portal-students-card").classList.toggle("hidden", !hasPermission("students.read"));
  $("#portal-exercises-section").classList.toggle("hidden", !hasPermission("exercises.read"));
  $("#portal-access-section").classList.toggle("hidden", !hasPermission("portal_users.read"));
  $("#portal-user-create").classList.toggle("hidden", !hasPermission("portal_users.write"));
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

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}),
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      syncAuthUi();
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

  $("#students-count").textContent = query
    ? `${filteredUsers.length} de ${state.users.length} aluno(s)`
    : `${state.users.length} aluno(s)`;
  container.innerHTML = "";

  if (!state.users.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum usuario cadastrado ainda.</p>";
    return;
  }

  if (!filteredUsers.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum aluno encontrado para essa pesquisa.</p>";
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
            const options = getCompatibleExercises(user, slot, slot.exerciseId);

            if (!canReplaceWorkoutExercises) {
              return `
                <div class="slot-editor">
                  <div class="slot-copy">
                    <strong>${escapeHtml(currentExercise?.name ?? "Exercicio nao encontrado")}</strong>
                    <span>${escapeHtml(groupLabels[slot.muscleGroup] ?? slot.muscleGroup)} | ${escapeHtml(
                      currentExercise?.equipment ?? "-"
                    )}</span>
                  </div>
                </div>
              `;
            }

            return `
              <div class="slot-editor">
                <div class="slot-copy">
                  <strong>${escapeHtml(currentExercise?.name ?? "Exercicio nao encontrado")}</strong>
                  <span>${escapeHtml(groupLabels[slot.muscleGroup] ?? slot.muscleGroup)} | ${escapeHtml(
                    currentExercise?.equipment ?? "-"
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
                <input data-field="password" type="password" value="" placeholder="Opcional" ${!canEditStudents ? "disabled" : ""} />
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
                        ? `<button data-action="save-user" data-user-id="${escapeHtml(user.id)}">Salvar cadastro</button>`
                        : ""
                    }
                    ${
                      canEditWorkouts
                        ? `
                          <button
                            class="secondary"
                            data-action="recalculate-user-workout"
                            data-user-id="${escapeHtml(user.id)}"
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

  $("#exercises-count").textContent = query
    ? `${filteredExercises.length} de ${state.exercises.length} exercicio(s)`
    : `${state.exercises.length} exercicio(s)`;
  container.innerHTML = "";

  if (!state.exercises.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum exercicio encontrado.</p>";
    return;
  }

  if (!filteredExercises.length) {
    container.innerHTML =
      "<p class='muted-dark'>Nenhum exercicio encontrado para essa pesquisa.</p>";
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
                  <button data-action="save-exercise-edit" data-exercise-id="${escapeHtml(exercise.id)}">
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
  const canManagePortalUsers = hasPermission("portal_users.write");

  if (!container || !count) {
    return;
  }

  count.textContent = `${state.portalUsers.length} acesso(s)`;
  container.innerHTML = "";

  if (!state.portalUsers.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum usuario interno cadastrado ainda.</p>";
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
              <input data-field="password" type="password" value="" placeholder="Opcional" ${!canEditThisUser ? "disabled" : ""} />
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
                  <button data-action="save-portal-user-edit" data-portal-user-id="${escapeHtml(portalUser.id)}">
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

async function loadAll() {
  const [usersPayload, exercisesPayload, portalUsersPayload] = await Promise.all([
    hasPermission("students.read") ? request("/api/users") : Promise.resolve({ users: [] }),
    hasPermission("exercises.read") ? request("/api/exercises") : Promise.resolve({ exercises: [] }),
    hasPermission("portal_users.read")
      ? request("/api/portal-users")
      : Promise.resolve({ portalUsers: [] }),
  ]);
  state.users = usersPayload.users ?? [];
  state.exercises = exercisesPayload.exercises ?? [];
  state.portalUsers = portalUsersPayload.portalUsers ?? [];

  syncPortalSections();
  renderUsers();
  renderExercises();
  renderPortalUsers();
}

async function loginInstructor() {
  const email = $("#portal-login-email").value.trim().toLowerCase();
  const password = $("#portal-login-password").value.trim();

  if (!email || !password) {
    showNotice("Informe email e senha do instrutor.", "error");
    return;
  }

  const payload = await request("/api/auth/instructor/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  persistSession(payload);
  syncAuthUi();
  $("#portal-login-password").value = "";
  await loadAll();
  showNotice("Portal autenticado com sucesso.", "success");
}

async function logoutInstructor() {
  try {
    await request("/api/auth/logout", {
      method: "POST",
    });
  } catch {
    // A limpeza local continua mesmo se a sessao ja tiver expirado no servidor.
  }

  clearSession();
  syncAuthUi();
  state.portalUsers = [];
  state.users = [];
  state.exercises = [];
  syncPortalSections();
  $("#portal-users-list").innerHTML = "";
  $("#students-list").innerHTML = "";
  $("#exercises-list").innerHTML = "";
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
    role: $("#portal-user-role").value,
    permissions: getSelectedPermissions($("#portal-user-permissions")),
    isActive: $("#portal-user-active").checked,
  };

  if (!payload.name || !payload.email || !payload.password) {
    showNotice("Preencha nome, email e senha do novo acesso.", "error");
    return;
  }

  await request("/api/portal-users", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  $("#portal-user-name").value = "";
  $("#portal-user-email").value = "";
  $("#portal-user-password").value = "";
  $("#portal-user-role").value = "instrutor";
  $("#portal-user-active").checked = true;
  syncCreatePortalUserPermissions();
  await loadAll();
  showNotice("Acesso do portal criado com sucesso.", "success");
}

async function savePortalUserEdit(button) {
  const editor = button.closest("[data-portal-user-id]");
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
    permissions: permissionsRoot ? getSelectedPermissions(permissionsRoot) : [],
    isActive: Boolean(raw.isActive),
  };

  await request(`/api/portal-users/${portalUserId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  await loadAll();
  showNotice("Acesso do portal atualizado.", "success");
}

async function saveExerciseEdit(button) {
  const editor = button.closest("[data-exercise-id]");
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
  const editor = button.closest("[data-user-id]");
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
    ...(raw.password?.trim() ? { password: raw.password.trim() } : {}),
  };

  await request(`/api/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
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
  loadAll()
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

const storedSession = readStoredSession();
if (storedSession) {
  state.session = { token: storedSession.token, role: storedSession.role ?? "instructor" };
  state.instructor = storedSession.instructor ?? null;
}

syncAuthUi();
syncPortalSections();
syncCreatePortalUserPermissions();

if (state.session?.token) {
  loadAll().catch((error) => {
    clearSession();
    syncAuthUi();
    showNotice(error.message, "error");
  });
}
