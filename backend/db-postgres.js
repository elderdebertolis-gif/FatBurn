import pg from "pg";
import { seedExercises } from "./catalog.js";
import {
  PRIVACY_POLICY_VERSION,
  ROLE_PERMISSION_PRESETS,
  SENSITIVE_CONSENT_VERSION,
  hashPassword,
  hashToken,
  needsPasswordMigration,
  normalizePortalPermissions,
  normalizePortalRole,
  sanitizeInstructor,
  sanitizeUserProfile,
} from "./security.js";
import {
  buildWorkoutPlan,
  calculateBmi,
  createReplacementSlot,
  generateId,
  hydrateUser,
  normalizeWorkoutPlan,
} from "./workout.js";

const { Pool } = pg;

const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL nao configurada. Defina a URL do PostgreSQL para iniciar o backend.");
}

const useSsl = String(process.env.PGSSL ?? "")
  .trim()
  .toLowerCase() === "true";

export const db = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function safeParseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function query(text, params = []) {
  return db.query(text, params);
}

async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] ?? null;
}

async function execute(executor, text, params = []) {
  return executor.query(text, params);
}

async function transaction(run) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const mapExerciseRow = (row) => ({
  id: row.id,
  name: row.name,
  muscleGroup: row.muscle_group,
  goal: row.goal,
  environment: row.environment,
  calories: Number(row.calories),
  videoUrl: row.video_url,
  description: row.description,
  equipment: row.equipment,
});

const mapUserRow = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password,
  age: Number(row.age),
  sex: row.sex,
  heightCm: Number(row.height_cm),
  weightKg: Number(row.weight_kg),
  targetWeightKg: Number(row.target_weight_kg),
  objective: row.objective,
  trainingEnvironment: row.training_environment,
  trainingDaysPerWeek: Number(row.training_days_per_week),
  level: row.level,
  restrictions: row.restrictions ?? "",
  customWorkoutPlan: row.custom_workout_plan,
  privacyPolicyVersion: row.privacy_policy_version ?? null,
  privacyAcceptedAt: toIso(row.privacy_policy_accepted_at),
  sensitiveConsentVersion: row.sensitive_consent_version ?? null,
  sensitiveConsentAcceptedAt: toIso(row.sensitive_consent_accepted_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const mapInstructorRow = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  role: normalizePortalRole(row.role ?? "instrutor"),
  permissions: safeParseJson(row.permissions_json, []),
  isActive: row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

async function initializeDatabase() {
  await query(`
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
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      age INTEGER NOT NULL,
      sex TEXT NOT NULL,
      height_cm DOUBLE PRECISION NOT NULL,
      weight_kg DOUBLE PRECISION NOT NULL,
      target_weight_kg DOUBLE PRECISION NOT NULL,
      objective TEXT NOT NULL,
      training_environment TEXT NOT NULL,
      training_days_per_week INTEGER NOT NULL,
      level TEXT NOT NULL,
      restrictions TEXT,
      custom_workout_plan TEXT,
      privacy_policy_version TEXT,
      privacy_policy_accepted_at TIMESTAMPTZ,
      sensitive_consent_version TEXT,
      sensitive_consent_accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weight_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      weight_kg DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completion_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      calories INTEGER NOT NULL,
      completed_sets TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_status_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_key TEXT NOT NULL,
      workout_label TEXT NOT NULL,
      workout_name TEXT NOT NULL,
      workout_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS instructors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT,
      permissions_json TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      instructor_id TEXT REFERENCES instructors(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_seed_identity
      ON exercises ((lower(name)), muscle_group, goal, environment);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_entries_user_date
      ON weight_entries (user_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_completion_user_date_workout_exercise
      ON completion_entries (user_id, date, workout_id, exercise_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_status_user_week_label
      ON workout_status_entries (user_id, week_key, workout_label);
    CREATE INDEX IF NOT EXISTS idx_sessions_role_user
      ON sessions (role, user_id, instructor_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_codes_lookup
      ON password_reset_codes ((lower(email)), created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user
      ON password_reset_codes (user_id, consumed_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_target
      ON audit_logs (target_id, actor_id);
  `);
}

function buildSeedKey(exercise) {
  return `${exercise.name.toLowerCase()}|${exercise.muscleGroup}|${exercise.goal}|${exercise.environment}`;
}

async function insertMissingSeeds(items) {
  const existingRows = await query(`
    SELECT name, muscle_group, goal, environment
    FROM exercises
  `);

  const existingKeys = new Set(
    existingRows.rows.map(
      (row) =>
        `${String(row.name).toLowerCase()}|${row.muscle_group}|${row.goal}|${row.environment}`
    )
  );

  await transaction(async (client) => {
    for (const exercise of items) {
      const seedKey = buildSeedKey(exercise);
      if (existingKeys.has(seedKey)) {
        continue;
      }

      await execute(
        client,
        `
          INSERT INTO exercises (
            id, name, muscle_group, goal, environment, calories, video_url, description, equipment, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          generateId("exercise"),
          exercise.name,
          exercise.muscleGroup,
          exercise.goal,
          exercise.environment,
          exercise.calories,
          exercise.videoUrl,
          exercise.description,
          exercise.equipment,
          new Date().toISOString(),
        ]
      );

      existingKeys.add(seedKey);
    }
  });
}

async function syncSeedMetadata(items) {
  await transaction(async (client) => {
    for (const exercise of items) {
      await execute(
        client,
        `
          UPDATE exercises
          SET calories = $1, video_url = $2, description = $3, equipment = $4
          WHERE lower(name) = lower($5)
            AND muscle_group = $6
            AND goal = $7
            AND environment = $8
        `,
        [
          exercise.calories,
          exercise.videoUrl,
          exercise.description,
          exercise.equipment,
          exercise.name,
          exercise.muscleGroup,
          exercise.goal,
          exercise.environment,
        ]
      );
    }
  });
}

async function migrateLegacyPasswords() {
  const userRows = await query(`SELECT id, password FROM users`);

  for (const row of userRows.rows) {
    if (!needsPasswordMigration(row.password)) {
      continue;
    }

    await query(`UPDATE users SET password = $1, updated_at = $2 WHERE id = $3`, [
      hashPassword(row.password),
      new Date().toISOString(),
      row.id,
    ]);
  }

  const instructorRows = await query(`SELECT id, password_hash FROM instructors`);

  for (const row of instructorRows.rows) {
    if (!needsPasswordMigration(row.password_hash)) {
      continue;
    }

    await query(`UPDATE instructors SET password_hash = $1, updated_at = $2 WHERE id = $3`, [
      hashPassword(row.password_hash),
      new Date().toISOString(),
      row.id,
    ]);
  }
}

async function migrateInstructorAccessMetadata() {
  const rows = await query(`
    SELECT id, email, role, permissions_json, is_active
    FROM instructors
  `);

  const adminEmail = String(process.env.FATBURN_ADMIN_EMAIL ?? "admin@fatburn.app")
    .trim()
    .toLowerCase();

  for (const row of rows.rows) {
    const parsedPermissions = safeParseJson(row.permissions_json, []);
    const isConfiguredAdmin = String(row.email ?? "").trim().toLowerCase() === adminEmail;
    const role = isConfiguredAdmin ? "admin" : normalizePortalRole(row.role ?? "instrutor");
    const permissions = normalizePortalPermissions(parsedPermissions, role);
    const isActive =
      row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active);

    await query(
      `
        UPDATE instructors
        SET role = $1, permissions_json = $2, is_active = $3, updated_at = $4
        WHERE id = $5
      `,
      [role, JSON.stringify(permissions), isActive, new Date().toISOString(), row.id]
    );
  }
}

async function ensureDefaultInstructor() {
  const email = String(process.env.FATBURN_ADMIN_EMAIL ?? "admin@fatburn.app")
    .trim()
    .toLowerCase();
  const password = String(process.env.FATBURN_ADMIN_PASSWORD ?? "FatBurn@123").trim();
  const existing = await queryOne(`SELECT id FROM instructors WHERE lower(email) = lower($1)`, [
    email,
  ]);

  if (existing) {
    return;
  }

  const timestamp = new Date().toISOString();
  await query(
    `
      INSERT INTO instructors (
        id, name, email, password_hash, role, permissions_json, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      generateId("instructor"),
      "Instrutor FatBurn",
      email,
      hashPassword(password),
      "admin",
      JSON.stringify(ROLE_PERMISSION_PRESETS.admin),
      true,
      timestamp,
      timestamp,
    ]
  );
}

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

async function buildHydratedUser(userId, exercisesInput = null) {
  const userRow = await findUserRowById(userId);
  if (!userRow) {
    throw new Error("Usuario nao encontrado.");
  }

  const exercises = exercisesInput ?? (await listExercises());
  return hydrateUser(userRow, exercises);
}

async function listWeeklyStatusRows(userId, weekKey, executor = db) {
  const result = await execute(
    executor,
    `
      SELECT *
      FROM workout_status_entries
      WHERE user_id = $1 AND week_key = $2
      ORDER BY workout_order ASC, workout_label ASC
    `,
    [userId, weekKey]
  );

  return result.rows;
}

async function normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey = getWeekKey()) {
  if (!Array.isArray(workoutPlan) || !workoutPlan.length) {
    await query(`DELETE FROM workout_status_entries WHERE user_id = $1 AND week_key = $2`, [
      userId,
      weekKey,
    ]);
    return [];
  }

  return transaction(async (client) => {
    const incomingLabels = new Set(workoutPlan.map((workout) => workout.label));
    const existingRows = await listWeeklyStatusRows(userId, weekKey, client);
    const existingByLabel = new Map(existingRows.map((row) => [row.workout_label, row]));

    for (const [workoutOrder, workout] of workoutPlan.entries()) {
      const existing = existingByLabel.get(workout.label);

      if (existing) {
        await execute(
          client,
          `
            UPDATE workout_status_entries
            SET workout_name = $1, workout_order = $2
            WHERE id = $3
          `,
          [workout.name, workoutOrder, existing.id]
        );
      } else {
        await execute(
          client,
          `
            INSERT INTO workout_status_entries (
              id, user_id, week_key, workout_label, workout_name, workout_order, status, started_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            generateId("workout-status"),
            userId,
            weekKey,
            workout.label,
            workout.name,
            workoutOrder,
            "pendente",
            null,
            null,
          ]
        );
      }
    }

    for (const row of existingRows) {
      if (!incomingLabels.has(row.workout_label)) {
        await execute(client, `DELETE FROM workout_status_entries WHERE id = $1`, [row.id]);
      }
    }

    const syncedRows = await listWeeklyStatusRows(userId, weekKey, client);
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
        toIso(row.started_at) !== toIso(nextStartedAt) ||
        toIso(row.completed_at) !== toIso(nextCompletedAt)
      ) {
        await execute(
          client,
          `
            UPDATE workout_status_entries
            SET status = $1, started_at = $2, completed_at = $3
            WHERE id = $4
          `,
          [nextStatus, nextStartedAt, nextCompletedAt, row.id]
        );
      }
    }

    return listWeeklyStatusRows(userId, weekKey, client);
  });
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
      workoutOrder: Number(row.workout_order),
      status: row.status,
      startedAt: toIso(row.started_at),
      completedAt: toIso(row.completed_at),
    };
  });
}

async function getWorkoutStatuses(userId, workoutPlan, weekKey = getWeekKey()) {
  const statusRows = await normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
  return mapWorkoutStatusRows(statusRows, workoutPlan, weekKey);
}

async function clearWorkoutCompletions(userId, workoutId, date) {
  await query(
    `DELETE FROM completion_entries WHERE user_id = $1 AND workout_id = $2 AND date = $3`,
    [userId, workoutId, date]
  );
}

async function setUserWorkoutPlan(userId, workoutPlan) {
  await query(`UPDATE users SET custom_workout_plan = $1, updated_at = $2 WHERE id = $3`, [
    JSON.stringify(workoutPlan),
    new Date().toISOString(),
    userId,
  ]);
}

async function migrateLegacyWorkoutPlans() {
  const exercises = await listExercises();
  const rows = await query(`
    SELECT *
    FROM users
    WHERE custom_workout_plan IS NOT NULL
  `);

  for (const row of rows.rows) {
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
        await setUserWorkoutPlan(userRow.id, normalizedPlan);
      }
    } catch {
      const rebuiltPlan = buildWorkoutPlan(userContext, exercises);
      await setUserWorkoutPlan(userRow.id, rebuiltPlan);
    }
  }
}

export async function listExercises() {
  const result = await query(`
    SELECT *
    FROM exercises
    ORDER BY muscle_group, environment, name
  `);

  return result.rows.map(mapExerciseRow);
}

export async function findExerciseById(id) {
  const row = await queryOne(`SELECT * FROM exercises WHERE id = $1`, [id]);
  return row ? mapExerciseRow(row) : null;
}

export async function createExercise(payload) {
  const id = generateId("exercise");
  const createdAt = new Date().toISOString();

  await query(
    `
      INSERT INTO exercises (
        id, name, muscle_group, goal, environment, calories, video_url, description, equipment, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      id,
      payload.name,
      payload.muscleGroup,
      payload.goal,
      payload.environment,
      payload.calories,
      payload.videoUrl,
      payload.description,
      payload.equipment,
      createdAt,
    ]
  );

  return findExerciseById(id);
}

export async function updateExercise(exerciseId, payload) {
  await query(
    `
      UPDATE exercises
      SET
        name = $1,
        muscle_group = $2,
        goal = $3,
        environment = $4,
        calories = $5,
        video_url = $6,
        description = $7,
        equipment = $8
      WHERE id = $9
    `,
    [
      payload.name,
      payload.muscleGroup,
      payload.goal,
      payload.environment,
      payload.calories,
      payload.videoUrl,
      payload.description,
      payload.equipment,
      exerciseId,
    ]
  );

  return findExerciseById(exerciseId);
}

export async function findUserRowByEmail(email) {
  const row = await queryOne(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  return row ? mapUserRow(row) : null;
}

export async function findUserRowById(id) {
  const row = await queryOne(`SELECT * FROM users WHERE id = $1`, [id]);
  return row ? mapUserRow(row) : null;
}

export async function findInstructorRowByEmail(email) {
  const row = await queryOne(`SELECT * FROM instructors WHERE lower(email) = lower($1)`, [
    email,
  ]);
  return row ? mapInstructorRow(row) : null;
}

export async function findInstructorRowById(id) {
  const row = await queryOne(`SELECT * FROM instructors WHERE id = $1`, [id]);
  return row ? mapInstructorRow(row) : null;
}

export async function listInstructors() {
  const result = await query(`
    SELECT *
    FROM instructors
    ORDER BY created_at ASC
  `);

  return result.rows.map((row) => sanitizeInstructor(mapInstructorRow(row)));
}

export async function createInstructor(payload) {
  const role = normalizePortalRole(payload.role);
  const permissions = normalizePortalPermissions(payload.permissions, role);
  const timestamp = new Date().toISOString();
  const id = generateId("instructor");

  await query(
    `
      INSERT INTO instructors (
        id, name, email, password_hash, role, permissions_json, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      payload.name,
      payload.email.toLowerCase(),
      hashPassword(payload.password),
      role,
      JSON.stringify(permissions),
      Boolean(payload.isActive),
      timestamp,
      timestamp,
    ]
  );

  return sanitizeInstructor(await findInstructorRowById(id));
}

export async function updateInstructor(instructorId, payload) {
  const existing = await findInstructorRowById(instructorId);
  const role = normalizePortalRole(payload.role ?? existing.role);
  const permissions = normalizePortalPermissions(payload.permissions ?? existing.permissions, role);
  const nextPasswordHash =
    typeof payload.password === "string" && payload.password.trim()
      ? hashPassword(payload.password.trim())
      : existing.passwordHash;

  await query(
    `
      UPDATE instructors
      SET
        name = $1,
        email = $2,
        password_hash = $3,
        role = $4,
        permissions_json = $5,
        is_active = $6,
        updated_at = $7
      WHERE id = $8
    `,
    [
      payload.name,
      payload.email.toLowerCase(),
      nextPasswordHash,
      role,
      JSON.stringify(permissions),
      Boolean(payload.isActive),
      new Date().toISOString(),
      instructorId,
    ]
  );

  return sanitizeInstructor(await findInstructorRowById(instructorId));
}

export async function createSession(payload) {
  const id = generateId("session");
  const token = payload.token;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + payload.ttlHours * 60 * 60 * 1000).toISOString();

  await query(
    `
      INSERT INTO sessions (
        id, role, user_id, instructor_id, token_hash, created_at, expires_at, revoked_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      payload.role,
      payload.userId ?? null,
      payload.instructorId ?? null,
      hashToken(token),
      createdAt,
      expiresAt,
      null,
      createdAt,
    ]
  );

  return {
    id,
    token,
    role: payload.role,
    userId: payload.userId ?? null,
    instructorId: payload.instructorId ?? null,
    createdAt,
    expiresAt,
  };
}

export async function findSessionByToken(token) {
  if (!token) {
    return null;
  }

  const row = await queryOne(
    `
      SELECT *
      FROM sessions
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `,
    [hashToken(token)]
  );

  if (!row) {
    return null;
  }

  await query(`UPDATE sessions SET last_seen_at = $1 WHERE id = $2`, [
    new Date().toISOString(),
    row.id,
  ]);

  return {
    id: row.id,
    role: row.role,
    userId: row.user_id ?? null,
    instructorId: row.instructor_id ?? null,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

export async function revokeSession(token) {
  if (!token) {
    return;
  }

  await query(`UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2`, [
    new Date().toISOString(),
    hashToken(token),
  ]);
}

export async function revokeSessionsForUser(userId) {
  await query(
    `UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`,
    [new Date().toISOString(), userId]
  );
}

export async function createPasswordResetCode(userId, email, code, expiresAt) {
  const timestamp = new Date().toISOString();

  await transaction(async (client) => {
    await execute(
      client,
      `
        UPDATE password_reset_codes
        SET consumed_at = $1
        WHERE user_id = $2 AND consumed_at IS NULL
      `,
      [timestamp, userId]
    );

    await execute(
      client,
      `
        INSERT INTO password_reset_codes (
          id, user_id, email, code_hash, expires_at, consumed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        generateId("password-reset"),
        userId,
        email.toLowerCase(),
        hashToken(code),
        expiresAt,
        null,
        timestamp,
      ]
    );
  });
}

export async function consumePasswordResetCode(email, code) {
  const row = await queryOne(
    `
      SELECT *
      FROM password_reset_codes
      WHERE lower(email) = lower($1)
        AND code_hash = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [email, hashToken(code)]
  );

  if (!row) {
    return null;
  }

  const consumedAt = new Date().toISOString();
  await query(`UPDATE password_reset_codes SET consumed_at = $1 WHERE id = $2`, [
    consumedAt,
    row.id,
  ]);

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    consumedAt,
  };
}

export async function updateUserPassword(userId, password) {
  await query(`UPDATE users SET password = $1, updated_at = $2 WHERE id = $3`, [
    hashPassword(password),
    new Date().toISOString(),
    userId,
  ]);
}

export async function logAuditEvent(payload) {
  await query(
    `
      INSERT INTO audit_logs (
        id, actor_type, actor_id, action, target_type, target_id, metadata_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      generateId("audit"),
      payload.actorType,
      payload.actorId,
      payload.action,
      payload.targetType,
      payload.targetId ?? null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      new Date().toISOString(),
    ]
  );
}

export async function registerUser(payload) {
  const id = generateId("user");
  const timestamp = new Date().toISOString();
  const acceptedPrivacyAt = payload.acceptedPrivacyPolicy ? timestamp : null;
  const acceptedSensitiveConsentAt = payload.acceptedSensitiveDataConsent ? timestamp : null;

  await query(
    `
      INSERT INTO users (
        id, name, email, password, age, sex, height_cm, weight_kg, target_weight_kg, objective,
        training_environment, training_days_per_week, level, restrictions, custom_workout_plan,
        privacy_policy_version, privacy_policy_accepted_at, sensitive_consent_version, sensitive_consent_accepted_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    `,
    [
      id,
      payload.name,
      payload.email.toLowerCase(),
      hashPassword(payload.password),
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
      PRIVACY_POLICY_VERSION,
      acceptedPrivacyAt,
      SENSITIVE_CONSENT_VERSION,
      acceptedSensitiveConsentAt,
      timestamp,
      timestamp,
    ]
  );

  const exercises = await listExercises();
  const workoutPlan = buildWorkoutPlan(
    {
      objective: payload.objective,
      trainingDaysPerWeek: payload.trainingDaysPerWeek,
      bmi: calculateBmi(payload.weightKg, payload.heightCm),
      weightKg: payload.weightKg,
      heightCm: payload.heightCm,
      trainingEnvironment: payload.trainingEnvironment,
      level: payload.level,
    },
    exercises
  );

  await setUserWorkoutPlan(id, workoutPlan);
  await upsertWeightEntry(id, payload.weightKg, new Date().toISOString().slice(0, 10));
  return getUserBundle(id);
}

export async function updateUser(userId, payload) {
  const userRow = await findUserRowById(userId);
  const nextPasswordHash = payload.password?.trim()
    ? hashPassword(payload.password.trim())
    : userRow.passwordHash;

  await query(
    `
      UPDATE users
      SET
        name = $1,
        email = $2,
        password = $3,
        age = $4,
        sex = $5,
        height_cm = $6,
        weight_kg = $7,
        target_weight_kg = $8,
        objective = $9,
        training_environment = $10,
        training_days_per_week = $11,
        level = $12,
        restrictions = $13,
        updated_at = $14
      WHERE id = $15
    `,
    [
      payload.name,
      payload.email.toLowerCase(),
      nextPasswordHash,
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
      userId,
    ]
  );

  await recalculateWorkoutPlan(userId);
  await upsertWeightEntry(userId, payload.weightKg, new Date().toISOString().slice(0, 10));
  return getUserBundle(userId);
}

export async function recalculateWorkoutPlan(userId) {
  const userRow = await findUserRowById(userId);
  const exercises = await listExercises();
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

  await setUserWorkoutPlan(userId, workoutPlan);
  return workoutPlan;
}

export async function replaceWorkoutExercise(userId, workoutId, slotId, nextExerciseId) {
  const userRow = await findUserRowById(userId);
  const exercises = await listExercises();
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
  const plan = userRow.customWorkoutPlan ? safeParseJson(userRow.customWorkoutPlan, []) : [];
  const normalizedPlan = normalizeWorkoutPlan(plan, userContext, exercises);
  const previousSlot = normalizedPlan
    .flatMap((workout) => workout.exercises)
    .find((slot) => slot.slotId === slotId);
  const nextExercise = await findExerciseById(nextExerciseId);
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
    await query(
      `DELETE FROM completion_entries WHERE user_id = $1 AND workout_id = $2 AND exercise_id = $3`,
      [userId, workoutId, previousSlot.exerciseId]
    );
  }

  await setUserWorkoutPlan(userId, nextPlan);
  return nextPlan;
}

export async function updateWorkoutSet(userId, workoutId, slotId, setId, payload) {
  const userRow = await findUserRowById(userId);
  const exercises = await listExercises();
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
  const plan = userRow.customWorkoutPlan ? safeParseJson(userRow.customWorkoutPlan, []) : [];
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

  await setUserWorkoutPlan(userId, nextPlan);
  return nextPlan;
}

export async function startWorkoutSession(userId, workoutLabel, date = getDayKey()) {
  const workoutPlan = (await buildHydratedUser(userId)).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = await getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  if (selected.status !== "em_andamento") {
    throw new Error("Conclua o treino atual da semana antes de iniciar o proximo.");
  }

  await query(
    `
      UPDATE workout_status_entries
      SET started_at = COALESCE(started_at, $1)
      WHERE id = $2
    `,
    [new Date().toISOString(), selected.id]
  );
}

export async function finishWorkoutSession(userId, workoutLabel, date = getDayKey()) {
  const workoutPlan = (await buildHydratedUser(userId)).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = await getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  if (selected.status !== "em_andamento") {
    throw new Error("Esse treino nao esta liberado para finalizacao neste momento.");
  }

  await query(
    `
      UPDATE workout_status_entries
      SET status = $1, started_at = COALESCE(started_at, $2), completed_at = $3
      WHERE id = $4
    `,
    ["concluido", new Date().toISOString(), new Date().toISOString(), selected.id]
  );

  await normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
}

export async function restartWorkoutSession(userId, workoutLabel, workoutId, date = getDayKey()) {
  const workoutPlan = (await buildHydratedUser(userId)).workoutPlan;
  const weekKey = getWeekKey(date);
  const statuses = await getWorkoutStatuses(userId, workoutPlan, weekKey);
  const selected = statuses.find((item) => item.workoutLabel === workoutLabel);

  if (!selected) {
    throw new Error("Treino nao encontrado para a semana atual.");
  }

  await clearWorkoutCompletions(userId, workoutId, date);

  await query(
    `
      UPDATE workout_status_entries
      SET status = $1, started_at = NULL, completed_at = NULL
      WHERE user_id = $2 AND week_key = $3 AND workout_order >= $4
    `,
    ["pendente", userId, weekKey, selected.workoutOrder]
  );

  await normalizeWeeklyWorkoutStatuses(userId, workoutPlan, weekKey);
}

export async function listUsers() {
  const exercises = await listExercises();
  const result = await query(`
    SELECT *
    FROM users
    ORDER BY created_at DESC
  `);

  return result.rows.map((row) => sanitizeUserProfile(hydrateUser(mapUserRow(row), exercises)));
}

export async function upsertWeightEntry(userId, weightKg, date) {
  await query(
    `
      INSERT INTO weight_entries (id, user_id, date, weight_kg)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, date)
      DO UPDATE SET weight_kg = EXCLUDED.weight_kg
    `,
    [generateId("weight"), userId, date, weightKg]
  );

  await query(`UPDATE users SET weight_kg = $1, updated_at = $2 WHERE id = $3`, [
    weightKg,
    new Date().toISOString(),
    userId,
  ]);
}

export async function listWeightEntries(userId) {
  const result = await query(`SELECT * FROM weight_entries WHERE user_id = $1 ORDER BY date ASC`, [
    userId,
  ]);

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    date: row.date,
    weightKg: Number(row.weight_kg),
  }));
}

export async function updateCompletion(
  userId,
  date,
  workoutId,
  exerciseId,
  calories,
  completedSetIds
) {
  if (!Array.isArray(completedSetIds) || !completedSetIds.length) {
    await query(
      `
        DELETE FROM completion_entries
        WHERE user_id = $1 AND date = $2 AND workout_id = $3 AND exercise_id = $4
      `,
      [userId, date, workoutId, exerciseId]
    );
    return;
  }

  await query(
    `
      INSERT INTO completion_entries (
        id, user_id, date, workout_id, exercise_id, calories, completed_sets
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, date, workout_id, exercise_id)
      DO UPDATE SET
        calories = EXCLUDED.calories,
        completed_sets = EXCLUDED.completed_sets
    `,
    [
      generateId("done"),
      userId,
      date,
      workoutId,
      exerciseId,
      calories,
      JSON.stringify(completedSetIds),
    ]
  );
}

export async function listCompletionEntries(userId) {
  const userRow = await findUserRowById(userId);
  const exercises = await listExercises();
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
  const plan = userRow.customWorkoutPlan ? safeParseJson(userRow.customWorkoutPlan, []) : [];
  const normalizedPlan = normalizeWorkoutPlan(plan, userContext, exercises);
  const result = await query(
    `SELECT * FROM completion_entries WHERE user_id = $1 ORDER BY date ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    date: row.date,
    workoutId: row.workout_id,
    exerciseId: row.exercise_id,
    calories: Number(row.calories),
    completedSetIds: row.completed_sets
      ? safeParseJson(row.completed_sets, [])
      : Number(row.calories) > 0
        ? normalizedPlan
            .find((workout) => workout.id === row.workout_id)
            ?.exercises.find((slot) => slot.exerciseId === row.exercise_id)
            ?.sets.map((set) => set.id) ?? []
        : [],
  }));
}

export async function updateUserConsents(userId, payload) {
  const timestamp = new Date().toISOString();

  await query(
    `
      UPDATE users
      SET
        privacy_policy_version = $1,
        privacy_policy_accepted_at = $2,
        sensitive_consent_version = $3,
        sensitive_consent_accepted_at = $4,
        updated_at = $5
      WHERE id = $6
    `,
    [
      PRIVACY_POLICY_VERSION,
      payload.acceptedPrivacyPolicy ? timestamp : null,
      SENSITIVE_CONSENT_VERSION,
      payload.acceptedSensitiveDataConsent ? timestamp : null,
      timestamp,
      userId,
    ]
  );

  return getUserBundle(userId);
}

export async function exportUserData(userId) {
  const bundle = await getUserBundle(userId);
  const result = await query(
    `
      SELECT *
      FROM audit_logs
      WHERE target_id = $1 OR actor_id = $2
      ORDER BY created_at DESC
    `,
    [userId, userId]
  );

  const auditLogs = result.rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id ?? null,
    metadata: row.metadata_json ? safeParseJson(row.metadata_json, null) : null,
    createdAt: toIso(row.created_at),
  }));

  return {
    exportedAt: new Date().toISOString(),
    policyVersion: PRIVACY_POLICY_VERSION,
    user: bundle.user,
    exercises: bundle.exercises,
    weightEntries: bundle.weightEntries,
    completionEntries: bundle.completionEntries,
    workoutStatuses: bundle.workoutStatuses,
    auditLogs,
  };
}

export async function deleteUserAccount(userId) {
  await transaction(async (client) => {
    await execute(client, `DELETE FROM completion_entries WHERE user_id = $1`, [userId]);
    await execute(client, `DELETE FROM weight_entries WHERE user_id = $1`, [userId]);
    await execute(client, `DELETE FROM workout_status_entries WHERE user_id = $1`, [userId]);
    await execute(client, `DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await execute(client, `DELETE FROM users WHERE id = $1`, [userId]);
  });
}

export async function getUserBundle(userId) {
  const userRow = await findUserRowById(userId);
  const exercises = await listExercises();
  const user = sanitizeUserProfile(hydrateUser(userRow, exercises));

  return {
    user,
    exercises,
    weightEntries: await listWeightEntries(userId),
    completionEntries: await listCompletionEntries(userId),
    workoutStatuses: await getWorkoutStatuses(userId, user.workoutPlan),
  };
}

await initializeDatabase();
await insertMissingSeeds(seedExercises);
await syncSeedMetadata(seedExercises);
await migrateLegacyPasswords();
await ensureDefaultInstructor();
await migrateInstructorAccessMetadata();
await migrateLegacyWorkoutPlans();
