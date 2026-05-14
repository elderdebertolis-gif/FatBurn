import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const PASSWORD_SCHEME = "pbkdf2-sha512";
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_DIGEST = "sha512";

export const PRIVACY_POLICY_VERSION = "2026.05";
export const SENSITIVE_CONSENT_VERSION = "2026.05";
export const PORTAL_ROLES = ["admin", "instrutor", "visualizador"];
export const PORTAL_PERMISSIONS = [
  "students.read",
  "students.write",
  "workouts.write",
  "exercises.read",
  "exercises.write",
  "portal_users.read",
  "portal_users.write",
];

export const ROLE_PERMISSION_PRESETS = {
  admin: [...PORTAL_PERMISSIONS],
  instrutor: [
    "students.read",
    "students.write",
    "workouts.write",
    "exercises.read",
    "exercises.write",
  ],
  visualizador: ["students.read", "exercises.read"],
};

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST
  ).toString("base64url");

  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${salt}$${derived}`;
}

export function needsPasswordMigration(storedPassword = "") {
  return !String(storedPassword).startsWith(`${PASSWORD_SCHEME}$`);
}

export function verifyPassword(password, storedPassword = "") {
  if (!storedPassword) {
    return false;
  }

  if (needsPasswordMigration(storedPassword)) {
    return safeEquals(String(password ?? ""), String(storedPassword));
  }

  const [scheme, iterationText, salt, expectedHash] = storedPassword.split("$");
  if (scheme !== PASSWORD_SCHEME || !iterationText || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const derived = pbkdf2Sync(
    password,
    salt,
    iterations,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST
  ).toString("base64url");

  return safeEquals(derived, expectedHash);
}

export function issueSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function buildConsentSnapshot(user) {
  return {
    privacyPolicyVersion: user.privacyPolicyVersion ?? PRIVACY_POLICY_VERSION,
    privacyAcceptedAt: user.privacyAcceptedAt ?? null,
    sensitiveConsentVersion: user.sensitiveConsentVersion ?? SENSITIVE_CONSENT_VERSION,
    sensitiveConsentAcceptedAt: user.sensitiveConsentAcceptedAt ?? null,
    accepted:
      Boolean(user.privacyAcceptedAt) && Boolean(user.sensitiveConsentAcceptedAt),
  };
}

export function sanitizeUserProfile(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    age: user.age,
    sex: user.sex,
    heightCm: user.heightCm,
    weightKg: user.weightKg,
    targetWeightKg: user.targetWeightKg,
    objective: user.objective,
    trainingEnvironment: user.trainingEnvironment,
    trainingDaysPerWeek: user.trainingDaysPerWeek,
    level: user.level,
    restrictions: user.restrictions ?? "",
    bmi: user.bmi,
    bmiClass: user.bmiClass,
    workoutPlan: user.workoutPlan,
    createdAt: user.createdAt,
    consents: buildConsentSnapshot(user),
  };
}

export function normalizePortalRole(role) {
  return PORTAL_ROLES.includes(role) ? role : "instrutor";
}

export function normalizePortalPermissions(permissions = [], role = "instrutor") {
  if (role === "admin") {
    return [...PORTAL_PERMISSIONS];
  }

  const values = Array.isArray(permissions) ? permissions : [];
  const normalized = values.filter((permission) => PORTAL_PERMISSIONS.includes(permission));
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...(ROLE_PERMISSION_PRESETS[role] ?? ROLE_PERMISSION_PRESETS.instrutor)];
}

export function getInstructorPermissions(instructor) {
  if (!instructor) {
    return [];
  }

  return normalizePortalPermissions(instructor.permissions ?? [], normalizePortalRole(instructor.role));
}

export function hasInstructorPermission(instructor, permission) {
  if (!instructor?.isActive) {
    return false;
  }

  return getInstructorPermissions(instructor).includes(permission);
}

export function sanitizeInstructor(instructor) {
  return {
    id: instructor.id,
    name: instructor.name,
    email: instructor.email,
    role: normalizePortalRole(instructor.role),
    permissions: getInstructorPermissions(instructor),
    isActive: Boolean(instructor.isActive),
    createdAt: instructor.createdAt,
    updatedAt: instructor.updatedAt,
  };
}
