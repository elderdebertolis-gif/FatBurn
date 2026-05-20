import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec, renderSwaggerUiHtml } from "./openapi.js";
import {
  clearLoginAttemptState,
  createExercise,
  createInstructor,
  createPasswordResetCode,
  createSession,
  consumePasswordResetCode,
  deleteUserAccount,
  exportUserData,
  finishWorkoutSession,
  findExerciseById,
  findInstructorRowByEmail,
  findInstructorRowById,
  getLoginAttemptState,
  findSessionByToken,
  findUserRowByEmail,
  findUserRowById,
  getUserBundle,
  logAuditEvent,
  listUsers,
  listInstructors,
  listExercises,
  recalculateWorkoutPlan,
  registerFailedLoginAttempt,
  registerUser,
  revokeSession,
  revokeSessionsForUser,
  restartWorkoutSession,
  replaceWorkoutExercise,
  startWorkoutSession,
  updateCompletion,
  updateUserPassword,
  updateUserConsents,
  updateExercise,
  updateInstructor,
  updateWorkoutSet,
  updateUser,
  upsertWeightEntry,
} from "./db.js";
import {
  PORTAL_PERMISSIONS,
  PASSWORD_RESET_CODE_TTL_MINUTES,
  PRIVACY_POLICY_VERSION,
  SENSITIVE_CONSENT_VERSION,
  buildConsentSnapshot,
  generatePasswordResetCode,
  hasInstructorPermission,
  issueSessionToken,
  sanitizeInstructor,
  verifyPassword,
} from "./security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const portalDir = normalize(join(__dirname, "..", "portal"));
const brandingDir = normalize(join(__dirname, "..", "mobile", "assets", "branding"));
const port = Number(process.env.PORT) || 3030;
const host = "0.0.0.0";
const USER_SESSION_TTL_HOURS = 24 * 14;
const INSTRUCTOR_SESSION_TTL_HOURS = 12;
const RESEND_API_URL = "https://api.resend.com/emails";
const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;
const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT_BLOCK_MINUTES = 15;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
};

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...buildCorsHeaders(),
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...buildCorsHeaders(),
  });
  response.end(text);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...buildCorsHeaders(),
  });
  response.end(html);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function getRequestIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const rawIp =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim() ||
    request.socket?.remoteAddress ||
    "unknown";

  return rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
}

function getRetryAfterSeconds(blockedUntil) {
  const blockedUntilMs = blockedUntil ? new Date(blockedUntil).getTime() : Number.NaN;
  if (!Number.isFinite(blockedUntilMs)) {
    return 0;
  }

  return Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 1000));
}

async function getActiveLoginBlock(scope, email, ipAddress) {
  const state = await getLoginAttemptState(scope, email, ipAddress);
  if (!state?.blockedUntil) {
    return null;
  }

  if (new Date(state.blockedUntil).getTime() <= Date.now()) {
    return null;
  }

  return state;
}

function sendLoginRateLimitResponse(response, blockedUntil) {
  const retryAfterSeconds = getRetryAfterSeconds(blockedUntil);
  sendJson(
    response,
    429,
    {
      error: "Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.",
      retryAfterSeconds,
    },
    { "Retry-After": String(retryAfterSeconds) }
  );
}

async function registerFailedLoginAndMaybeBlock(response, scope, email, ipAddress) {
  const state = await registerFailedLoginAttempt({
    scope,
    email,
    ipAddress,
    maxFailures: LOGIN_RATE_LIMIT_MAX_FAILURES,
    windowMinutes: LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    blockMinutes: LOGIN_RATE_LIMIT_BLOCK_MINUTES,
  });

  if (state?.blockedUntil && new Date(state.blockedUntil).getTime() > Date.now()) {
    sendLoginRateLimitResponse(response, state.blockedUntil);
    return true;
  }

  return false;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isPasswordResetEmailConfigured() {
  return Boolean(String(process.env.RESEND_API_KEY ?? "").trim() && String(process.env.EMAIL_FROM ?? "").trim());
}

async function sendPasswordResetEmail({ email, name, code, expiresInMinutes }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.EMAIL_FROM ?? "").trim();

  if (!apiKey || !from) {
    throw new Error("Recuperacao por email nao configurada no servidor.");
  }

  const displayName = escapeHtml(name?.trim() || "aluno");
  const safeCode = escapeHtml(code);
  const safeExpiry = escapeHtml(String(expiresInMinutes));
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "FatBurn | Codigo para redefinir senha",
      text: `Seu codigo do FatBurn e ${code}. Ele expira em ${expiresInMinutes} minutos.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1a1a1a;">
          <p>Ola, ${displayName}.</p>
          <p>Use o codigo abaixo para redefinir sua senha no FatBurn:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0; color: #ff6a00;">
            ${safeCode}
          </p>
          <p>Esse codigo expira em ${safeExpiry} minutos.</p>
          <p>Se voce nao pediu a redefinicao, ignore este email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Nao foi possivel enviar o email de recuperacao.${detail ? ` ${detail}` : ""}`
    );
  }
}

function validateRegisterPayload(payload) {
  const required = [
    "name",
    "email",
    "password",
    "age",
    "sex",
    "heightCm",
    "weightKg",
    "targetWeightKg",
    "objective",
    "trainingEnvironment",
    "trainingDaysPerWeek",
    "level",
  ];

  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return `Campo obrigatorio ausente: ${field}`;
    }
  }

  if (!payload.acceptedPrivacyPolicy || !payload.acceptedSensitiveDataConsent) {
    return "Aceite o aviso de privacidade e o tratamento de dados de saude para continuar.";
  }

  if ((payload.password ?? "").trim().length < 8) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }

  if (Number(payload.age) < 18) {
    return "O cadastro requer usuario com 18 anos ou mais.";
  }

  return null;
}

function validateUpdatePayload(payload) {
  const required = [
    "name",
    "email",
    "age",
    "sex",
    "heightCm",
    "weightKg",
    "targetWeightKg",
    "objective",
    "trainingEnvironment",
    "trainingDaysPerWeek",
    "level",
  ];

  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return `Campo obrigatorio ausente: ${field}`;
    }
  }

  if (payload.password && payload.password.trim().length > 0 && payload.password.trim().length < 8) {
    return "A nova senha deve ter pelo menos 8 caracteres.";
  }

  if (Number(payload.age) < 18) {
    return "O cadastro requer usuario com 18 anos ou mais.";
  }

  return null;
}

function validateExercisePayload(payload) {
  const required = [
    "name",
    "muscleGroup",
    "goal",
    "environment",
    "calories",
    "videoUrl",
    "description",
    "equipment",
  ];

  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return `Campo obrigatorio ausente: ${field}`;
    }
  }

  if (!Number.isFinite(Number(payload.calories)) || Number(payload.calories) <= 0) {
    return "Informe uma estimativa de calorias valida.";
  }

  return null;
}

function validatePortalUserPayload(payload, options = { requirePassword: true }) {
  const required = ["name", "email", "role"];

  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      return `Campo obrigatorio ausente: ${field}`;
    }
  }

  if (options.requirePassword && (!payload.password || payload.password.trim().length < 8)) {
    return "A senha do usuario do portal deve ter pelo menos 8 caracteres.";
  }

  if (!options.requirePassword && payload.password && payload.password.trim().length > 0 && payload.password.trim().length < 8) {
    return "A nova senha do usuario do portal deve ter pelo menos 8 caracteres.";
  }

  return null;
}

function extractYouTubeVideoId(videoUrl = "") {
  try {
    const url = new URL(videoUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      return (
        url.searchParams.get("v") ??
        (pathParts[0] === "embed" ? pathParts[1] : null) ??
        (pathParts[0] === "shorts" ? pathParts[1] : null)
      );
    }
  } catch {
    return null;
  }

  return null;
}

function getRequestToken(request) {
  const header = request.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}

async function getAuthContext(request) {
  const token = getRequestToken(request);
  if (!token) {
    return null;
  }

  const session = await findSessionByToken(token);
  if (!session) {
    return null;
  }

  const user = session.userId ? await findUserRowById(session.userId) : null;
  const instructor = session.instructorId ? await findInstructorRowById(session.instructorId) : null;
  return {
    token,
    session,
    user,
    instructor,
  };
}

function requireAuthenticated(response, authContext) {
  if (!authContext) {
    sendJson(response, 401, { error: "Sessao invalida ou expirada." });
    return false;
  }
  return true;
}

function requireInstructor(response, authContext) {
  if (!requireAuthenticated(response, authContext)) {
    return false;
  }

  if (authContext.session.role !== "instructor" || !authContext.instructor?.isActive) {
    sendJson(response, 403, { error: "Acesso restrito ao portal do instrutor." });
    return false;
  }

  return true;
}

function requirePortalPermission(response, authContext, permission) {
  if (!requireInstructor(response, authContext)) {
    return false;
  }

  if (!hasInstructorPermission(authContext.instructor, permission)) {
    sendJson(response, 403, { error: "Voce nao tem permissao para executar essa acao no portal." });
    return false;
  }

  return true;
}

function requireUserScope(response, authContext, userId) {
  if (!requireAuthenticated(response, authContext)) {
    return false;
  }

  if (authContext.session.role === "instructor") {
    return true;
  }

  if (authContext.session.userId !== userId) {
    sendJson(response, 403, { error: "Voce nao pode acessar dados de outro usuario." });
    return false;
  }

  return true;
}

async function requireActiveConsent(response, authContext, userId) {
  const sourceUser =
    authContext?.session.role === "user" && authContext.user?.id === userId
      ? authContext.user
      : await findUserRowById(userId);

  if (!sourceUser) {
    sendJson(response, 404, { error: "Usuario nao encontrado." });
    return false;
  }

  if (!buildConsentSnapshot(sourceUser).accepted) {
    sendJson(response, 403, {
      error: "Aceite o aviso de privacidade e o tratamento de dados sensiveis antes de continuar.",
      code: "CONSENT_REQUIRED",
      policyVersion: PRIVACY_POLICY_VERSION,
    });
    return false;
  }

  return true;
}

function renderVideoEmbedPage(videoUrl, pageOrigin) {
  const safeVideoUrl = String(videoUrl ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const youtubeId = extractYouTubeVideoId(videoUrl);

  if (youtubeId) {
    const embedUrl = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0&controls=1&fs=1&enablejsapi=1&origin=${encodeURIComponent(
      pageOrigin
    )}&widget_referrer=${encodeURIComponent(pageOrigin)}`;

    return `
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <style>
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: #000;
            }

            iframe {
              border: 0;
              width: 100%;
              height: 100%;
              display: block;
              background: #000;
            }
          </style>
        </head>
        <body>
          <iframe
            src="${embedUrl}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="origin"
            title="Video do exercicio"
          ></iframe>
        </body>
      </html>
    `;
  }

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #000;
          }

          video {
            width: 100%;
            height: 100%;
            display: block;
            background: #000;
          }
        </style>
      </head>
      <body>
        <video src="${safeVideoUrl}" controls autoplay playsinline></video>
      </body>
    </html>
  `;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (pathname === "/api/docs/openapi.json" && request.method === "GET") {
      const origin = `${url.protocol}//${url.host}`;
      sendJson(response, 200, buildOpenApiSpec(origin));
      return;
    }

    if ((pathname === "/api/docs" || pathname === "/api/docs/") && request.method === "GET") {
      sendHtml(response, 200, renderSwaggerUiHtml("/api/docs/openapi.json"));
      return;
    }

    if (pathname === "/embed/video" && request.method === "GET") {
      const videoUrl = url.searchParams.get("videoUrl") ?? "";
      const pageOrigin = `${url.protocol}//${url.host}`;
      sendHtml(response, 200, renderVideoEmbedPage(videoUrl, pageOrigin));
      return;
    }

    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        db: "postgres",
        seededExercises: (await listExercises()).length,
      });
      return;
    }

    if (pathname.startsWith("/branding/") && request.method === "GET") {
      const assetPath = normalize(join(brandingDir, pathname.replace("/branding/", "")));

      if (!assetPath.startsWith(brandingDir)) {
        sendText(response, 403, "Acesso negado");
        return;
      }

      const file = await readFile(assetPath);
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(assetPath)] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300",
      });
      response.end(file);
      return;
    }

    if (pathname === "/api/exercises" && request.method === "GET") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "exercises.read")) {
        return;
      }

      sendJson(response, 200, { exercises: await listExercises() });
      return;
    }

    if (pathname === "/api/exercises" && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "exercises.write")) {
        return;
      }

      const payload = await readBody(request);
      const validationError = validateExercisePayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const exercise = await createExercise({
        name: payload.name?.trim(),
        muscleGroup: payload.muscleGroup,
        goal: payload.goal,
        environment: payload.environment,
        calories: Number(payload.calories),
        videoUrl: payload.videoUrl?.trim(),
        description: payload.description?.trim(),
        equipment: payload.equipment?.trim(),
      });

      await logAuditEvent({
        actorType: "instructor",
        actorId: authContext.session.instructorId,
        action: "exercise.create",
        targetType: "exercise",
        targetId: exercise.id,
      });
      sendJson(response, 201, { exercise });
      return;
    }

    const exerciseMatch = pathname.match(/^\/api\/exercises\/([^/]+)$/);
    if (exerciseMatch && request.method === "PUT") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "exercises.write")) {
        return;
      }

      const payload = await readBody(request);
      const validationError = validateExercisePayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const currentExercise = await findExerciseById(exerciseMatch[1]);
      if (!currentExercise) {
        sendJson(response, 404, { error: "Exercicio nao encontrado." });
        return;
      }

      const exercise = await updateExercise(exerciseMatch[1], {
        name: payload.name?.trim(),
        muscleGroup: payload.muscleGroup,
        goal: payload.goal,
        environment: payload.environment,
        calories: Number(payload.calories),
        videoUrl: payload.videoUrl?.trim(),
        description: payload.description?.trim(),
        equipment: payload.equipment?.trim(),
      });

      await logAuditEvent({
        actorType: "instructor",
        actorId: authContext.session.instructorId,
        action: "exercise.update",
        targetType: "exercise",
        targetId: exercise.id,
      });
      sendJson(response, 200, { exercise });
      return;
    }

    if (pathname === "/api/auth/login" && request.method === "POST") {
      const payload = await readBody(request);
      const email = normalizeEmail(payload.email);
      const password = (payload.password ?? "").trim();
      const ipAddress = getRequestIp(request);
      const blockedAttempt = await getActiveLoginBlock("user", email, ipAddress);

      if (blockedAttempt) {
        sendLoginRateLimitResponse(response, blockedAttempt.blockedUntil);
        return;
      }

      const user = await findUserRowByEmail(email);

      if (!user) {
        if (await registerFailedLoginAndMaybeBlock(response, "user", email, ipAddress)) {
          return;
        }
        sendJson(response, 404, { error: "Usuario nao encontrado." });
        return;
      }

      if (!verifyPassword(password, user.passwordHash)) {
        if (await registerFailedLoginAndMaybeBlock(response, "user", email, ipAddress)) {
          return;
        }
        sendJson(response, 401, { error: "Senha invalida." });
        return;
      }

      await clearLoginAttemptState("user", email, ipAddress);

      const token = issueSessionToken();
      const session = await createSession({
        token,
        role: "user",
        userId: user.id,
        ttlHours: USER_SESSION_TTL_HOURS,
      });
      await logAuditEvent({
        actorType: "user",
        actorId: user.id,
        action: "auth.login",
        targetType: "session",
        targetId: session.id,
      });
      sendJson(response, 200, {
        token,
        role: "user",
        policyVersion: PRIVACY_POLICY_VERSION,
        sensitiveConsentVersion: SENSITIVE_CONSENT_VERSION,
        bundle: await getUserBundle(user.id),
      });
      return;
    }

    if (pathname === "/api/auth/instructor/login" && request.method === "POST") {
      const payload = await readBody(request);
      const email = normalizeEmail(payload.email);
      const password = (payload.password ?? "").trim();
      const ipAddress = getRequestIp(request);
      const blockedAttempt = await getActiveLoginBlock("instructor", email, ipAddress);

      if (blockedAttempt) {
        sendLoginRateLimitResponse(response, blockedAttempt.blockedUntil);
        return;
      }

      const instructor = await findInstructorRowByEmail(email);

      if (!instructor) {
        if (await registerFailedLoginAndMaybeBlock(response, "instructor", email, ipAddress)) {
          return;
        }
        sendJson(response, 404, { error: "Instrutor nao encontrado." });
        return;
      }

      if (!instructor.isActive) {
        if (await registerFailedLoginAndMaybeBlock(response, "instructor", email, ipAddress)) {
          return;
        }
        sendJson(response, 403, { error: "Esse acesso do portal esta inativo." });
        return;
      }

      if (!verifyPassword(password, instructor.passwordHash)) {
        if (await registerFailedLoginAndMaybeBlock(response, "instructor", email, ipAddress)) {
          return;
        }
        sendJson(response, 401, { error: "Senha invalida." });
        return;
      }

      await clearLoginAttemptState("instructor", email, ipAddress);

      const token = issueSessionToken();
      const session = await createSession({
        token,
        role: "instructor",
        instructorId: instructor.id,
        ttlHours: INSTRUCTOR_SESSION_TTL_HOURS,
      });
      await logAuditEvent({
        actorType: "instructor",
        actorId: instructor.id,
        action: "auth.login",
        targetType: "session",
        targetId: session.id,
      });
      sendJson(response, 200, {
        token,
        role: "instructor",
        permissions: PORTAL_PERMISSIONS,
        instructor: sanitizeInstructor(instructor),
      });
      return;
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireAuthenticated(response, authContext)) {
        return;
      }

      await revokeSession(authContext.token);
      await logAuditEvent({
        actorType: authContext.session.role,
        actorId: authContext.session.userId ?? authContext.session.instructorId,
        action: "auth.logout",
        targetType: "session",
        targetId: authContext.session.id,
      });
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/api/auth/register" && request.method === "POST") {
      const payload = await readBody(request);
      const validationError = validateRegisterPayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const email = normalizeEmail(payload.email);
      if (await findUserRowByEmail(email)) {
        sendJson(response, 409, { error: "Ja existe um usuario com esse email." });
        return;
      }

      const bundle = await registerUser({
        ...payload,
        email,
        age: Number(payload.age),
        heightCm: Number(payload.heightCm),
        weightKg: Number(payload.weightKg),
        targetWeightKg: Number(payload.targetWeightKg),
        trainingDaysPerWeek: Number(payload.trainingDaysPerWeek),
      });
      const token = issueSessionToken();
      const session = await createSession({
        token,
        role: "user",
        userId: bundle.user.id,
        ttlHours: USER_SESSION_TTL_HOURS,
      });
      await logAuditEvent({
        actorType: "user",
        actorId: bundle.user.id,
        action: "auth.register",
        targetType: "session",
        targetId: session.id,
      });
      sendJson(response, 201, {
        token,
        role: "user",
        policyVersion: PRIVACY_POLICY_VERSION,
        sensitiveConsentVersion: SENSITIVE_CONSENT_VERSION,
        bundle,
      });
      return;
    }

    if (pathname === "/api/auth/forgot-password" && request.method === "POST") {
      const payload = await readBody(request);
      const email = normalizeEmail(payload.email);

      if (!email || !email.includes("@")) {
        sendJson(response, 400, { error: "Informe um email valido." });
        return;
      }

      if (!isPasswordResetEmailConfigured()) {
        sendJson(response, 503, {
          error:
            "Recuperacao por email ainda nao configurada no servidor. Defina RESEND_API_KEY e EMAIL_FROM.",
        });
        return;
      }

      const user = await findUserRowByEmail(email);
      const successMessage =
        "Se o email estiver cadastrado, enviamos um codigo para redefinir a senha.";

      if (!user) {
        sendJson(response, 200, {
          ok: true,
          message: successMessage,
          expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
        });
        return;
      }

      const code = generatePasswordResetCode();
      const expiresAt = new Date(
        Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60 * 1000
      ).toISOString();

      await createPasswordResetCode(user.id, email, code, expiresAt);
      await sendPasswordResetEmail({
        email,
        name: user.name,
        code,
        expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
      });
      await logAuditEvent({
        actorType: "system",
        actorId: user.id,
        action: "auth.password_reset.requested",
        targetType: "user",
        targetId: user.id,
      });
      sendJson(response, 200, {
        ok: true,
        message: successMessage,
        expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
      });
      return;
    }

    if (pathname === "/api/auth/reset-password" && request.method === "POST") {
      const payload = await readBody(request);
      const email = normalizeEmail(payload.email);
      const code = String(payload.code ?? "").trim();
      const password = String(payload.password ?? "").trim();

      if (!email || !email.includes("@")) {
        sendJson(response, 400, { error: "Informe um email valido." });
        return;
      }

      if (!/^\d{6}$/.test(code)) {
        sendJson(response, 400, { error: "Informe o codigo de 6 digitos enviado por email." });
        return;
      }

      if (password.length < 8) {
        sendJson(response, 400, { error: "A nova senha deve ter pelo menos 8 caracteres." });
        return;
      }

      const passwordReset = await consumePasswordResetCode(email, code);
      if (!passwordReset) {
        sendJson(response, 400, { error: "Codigo invalido ou expirado." });
        return;
      }

      await updateUserPassword(passwordReset.userId, password);
      await revokeSessionsForUser(passwordReset.userId);
      await logAuditEvent({
        actorType: "system",
        actorId: passwordReset.userId,
        action: "auth.password_reset.completed",
        targetType: "user",
        targetId: passwordReset.userId,
      });
      sendJson(response, 200, {
        ok: true,
        message: "Senha redefinida com sucesso. Entre com a nova senha.",
      });
      return;
    }

    if (pathname === "/api/users" && request.method === "GET") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "students.read")) {
        return;
      }

      sendJson(response, 200, { users: await listUsers() });
      return;
    }

    if (pathname === "/api/portal-users" && request.method === "GET") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "portal_users.read")) {
        return;
      }

      sendJson(response, 200, { portalUsers: await listInstructors() });
      return;
    }

    if (pathname === "/api/portal-users" && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "portal_users.write")) {
        return;
      }

      const payload = await readBody(request);
      const validationError = validatePortalUserPayload(payload, { requirePassword: true });
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const email = normalizeEmail(payload.email);
      if (await findInstructorRowByEmail(email)) {
        sendJson(response, 409, { error: "Ja existe um usuario do portal com esse email." });
        return;
      }

      const portalUser = await createInstructor({
        name: payload.name?.trim(),
        email,
        password: payload.password?.trim(),
        role: payload.role,
        permissions: payload.permissions,
        isActive: payload.isActive !== false,
      });

      await logAuditEvent({
        actorType: "instructor",
        actorId: authContext.session.instructorId,
        action: "portal_user.create",
        targetType: "instructor",
        targetId: portalUser.id,
      });
      sendJson(response, 201, { portalUser });
      return;
    }

    const portalUserMatch = pathname.match(/^\/api\/portal-users\/([^/]+)$/);
    if (portalUserMatch && request.method === "PUT") {
      const authContext = await getAuthContext(request);
      if (!requirePortalPermission(response, authContext, "portal_users.write")) {
        return;
      }

      const targetId = portalUserMatch[1];
      const existingPortalUser = await findInstructorRowById(targetId);
      if (!existingPortalUser) {
        sendJson(response, 404, { error: "Usuario do portal nao encontrado." });
        return;
      }

      const payload = await readBody(request);
      const validationError = validatePortalUserPayload(payload, { requirePassword: false });
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const email = normalizeEmail(payload.email);
      const duplicate = await findInstructorRowByEmail(email);
      if (duplicate && duplicate.id !== targetId) {
        sendJson(response, 409, { error: "Ja existe um usuario do portal com esse email." });
        return;
      }

      if (authContext.instructor?.id === targetId) {
        if (payload.role && payload.role !== existingPortalUser.role) {
          sendJson(response, 400, {
            error: "Nao altere o proprio perfil por essa tela. Use outro administrador.",
          });
          return;
        }

        if (payload.isActive === false) {
          sendJson(response, 400, {
            error: "Voce nao pode inativar o proprio acesso por essa tela.",
          });
          return;
        }
      }

      const portalUser = await updateInstructor(targetId, {
        name: payload.name?.trim(),
        email,
        password: payload.password?.trim(),
        role: payload.role,
        permissions: payload.permissions,
        isActive: payload.isActive !== false,
      });

      await logAuditEvent({
        actorType: "instructor",
        actorId: authContext.session.instructorId,
        action: "portal_user.update",
        targetType: "instructor",
        targetId: portalUser.id,
      });
      sendJson(response, 200, { portalUser });
      return;
    }

    if (pathname === "/api/privacy/consent" && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireAuthenticated(response, authContext) || authContext.session.role !== "user") {
        if (authContext?.session.role && authContext.session.role !== "user") {
          sendJson(response, 403, { error: "Somente o aluno pode atualizar os proprios consentimentos." });
        }
        return;
      }

      const payload = await readBody(request);
      if (!payload.acceptedPrivacyPolicy || !payload.acceptedSensitiveDataConsent) {
        sendJson(response, 400, {
          error: "Os dois consentimentos sao obrigatorios para utilizar a plataforma.",
        });
        return;
      }

      const bundle = await updateUserConsents(authContext.session.userId, payload);
      await logAuditEvent({
        actorType: "user",
        actorId: authContext.session.userId,
        action: "privacy.consent.accepted",
        targetType: "user",
        targetId: authContext.session.userId,
      });
      sendJson(response, 200, {
        policyVersion: PRIVACY_POLICY_VERSION,
        sensitiveConsentVersion: SENSITIVE_CONSENT_VERSION,
        bundle,
      });
      return;
    }

    if (pathname === "/api/privacy/export" && request.method === "GET") {
      const authContext = await getAuthContext(request);
      if (!requireAuthenticated(response, authContext) || authContext.session.role !== "user") {
        if (authContext?.session.role && authContext.session.role !== "user") {
          sendJson(response, 403, { error: "Somente o aluno pode exportar os proprios dados." });
        }
        return;
      }

      await logAuditEvent({
        actorType: "user",
        actorId: authContext.session.userId,
        action: "privacy.export",
        targetType: "user",
        targetId: authContext.session.userId,
      });
      sendJson(response, 200, await exportUserData(authContext.session.userId));
      return;
    }

    if (pathname === "/api/account" && request.method === "DELETE") {
      const authContext = await getAuthContext(request);
      if (!requireAuthenticated(response, authContext) || authContext.session.role !== "user") {
        if (authContext?.session.role && authContext.session.role !== "user") {
          sendJson(response, 403, { error: "Somente o aluno pode excluir a propria conta." });
        }
        return;
      }

      await logAuditEvent({
        actorType: "user",
        actorId: authContext.session.userId,
        action: "privacy.delete_account",
        targetType: "user",
        targetId: authContext.session.userId,
      });
      await deleteUserAccount(authContext.session.userId);
      await revokeSession(authContext.token);
      sendJson(response, 200, { ok: true });
      return;
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && request.method === "GET") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, userMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "students.read")) {
        return;
      }

      sendJson(response, 200, await getUserBundle(userMatch[1]));
      return;
    }

    if (userMatch && request.method === "PUT") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, userMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "students.write")) {
        return;
      }

      if (!(await requireActiveConsent(response, authContext, userMatch[1]))) {
        return;
      }

      const userId = userMatch[1];
      const payload = await readBody(request);
      const validationError = validateUpdatePayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const existing = await findUserRowByEmail(normalizeEmail(payload.email));
      if (existing && existing.id !== userId) {
        sendJson(response, 409, { error: "Ja existe um usuario com esse email." });
        return;
      }

      const bundle = await updateUser(userId, {
        ...payload,
        email: normalizeEmail(payload.email),
        age: Number(payload.age),
        heightCm: Number(payload.heightCm),
        weightKg: Number(payload.weightKg),
        targetWeightKg: Number(payload.targetWeightKg),
        trainingDaysPerWeek: Number(payload.trainingDaysPerWeek),
      });

      await logAuditEvent({
        actorType: authContext.session.role,
        actorId: authContext.session.userId ?? authContext.session.instructorId,
        action: authContext.session.role === "instructor" ? "user.update_by_instructor" : "user.update_profile",
        targetType: "user",
        targetId: userId,
      });
      sendJson(response, 200, bundle);
      return;
    }

    const recalcMatch = pathname.match(/^\/api\/users\/([^/]+)\/recalculate$/);
    if (recalcMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, recalcMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, recalcMatch[1]))) {
        return;
      }

      await recalculateWorkoutPlan(recalcMatch[1]);
      sendJson(response, 200, await getUserBundle(recalcMatch[1]));
      return;
    }

    const weightMatch = pathname.match(/^\/api\/users\/([^/]+)\/weights$/);
    if (weightMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, weightMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "students.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, weightMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await upsertWeightEntry(weightMatch[1], Number(payload.weightKg), payload.date);
      await recalculateWorkoutPlan(weightMatch[1]);
      sendJson(response, 200, await getUserBundle(weightMatch[1]));
      return;
    }

    const completionMatch = pathname.match(/^\/api\/users\/([^/]+)\/completions$/);
    if (completionMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, completionMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, completionMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      const exercise = await findExerciseById(payload.exerciseId);
      const userBundle = await getUserBundle(completionMatch[1]);
      const slot = userBundle.user.workoutPlan
        .find((workout) => workout.id === payload.workoutId)
        ?.exercises.find((item) => item.exerciseId === payload.exerciseId);
      const setIds = slot?.sets?.map((set) => set.id) ?? [];
      const completedSetIds = Array.isArray(payload.completedSetIds)
        ? payload.completedSetIds.filter((setId) => setIds.includes(setId))
        : [];
      await updateCompletion(
        completionMatch[1],
        payload.date,
        payload.workoutId,
        payload.exerciseId,
        completedSetIds.length === setIds.length
          ? exercise?.calories ?? Number(payload.calories ?? 0)
          : 0,
        completedSetIds
      );
      sendJson(response, 200, await getUserBundle(completionMatch[1]));
      return;
    }

    const updateSetMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/set$/);
    if (updateSetMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, updateSetMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, updateSetMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await updateWorkoutSet(updateSetMatch[1], payload.workoutId, payload.slotId, payload.setId, {
        repetitions: payload.repetitions,
        load: payload.load,
      });
      sendJson(response, 200, await getUserBundle(updateSetMatch[1]));
      return;
    }

    const replaceMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/replace$/);
    if (replaceMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, replaceMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, replaceMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await replaceWorkoutExercise(
        replaceMatch[1],
        payload.workoutId,
        payload.slotId,
        payload.nextExerciseId
      );
      sendJson(response, 200, await getUserBundle(replaceMatch[1]));
      return;
    }

    const startWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/start$/);
    if (startWorkoutMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, startWorkoutMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, startWorkoutMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await startWorkoutSession(startWorkoutMatch[1], payload.workoutLabel, payload.date);
      sendJson(response, 200, await getUserBundle(startWorkoutMatch[1]));
      return;
    }

    const finishWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/finish$/);
    if (finishWorkoutMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, finishWorkoutMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, finishWorkoutMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await finishWorkoutSession(finishWorkoutMatch[1], payload.workoutLabel, payload.date);
      sendJson(response, 200, await getUserBundle(finishWorkoutMatch[1]));
      return;
    }

    const restartWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/restart$/);
    if (restartWorkoutMatch && request.method === "POST") {
      const authContext = await getAuthContext(request);
      if (!requireUserScope(response, authContext, restartWorkoutMatch[1])) {
        return;
      }
      if (authContext?.session.role === "instructor" && !requirePortalPermission(response, authContext, "workouts.write")) {
        return;
      }
      if (!(await requireActiveConsent(response, authContext, restartWorkoutMatch[1]))) {
        return;
      }

      const payload = await readBody(request);
      await restartWorkoutSession(
        restartWorkoutMatch[1],
        payload.workoutLabel,
        payload.workoutId,
        payload.date
      );
      sendJson(response, 200, await getUserBundle(restartWorkoutMatch[1]));
      return;
    }

    const staticPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = normalize(join(portalDir, staticPath));

    if (!filePath.startsWith(portalDir)) {
      sendText(response, 403, "Acesso negado");
      return;
    }

    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "text/plain; charset=utf-8",
    });
    response.end(file);
  } catch (error) {
    sendJson(response, 500, {
      error: "Falha interna do servidor.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}).listen(port, host, () => {
  console.log(`FatBurn API disponivel em http://${host}:${port}`);
});
