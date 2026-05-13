import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExercise,
  finishWorkoutSession,
  findExerciseById,
  findUserRowByEmail,
  getUserBundle,
  listUsers,
  listExercises,
  recalculateWorkoutPlan,
  registerUser,
  restartWorkoutSession,
  replaceWorkoutExercise,
  startWorkoutSession,
  updateCompletion,
  updateExercise,
  updateWorkoutSet,
  updateUser,
  upsertWeightEntry,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const portalDir = normalize(join(__dirname, "..", "portal"));
const brandingDir = normalize(join(__dirname, "..", "mobile", "assets", "branding"));
const port = Number(process.env.PORT) || 3030;
const host = "0.0.0.0";

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(text);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

function validateUserPayload(payload) {
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
    if (pathname === "/embed/video" && request.method === "GET") {
      const videoUrl = url.searchParams.get("videoUrl") ?? "";
      const pageOrigin = `${url.protocol}//${url.host}`;
      sendHtml(response, 200, renderVideoEmbedPage(videoUrl, pageOrigin));
      return;
    }

    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { ok: true, db: "sqlite", seededExercises: listExercises().length });
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
      sendJson(response, 200, { exercises: listExercises() });
      return;
    }

    if (pathname === "/api/exercises" && request.method === "POST") {
      const payload = await readBody(request);
      const validationError = validateExercisePayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const exercise = createExercise({
        name: payload.name?.trim(),
        muscleGroup: payload.muscleGroup,
        goal: payload.goal,
        environment: payload.environment,
        calories: Number(payload.calories),
        videoUrl: payload.videoUrl?.trim(),
        description: payload.description?.trim(),
        equipment: payload.equipment?.trim(),
      });
      sendJson(response, 201, { exercise });
      return;
    }

    const exerciseMatch = pathname.match(/^\/api\/exercises\/([^/]+)$/);
    if (exerciseMatch && request.method === "PUT") {
      const payload = await readBody(request);
      const validationError = validateExercisePayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const currentExercise = findExerciseById(exerciseMatch[1]);
      if (!currentExercise) {
        sendJson(response, 404, { error: "Exercicio nao encontrado." });
        return;
      }

      const exercise = updateExercise(exerciseMatch[1], {
        name: payload.name?.trim(),
        muscleGroup: payload.muscleGroup,
        goal: payload.goal,
        environment: payload.environment,
        calories: Number(payload.calories),
        videoUrl: payload.videoUrl?.trim(),
        description: payload.description?.trim(),
        equipment: payload.equipment?.trim(),
      });
      sendJson(response, 200, { exercise });
      return;
    }

    if (pathname === "/api/auth/login" && request.method === "POST") {
      const payload = await readBody(request);
      const email = normalizeEmail(payload.email);
      const password = (payload.password ?? "").trim();
      const user = findUserRowByEmail(email);

      if (!user) {
        sendJson(response, 404, { error: "Usuario nao encontrado." });
        return;
      }

      if (user.password !== password) {
        sendJson(response, 401, { error: "Senha invalida." });
        return;
      }

      sendJson(response, 200, getUserBundle(user.id));
      return;
    }

    if (pathname === "/api/auth/register" && request.method === "POST") {
      const payload = await readBody(request);
      const validationError = validateUserPayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const email = normalizeEmail(payload.email);
      if (findUserRowByEmail(email)) {
        sendJson(response, 409, { error: "Ja existe um usuario com esse email." });
        return;
      }

      const bundle = registerUser({
        ...payload,
        email,
        age: Number(payload.age),
        heightCm: Number(payload.heightCm),
        weightKg: Number(payload.weightKg),
        targetWeightKg: Number(payload.targetWeightKg),
        trainingDaysPerWeek: Number(payload.trainingDaysPerWeek),
      });
      sendJson(response, 201, bundle);
      return;
    }

    if (pathname === "/api/users" && request.method === "GET") {
      sendJson(response, 200, { users: listUsers(), exercises: listExercises() });
      return;
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && request.method === "GET") {
      sendJson(response, 200, getUserBundle(userMatch[1]));
      return;
    }

    if (userMatch && request.method === "PUT") {
      const userId = userMatch[1];
      const payload = await readBody(request);
      const validationError = validateUserPayload(payload);

      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const existing = findUserRowByEmail(normalizeEmail(payload.email));
      if (existing && existing.id !== userId) {
        sendJson(response, 409, { error: "Ja existe um usuario com esse email." });
        return;
      }

      const bundle = updateUser(userId, {
        ...payload,
        email: normalizeEmail(payload.email),
        age: Number(payload.age),
        heightCm: Number(payload.heightCm),
        weightKg: Number(payload.weightKg),
        targetWeightKg: Number(payload.targetWeightKg),
        trainingDaysPerWeek: Number(payload.trainingDaysPerWeek),
      });
      sendJson(response, 200, bundle);
      return;
    }

    const recalcMatch = pathname.match(/^\/api\/users\/([^/]+)\/recalculate$/);
    if (recalcMatch && request.method === "POST") {
      recalculateWorkoutPlan(recalcMatch[1]);
      sendJson(response, 200, getUserBundle(recalcMatch[1]));
      return;
    }

    const weightMatch = pathname.match(/^\/api\/users\/([^/]+)\/weights$/);
    if (weightMatch && request.method === "POST") {
      const payload = await readBody(request);
      upsertWeightEntry(weightMatch[1], Number(payload.weightKg), payload.date);
      recalculateWorkoutPlan(weightMatch[1]);
      sendJson(response, 200, getUserBundle(weightMatch[1]));
      return;
    }

    const completionMatch = pathname.match(/^\/api\/users\/([^/]+)\/completions$/);
    if (completionMatch && request.method === "POST") {
      const payload = await readBody(request);
      const exercise = findExerciseById(payload.exerciseId);
      const userBundle = getUserBundle(completionMatch[1]);
      const slot = userBundle.user.workoutPlan
        .find((workout) => workout.id === payload.workoutId)
        ?.exercises.find((item) => item.exerciseId === payload.exerciseId);
      const setIds = slot?.sets?.map((set) => set.id) ?? [];
      const completedSetIds = Array.isArray(payload.completedSetIds)
        ? payload.completedSetIds.filter((setId) => setIds.includes(setId))
        : [];
      updateCompletion(
        completionMatch[1],
        payload.date,
        payload.workoutId,
        payload.exerciseId,
        completedSetIds.length === setIds.length
          ? exercise?.calories ?? Number(payload.calories ?? 0)
          : 0,
        completedSetIds
      );
      sendJson(response, 200, getUserBundle(completionMatch[1]));
      return;
    }

    const updateSetMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/set$/);
    if (updateSetMatch && request.method === "POST") {
      const payload = await readBody(request);
      updateWorkoutSet(updateSetMatch[1], payload.workoutId, payload.slotId, payload.setId, {
        repetitions: payload.repetitions,
        load: payload.load,
      });
      sendJson(response, 200, getUserBundle(updateSetMatch[1]));
      return;
    }

    const replaceMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/replace$/);
    if (replaceMatch && request.method === "POST") {
      const payload = await readBody(request);
      replaceWorkoutExercise(
        replaceMatch[1],
        payload.workoutId,
        payload.slotId,
        payload.nextExerciseId
      );
      sendJson(response, 200, getUserBundle(replaceMatch[1]));
      return;
    }

    const startWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/start$/);
    if (startWorkoutMatch && request.method === "POST") {
      const payload = await readBody(request);
      startWorkoutSession(startWorkoutMatch[1], payload.workoutLabel, payload.date);
      sendJson(response, 200, getUserBundle(startWorkoutMatch[1]));
      return;
    }

    const finishWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/finish$/);
    if (finishWorkoutMatch && request.method === "POST") {
      const payload = await readBody(request);
      finishWorkoutSession(finishWorkoutMatch[1], payload.workoutLabel, payload.date);
      sendJson(response, 200, getUserBundle(finishWorkoutMatch[1]));
      return;
    }

    const restartWorkoutMatch = pathname.match(/^\/api\/users\/([^/]+)\/workouts\/restart$/);
    if (restartWorkoutMatch && request.method === "POST") {
      const payload = await readBody(request);
      restartWorkoutSession(
        restartWorkoutMatch[1],
        payload.workoutLabel,
        payload.workoutId,
        payload.date
      );
      sendJson(response, 200, getUserBundle(restartWorkoutMatch[1]));
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
