import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seedExercises } from "./catalog.js";
import {
  buildWorkoutPlan,
  calculateBmi,
  createReplacementSlot,
  generateId,
  hydrateUser,
  normalizeWorkoutPlan,
} from "./workout.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, "data", "fatburn.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    goal TEXT NOT NULL,
    environment TEXT NOT NULL,
    calories INTEGER NOT NULL,
    video_url TEXT NOT NULL,
    description TEXT NOT NULL,
    equipment TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    age INTEGER NOT NULL,
    sex TEXT NOT NULL,
    height_cm REAL NOT NULL,
    weight_kg REAL NOT NULL,
    target_weight_kg REAL NOT NULL,
    objective TEXT NOT NULL,
    training_environment TEXT NOT NULL,
    training_days_per_week INTEGER NOT NULL,
    level TEXT NOT NULL,
    restrictions TEXT,
    custom_workout_plan TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weight_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_entries_user_date
    ON weight_entries(user_id, date);

  CREATE TABLE IF NOT EXISTS completion_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    workout_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    calories INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(exercise_id) REFERENCES exercises(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_completion_user_date_workout_exercise
    ON completion_entries(user_id, date, workout_id, exercise_id);

  CREATE TABLE IF NOT EXISTS workout_status_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    week_key TEXT NOT NULL,
    workout_label TEXT NOT NULL,
    workout_name TEXT NOT NULL,
    workout_order INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_status_user_week_label
    ON workout_status_entries(user_id, week_key, workout_label);
`);

const completionColumns = db.prepare("PRAGMA table_info(completion_entries)").all();
if (!completionColumns.some((column) => column.name === "completed_sets")) {
  db.exec("ALTER TABLE completion_entries ADD COLUMN completed_sets TEXT");
}

const insertExercise = db.prepare(`
  INSERT INTO exercises (
    id, name, muscle_group, goal, environment, calories, video_url, description, equipment, created_at
  ) VALUES (
    @id, @name, @muscleGroup, @goal, @environment, @calories, @videoUrl, @description, @equipment, @createdAt
  )
`);

const existingSeedKeys = new Set(
  db
    .prepare("SELECT name, muscle_group, goal, environment FROM exercises")
    .all()
    .map(
      (row) =>
        `${row.name.toLowerCase()}|${row.muscle_group}|${row.goal}|${row.environment}`
    )
);

function buildSeedKey(exercise) {
  return `${exercise.name.toLowerCase()}|${exercise.muscleGroup}|${exercise.goal}|${exercise.environment}`;
}

function insertMissingSeeds(items) {
  db.exec("BEGIN");

  try {
    for (const exercise of items) {
      const seedKey = buildSeedKey(exercise);
      if (existingSeedKeys.has(seedKey)) {
        continue;
      }

      insertExercise.run({
        id: generateId("exercise"),
        createdAt: new Date().toISOString(),
        ...exercise,
      });
      existingSeedKeys.add(seedKey);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

insertMissingSeeds(seedExercises);

function syncSeedMetadata(items) {
  db.exec("BEGIN");

  try {
    for (const exercise of items) {
      db.prepare(
        `
        UPDATE exercises
        SET calories = ?, video_url = ?, description = ?, equipment = ?
        WHERE lower(name) = lower(?)
          AND muscle_group = ?
          AND goal = ?
          AND environment = ?
      `
      ).run(
        exercise.calories,
        exercise.videoUrl,
        exercise.description,
        exercise.equipment,
        exercise.name,
        exercise.muscleGroup,
        exercise.goal,
        exercise.environment
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

syncSeedMetadata(seedExercises);

const mapExerciseRow = (row) => ({
  id: row.id,
  name: row.name,
  muscleGroup: row.muscle_group,
  goal: row.goal,
  environment: row.environment,
  calories: row.calories,
  videoUrl: row.video_url,
  description: row.description,
  equipment: row.equipment,
});

const mapUserRow = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  password: row.password,
  age: row.age,
  sex: row.sex,
  heightCm: row.height_cm,
  weightKg: row.weight_kg,
  targetWeightKg: row.target_weight_kg,
  objective: row.objective,
  trainingEnvironment: row.training_environment,
  trainingDaysPerWeek: row.training_days_per_week,
  level: row.level,
  restrictions: row.restrictions ?? "",
  customWorkoutPlan: row.custom_workout_plan,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDayKey(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function getDayKey(value = new Date()) {
  if (typeof value === "string") {
    const [year, month, day] = value.split("-").map(Number);
    return formatLocalDayKey(new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0));
  }

  return formatLocalDayKey(value);
}

function getWeekKey(dateValue = new Date()) {
  const dayKey = getDayKey(dateValue);
  const [year, month, day] = dayKey.split("-").map(Number);
  const monday = new Date(year, month - 1, day, 12, 0, 0, 0);
  const weekDay = monday.getDay();
  const diffToMonday = weekDay === 0 ? -6 : 1 - weekDay;
  monday.setDate(monday.getDate() + diffToMonday);
  return formatLocalDayKey(monday);
}

function buildHydratedUser(userId, exercises = listExercises()) {
  const userRow = findUserRowById(userId);
  return hydrateUser(userRow, exercises);
}

function listWeeklyStatusRows(userId, weekKey) {
  return db
    .prepare(
      `
      SELECT * FROM workout_status_entries
      WHERE user_id = ? AND week_key = ?
      ORDER BY workout_order ASC, workout_label ASC
    `
    )
    .all(userId, weekKey);
}

function normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey = getWeekKey()) {
  if (!Array.isArray(workoutPlan) || !workoutPlan.length) {
    db.prepare("DELETE FROM workout_status_entries WHERE user_id = ? AND week_key = ?").run(
      userId,
      weekKey
    );
    return [];
  }

  const incomingLabels = new Set(workoutPlan.map((workout) => workout.label));
  const existingRows = listWeeklyStatusRows(userId, weekKey);
  const existingByLabel = new Map(existingRows.map((row) => [row.workout_label, row]));

  db.exec("BEGIN");

  try {
    for (const workout of workoutPlan) {
      const workoutOrder = workoutPlan.findIndex((item) => item.label === workout.label);
      const existing = existingByLabel.get(workout.label);

      if (existing) {
        db.prepare(
          `
          UPDATE workout_status_entries
          SET workout_name = ?, workout_order = ?
          WHERE id = ?
        `
        ).run(workout.name, workoutOrder, existing.id);
      } else {
        db.prepare(
          `
          INSERT INTO workout_status_entries (
            id, user_id, week_key, workout_label, workout_name, workout_order, status, started_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          generateId("workout-status"),
          userId,
          weekKey,
          workout.label,
          workout.name,
          workoutOrder,
          "pendente",
          null,
          null
        );
      }
    }

    for (const row of existingRows) {
      if (!incomingLabels.has(row.workout_label)) {
        db.prepare("DELETE FROM workout_status_entries WHERE id = ?").run(row.id);
      }
    }

    const syncedRows = listWeeklyStatusRows(userId, weekKey);
    const firstOpenRow = syncedRows.find((row) => row.status !== "concluido") ?? null;

    for (const row of syncedRows) {
      const nextStatus =
        row.status === "concluido"
          ? "concluido"
          : firstOpenRow && row.workout_label === firstOpenRow.workout_label
            ? "em_andamento"
            : "pendente";
      const nextStartedAt = nextStatus === "pendente" ? null : row.started_at ?? null;
      const nextCompletedAt = nextStatus === "concluido" ? row.completed_at ?? null : null;

      if (
        row.status !== nextStatus ||
        (row.started_at ?? null) !== nextStartedAt ||
        (row.completed_at ?? null) !== nextCompletedAt
      ) {
        db.prepare(
          `
          UPDATE workout_status_entries
          SET status = ?, started_at = ?, completed_at = ?
          WHERE id = ?
        `
        ).run(nextStatus, nextStartedAt, nextCompletedAt, row.id);
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listWeeklyStatusRows(userId, weekKey);
}

function mapWorkoutStatusRows(statusRows, workoutPlan, weekKey) {
  const workoutsByLabel = new Map(workoutPlan.map((workout) => [workout.label, workout]));

  return statusRows.map((row) => {
    const workout = workoutsByLabel.get(row.workout_label);

    return {
      id: row.id,
      weekKey,
      workoutId: workout?.id ?? null,
      workoutLabel: row.workout_label,
      workoutName: workout?.name ?? row.workout_name,
      workoutOrder: row.workout_order,
      status: row.status,
      startedAt: row.started_at ?? null,
      completedAt: row.completed_at ?? null,
    };
  });
}

function getWorkoutStatuses(userId, workoutPlan, weekKey = getWeekKey()) {
  const statusRows = normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
  return mapWorkoutStatusRows(statusRows, workoutPlan, weekKey);
}

function clearWorkoutCompletions(userId, workoutId, date) {
  db.prepare("DELETE FROM completion_entries WHERE user_id = ? AND workout_id = ? AND date = ?").run(
    userId,
    workoutId,
    date
  );
}

export function listExercises() {
  return db
    .prepare("SELECT * FROM exercises ORDER BY muscle_group, environment, name")
    .all()
    .map(mapExerciseRow);
}

export function findExerciseById(id) {
  const row = db.prepare("SELECT * FROM exercises WHERE id = ?").get(id);
  return row ? mapExerciseRow(row) : null;
}

export function createExercise(payload) {
  const id = generateId("exercise");
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO exercises (
      id, name, muscle_group, goal, environment, calories, video_url, description, equipment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.name,
    payload.muscleGroup,
    payload.goal,
    payload.environment,
    payload.calories,
    payload.videoUrl,
    payload.description,
    payload.equipment,
    createdAt
  );

  return findExerciseById(id);
}

export function updateExercise(exerciseId, payload) {
  db.prepare(`
    UPDATE exercises SET
      name = ?,
      muscle_group = ?,
      goal = ?,
      environment = ?,
      calories = ?,
      video_url = ?,
      description = ?,
      equipment = ?
    WHERE id = ?
  `).run(
    payload.name,
    payload.muscleGroup,
    payload.goal,
    payload.environment,
    payload.calories,
    payload.videoUrl,
    payload.description,
    payload.equipment,
    exerciseId
  );

  return findExerciseById(exerciseId);
}

export function findUserRowByEmail(email) {
  const row = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email);
  return row ? mapUserRow(row) : null;
}

export function findUserRowById(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? mapUserRow(row) : null;
}

function setUserWorkoutPlan(userId, workoutPlan) {
  db.prepare("UPDATE users SET custom_workout_plan = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(workoutPlan),
    new Date().toISOString(),
    userId
  );
}

function migrateLegacyWorkoutPlans() {
  const exercises = listExercises();
  const rows = db
    .prepare("SELECT * FROM users WHERE custom_workout_plan IS NOT NULL")
    .all();

  for (const row of rows) {
    const userRow = mapUserRow(row);
    const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
    const userContext = {
      objective: userRow.objective,
      trainingDaysPerWeek: userRow.trainingDaysPerWeek,
      bmi,
      weightKg: userRow.weightKg,
      heightCm: userRow.heightCm,
      trainingEnvironment: userRow.trainingEnvironment,
      level: userRow.level,
    };

    try {
      const parsedPlan = JSON.parse(userRow.customWorkoutPlan);
      const normalizedPlan = normalizeWorkoutPlan(parsedPlan, userContext, exercises);

      if (JSON.stringify(parsedPlan) !== JSON.stringify(normalizedPlan)) {
        setUserWorkoutPlan(userRow.id, normalizedPlan);
      }
    } catch {
      const rebuiltPlan = buildWorkoutPlan(userContext, exercises);
      setUserWorkoutPlan(userRow.id, rebuiltPlan);
    }
  }
}

migrateLegacyWorkoutPlans();

export function registerUser(payload) {
  const id = generateId("user");
  const timestamp = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (
      id, name, email, password, age, sex, height_cm, weight_kg, target_weight_kg, objective,
      training_environment, training_days_per_week, level, restrictions, custom_workout_plan, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.name,
    payload.email.toLowerCase(),
    payload.password,
    payload.age,
    payload.sex,
    payload.heightCm,
    payload.weightKg,
    payload.targetWeightKg,
    payload.objective,
    payload.trainingEnvironment,
    payload.trainingDaysPerWeek,
    payload.level,
    payload.restrictions ?? "",
    null,
    timestamp,
    timestamp
  );

  const userRow = findUserRowById(id);
  const exercises = listExercises();
  const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
  const workoutPlan = buildWorkoutPlan(
    {
      objective: userRow.objective,
      trainingDaysPerWeek: userRow.trainingDaysPerWeek,
      bmi,
      weightKg: userRow.weightKg,
      heightCm: userRow.heightCm,
      trainingEnvironment: userRow.trainingEnvironment,
      level: userRow.level,
    },
    exercises
  );
  setUserWorkoutPlan(id, workoutPlan);
  upsertWeightEntry(id, userRow.weightKg, new Date().toISOString().slice(0, 10));

  return getUserBundle(id);
}

export function updateUser(userId, payload) {
  db.prepare(`
    UPDATE users SET
      name = ?,
      email = ?,
      password = ?,
      age = ?,
      sex = ?,
      height_cm = ?,
      weight_kg = ?,
      target_weight_kg = ?,
      objective = ?,
      training_environment = ?,
      training_days_per_week = ?,
      level = ?,
      restrictions = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    payload.name,
    payload.email.toLowerCase(),
    payload.password,
    payload.age,
    payload.sex,
    payload.heightCm,
    payload.weightKg,
    payload.targetWeightKg,
    payload.objective,
    payload.trainingEnvironment,
    payload.trainingDaysPerWeek,
    payload.level,
    payload.restrictions ?? "",
    new Date().toISOString(),
    userId
  );

  recalculateWorkoutPlan(userId);
  upsertWeightEntry(userId, payload.weightKg, new Date().toISOString().slice(0, 10));
  return getUserBundle(userId);
}

export function recalculateWorkoutPlan(userId) {
  const userRow = findUserRowById(userId);
  const exercises = listExercises();
  const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
  const workoutPlan = buildWorkoutPlan(
    {
      objective: userRow.objective,
      trainingDaysPerWeek: userRow.trainingDaysPerWeek,
      bmi,
      weightKg: userRow.weightKg,
      heightCm: userRow.heightCm,
      trainingEnvironment: userRow.trainingEnvironment,
      level: userRow.level,
    },
    exercises
  );
  setUserWorkoutPlan(userId, workoutPlan);
  return workoutPlan;
}

export function replaceWorkoutExercise(userId, workoutId, slotId, nextExerciseId) {
  const userRow = findUserRowById(userId);
  const exercises = listExercises();
  const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
  const userContext = {
    objective: userRow.objective,
    trainingDaysPerWeek: userRow.trainingDaysPerWeek,
    bmi,
    weightKg: userRow.weightKg,
    heightCm: userRow.heightCm,
    trainingEnvironment: userRow.trainingEnvironment,
    level: userRow.level,
  };
  const plan = userRow.customWorkoutPlan ? JSON.parse(userRow.customWorkoutPlan) : [];
  const normalizedPlan = normalizeWorkoutPlan(plan, userContext, exercises);
  const previousSlot = normalizedPlan
    .flatMap((workout) => workout.exercises)
    .find((slot) => slot.slotId === slotId);
  const nextExercise = findExerciseById(nextExerciseId);
  const nextPlan = normalizedPlan.map((workout) =>
    workout.id === workoutId
      ? {
          ...workout,
          exercises: workout.exercises.map((slot) =>
            slot.slotId === slotId && nextExercise
              ? createReplacementSlot(userContext, nextExercise, slot.muscleGroup, slot.slotId)
              : slot
          ),
        }
      : workout
  );
  if (previousSlot) {
    db.prepare(
      "DELETE FROM completion_entries WHERE user_id = ? AND workout_id = ? AND exercise_id = ?"
    ).run(userId, workoutId, previousSlot.exerciseId);
  }
  setUserWorkoutPlan(userId, nextPlan);
  return nextPlan;
}

export function updateWorkoutSet(userId, workoutId, slotId, setId, payload) {
  const userRow = findUserRowById(userId);
  const exercises = listExercises();
  const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
  const userContext = {
    objective: userRow.objective,
    trainingDaysPerWeek: userRow.trainingDaysPerWeek,
    bmi,
    weightKg: userRow.weightKg,
    heightCm: userRow.heightCm,
    trainingEnvironment: userRow.trainingEnvironment,
    level: userRow.level,
  };
  const plan = userRow.customWorkoutPlan ? JSON.parse(userRow.customWorkoutPlan) : [];
  const normalizedPlan = normalizeWorkoutPlan(plan, userContext, exercises);
  const nextPlan = normalizedPlan.map((workout) =>
    workout.id === workoutId
      ? {
          ...workout,
          exercises: workout.exercises.map((slot) =>
            slot.slotId === slotId
              ? {
                  ...slot,
                  sets: slot.sets.map((set) =>
                    set.id === setId
                      ? {
                          ...set,
                          repetitions:
                            typeof payload.repetitions === "string"
                              ? payload.repetitions
                              : set.repetitions,
                          load: typeof payload.load === "string" ? payload.load : set.load,
                        }
                      : set
                  ),
                }
              : slot
          ),
        }
      : workout
  );
  setUserWorkoutPlan(userId, nextPlan);
  return nextPlan;
}

export function startWorkoutSession(userId, workoutLabel, date = getDayKey()) {
  const workoutPlan = buildHydratedUser(userId).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  if (selected.status !== "em_andamento") {
    throw new Error("Conclua o treino atual da semana antes de iniciar o proximo.");
  }

  db.prepare(
    `
    UPDATE workout_status_entries
    SET started_at = COALESCE(started_at, ?)
    WHERE id = ?
  `
  ).run(new Date().toISOString(), selected.id);
}

export function finishWorkoutSession(userId, workoutLabel, date = getDayKey()) {
  const workoutPlan = buildHydratedUser(userId).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  if (selected.status !== "em_andamento") {
    throw new Error("Esse treino nao esta liberado para finalizacao neste momento.");
  }

  db.prepare(
    `
    UPDATE workout_status_entries
    SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ?
    WHERE id = ?
  `
  ).run("concluido", new Date().toISOString(), new Date().toISOString(), selected.id);

  normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
}

export function restartWorkoutSession(userId, workoutLabel, workoutId, date = getDayKey()) {
  const workoutPlan = buildHydratedUser(userId).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  clearWorkoutCompletions(userId, workoutId, date);

  db.prepare(
    `
    UPDATE workout_status_entries
    SET status = ?, started_at = NULL, completed_at = NULL
    WHERE user_id = ? AND week_key = ? AND workout_order >= ?
  `
  ).run("pendente", userId, weekKey, selected.workoutOrder);

  normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
}

export function listUsers() {
  const exercises = listExercises();
  return db
    .prepare("SELECT * FROM users ORDER BY created_at DESC")
    .all()
    .map((row) => hydrateUser(mapUserRow(row), exercises));
}

export function upsertWeightEntry(userId, weightKg, date) {
  const existing = db
    .prepare("SELECT id FROM weight_entries WHERE user_id = ? AND date = ?")
    .get(userId, date);

  if (existing) {
    db.prepare("UPDATE weight_entries SET weight_kg = ? WHERE id = ?").run(weightKg, existing.id);
  } else {
    db.prepare("INSERT INTO weight_entries (id, user_id, date, weight_kg) VALUES (?, ?, ?, ?)").run(
      generateId("weight"),
      userId,
      date,
      weightKg
    );
  }

  db.prepare("UPDATE users SET weight_kg = ?, updated_at = ? WHERE id = ?").run(
    weightKg,
    new Date().toISOString(),
    userId
  );
}

export function listWeightEntries(userId) {
  return db
    .prepare("SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date ASC")
    .all(userId)
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      date: row.date,
      weightKg: row.weight_kg,
    }));
}

export function updateCompletion(userId, date, workoutId, exerciseId, calories, completedSetIds) {
  const existing = db
    .prepare(
      "SELECT id FROM completion_entries WHERE user_id = ? AND date = ? AND workout_id = ? AND exercise_id = ?"
    )
    .get(userId, date, workoutId, exerciseId);

  if (!Array.isArray(completedSetIds) || !completedSetIds.length) {
    if (existing) {
      db.prepare("DELETE FROM completion_entries WHERE id = ?").run(existing.id);
    }
    return;
  }

  if (existing) {
    db.prepare(`
      UPDATE completion_entries
      SET calories = ?, completed_sets = ?
      WHERE id = ?
    `).run(calories, JSON.stringify(completedSetIds), existing.id);
  } else {
    db.prepare(`
      INSERT INTO completion_entries (
        id, user_id, date, workout_id, exercise_id, calories, completed_sets
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId("done"),
      userId,
      date,
      workoutId,
      exerciseId,
      calories,
      JSON.stringify(completedSetIds)
    );
  }
}

export function listCompletionEntries(userId) {
  const userRow = findUserRowById(userId);
  const exercises = listExercises();
  const bmi = calculateBmi(userRow.weightKg, userRow.heightCm);
  const userContext = {
    objective: userRow.objective,
    trainingDaysPerWeek: userRow.trainingDaysPerWeek,
    bmi,
    weightKg: userRow.weightKg,
    heightCm: userRow.heightCm,
    trainingEnvironment: userRow.trainingEnvironment,
    level: userRow.level,
  };
  const plan = userRow.customWorkoutPlan ? JSON.parse(userRow.customWorkoutPlan) : [];
  const normalizedPlan = normalizeWorkoutPlan(plan, userContext, exercises);

  return db
    .prepare("SELECT * FROM completion_entries WHERE user_id = ? ORDER BY date ASC")
    .all(userId)
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      date: row.date,
      workoutId: row.workout_id,
      exerciseId: row.exercise_id,
      calories: row.calories,
      completedSetIds: row.completed_sets
        ? JSON.parse(row.completed_sets)
        : row.calories > 0
          ? normalizedPlan
              .find((workout) => workout.id === row.workout_id)
              ?.exercises.find((slot) => slot.exerciseId === row.exercise_id)
              ?.sets.map((set) => set.id) ?? []
          : [],
    }));
}

export function getUserBundle(userId) {
  const userRow = findUserRowById(userId);
  const exercises = listExercises();
  const user = hydrateUser(userRow, exercises);

  return {
    user,
    exercises,
    weightEntries: listWeightEntries(userId),
    completionEntries: listCompletionEntries(userId),
    workoutStatuses: getWorkoutStatuses(userId, user.workoutPlan),
  };
}
