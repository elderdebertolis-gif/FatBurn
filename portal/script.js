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
  users: [],
  exercises: [],
  health: null,
};

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

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Falha ao carregar dados");
  }

  return data;
}

function renderHealth() {
  const container = $("#server-status");
  if (!state.health) {
    container.innerHTML = "<p class='muted-dark'>Servidor ainda nao consultado.</p>";
    return;
  }

  container.innerHTML = `
    <h3>Servidor ativo</h3>
    <p>Banco: ${escapeHtml(state.health.db)}</p>
    <p>Exercicios pre-cadastrados: ${escapeHtml(state.health.seededExercises)}</p>
  `;
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
  $("#students-count").textContent = `${state.users.length} aluno(s)`;
  container.innerHTML = "";

  if (!state.users.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum usuario cadastrado ainda.</p>";
    return;
  }

  state.users.forEach((user) => {
    const article = document.createElement("article");
    article.className = "item";

    const workoutsMarkup = user.workoutPlan
      .map((workout) => {
        const slotsMarkup = workout.exercises
          .map((slot) => {
            const currentExercise = state.exercises.find((exercise) => exercise.id === slot.exerciseId);
            const options = getCompatibleExercises(user, slot, slot.exerciseId);

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
                <input data-field="name" type="text" value="${escapeHtml(user.name)}" />
              </label>
              <label>
                <span>Email</span>
                <input data-field="email" type="email" value="${escapeHtml(user.email)}" />
              </label>
              <label>
                <span>Senha</span>
                <input data-field="password" type="text" value="${escapeHtml(user.password)}" />
              </label>
              <label>
                <span>Idade</span>
                <input data-field="age" type="number" min="12" value="${escapeHtml(user.age)}" />
              </label>
              <label>
                <span>Sexo</span>
                <select data-field="sex">${optionMarkup(sexOptions, user.sex)}</select>
              </label>
              <label>
                <span>Altura (cm)</span>
                <input data-field="heightCm" type="number" min="100" value="${escapeHtml(
                  user.heightCm
                )}" />
              </label>
              <label>
                <span>Peso atual (kg)</span>
                <input data-field="weightKg" type="number" min="1" step="0.1" value="${escapeHtml(
                  user.weightKg
                )}" />
              </label>
              <label>
                <span>Meta de peso (kg)</span>
                <input data-field="targetWeightKg" type="number" min="1" step="0.1" value="${escapeHtml(
                  user.targetWeightKg
                )}" />
              </label>
              <label>
                <span>Objetivo</span>
                <select data-field="objective">${optionMarkup(
                  userObjectiveOptions,
                  user.objective
                )}</select>
              </label>
              <label>
                <span>Ambiente</span>
                <select data-field="trainingEnvironment">${optionMarkup(
                  environmentOptions,
                  user.trainingEnvironment
                )}</select>
              </label>
              <label>
                <span>Treinos por semana</span>
                <select data-field="trainingDaysPerWeek">${optionMarkup(
                  trainingDayOptions,
                  String(user.trainingDaysPerWeek)
                )}</select>
              </label>
              <label>
                <span>Nivel</span>
                <select data-field="level">${optionMarkup(levelOptions, user.level)}</select>
              </label>
              <label class="full">
                <span>Restricoes</span>
                <textarea data-field="restrictions" rows="3">${escapeHtml(
                  user.restrictions ?? ""
                )}</textarea>
              </label>
            </div>

            <div class="actions">
              <button data-action="save-user" data-user-id="${escapeHtml(user.id)}">Salvar cadastro</button>
              <button
                class="secondary"
                data-action="recalculate-user-workout"
                data-user-id="${escapeHtml(user.id)}"
              >
                Recalcular treino
              </button>
            </div>
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
  $("#exercises-count").textContent = `${state.exercises.length} exercicio(s)`;
  container.innerHTML = "";

  if (!state.exercises.length) {
    container.innerHTML = "<p class='muted-dark'>Nenhum exercicio encontrado.</p>";
    return;
  }

  state.exercises.forEach((exercise) => {
    const article = document.createElement("article");
    article.className = "item";

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
              <input data-field="name" type="text" value="${escapeHtml(exercise.name)}" />
            </label>
            <label>
              <span>Grupo muscular</span>
              <select data-field="muscleGroup">${optionMarkup(groups, exercise.muscleGroup)}</select>
            </label>
            <label>
              <span>Objetivo</span>
              <select data-field="goal">${optionMarkup(objectiveOptions, exercise.goal)}</select>
            </label>
            <label>
              <span>Ambiente</span>
              <select data-field="environment">${optionMarkup(
                environmentOptions,
                exercise.environment
              )}</select>
            </label>
            <label>
              <span>Calorias</span>
              <input data-field="calories" type="number" min="1" value="${escapeHtml(
                exercise.calories
              )}" />
            </label>
            <label>
              <span>Equipamento</span>
              <input data-field="equipment" type="text" value="${escapeHtml(exercise.equipment)}" />
            </label>
            <label class="full">
              <span>Link do video</span>
              <input data-field="videoUrl" type="url" value="${escapeHtml(exercise.videoUrl)}" />
            </label>
            <label class="full">
              <span>Descricao</span>
              <textarea data-field="description" rows="3">${escapeHtml(
                exercise.description
              )}</textarea>
            </label>
          </div>
          <div class="actions">
            <button data-action="save-exercise-edit" data-exercise-id="${escapeHtml(exercise.id)}">
              Salvar alteracoes
            </button>
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

async function loadAll() {
  const [health, usersPayload, exercisesPayload] = await Promise.all([
    request("/api/health"),
    request("/api/users"),
    request("/api/exercises"),
  ]);

  state.health = health;
  state.users = usersPayload.users;
  state.exercises = exercisesPayload.exercises;

  renderHealth();
  renderUsers();
  renderExercises();
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
    window.alert("Preencha todos os campos do exercicio.");
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
}

function readEditorFields(root) {
  return Object.fromEntries(
    [...root.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field.value])
  );
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
}

async function saveUser(button) {
  const editor = button.closest("[data-user-id]");
  const userId = editor?.dataset.userId;
  if (!editor || !userId) {
    return;
  }

  const raw = readEditorFields(editor);
  await request(`/api/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...raw,
      age: Number(raw.age),
      heightCm: Number(raw.heightCm),
      weightKg: Number(raw.weightKg),
      targetWeightKg: Number(raw.targetWeightKg),
      trainingDaysPerWeek: Number(raw.trainingDaysPerWeek),
    }),
  });

  await loadAll();
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
}

populateGroups();

$("#refresh-data").addEventListener("click", () => {
  loadAll().catch((error) => window.alert(error.message));
});

$("#refresh-exercises").addEventListener("click", () => {
  loadAll().catch((error) => window.alert(error.message));
});

$("#save-exercise").addEventListener("click", () => {
  saveExercise().catch((error) => window.alert(error.message));
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
  };

  const handler = handlers[action];
  if (!handler) {
    return;
  }

  handler().catch((error) => window.alert(error.message));
});

loadAll().catch((error) => {
  $("#server-status").innerHTML = `<p class="muted-dark">${escapeHtml(error.message)}</p>`;
});
