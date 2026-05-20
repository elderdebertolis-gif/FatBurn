const json = (schema) => ({
  "application/json": { schema },
});

const ErrorResponse = {
  type: "object",
  properties: {
    error: { type: "string" },
    detail: { type: "string" },
    code: { type: "string" },
    policyVersion: { type: "string" },
  },
  required: ["error"],
};

const LoginRequest = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", format: "password" },
  },
  required: ["email", "password"],
};

const RegisterRequest = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    age: { type: "integer" },
    sex: { type: "string" },
    heightCm: { type: "number" },
    weightKg: { type: "number" },
    targetWeightKg: { type: "number" },
    objective: { type: "string", enum: ["perda_de_peso", "definicao"] },
    trainingEnvironment: { type: "string", enum: ["casa", "academia"] },
    trainingDaysPerWeek: { type: "integer", minimum: 2, maximum: 6 },
    level: { type: "string", enum: ["iniciante", "intermediario", "avancado"] },
    restrictions: { type: "string" },
    acceptedPrivacyPolicy: { type: "boolean" },
    acceptedSensitiveDataConsent: { type: "boolean" },
  },
  required: [
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
    "acceptedPrivacyPolicy",
    "acceptedSensitiveDataConsent",
  ],
};

const GenericOk = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    message: { type: "string" },
  },
  required: ["ok"],
};

const UserBundle = {
  type: "object",
  description: "Bundle completo do app, incluindo perfil, exercicios, pesos, conclusoes e status.",
  additionalProperties: true,
};

const Exercise = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    muscleGroup: { type: "string" },
    goal: { type: "string" },
    environment: { type: "string" },
    calories: { type: "integer" },
    videoUrl: { type: "string", format: "uri" },
    description: { type: "string" },
    equipment: { type: "string" },
  },
  required: ["id", "name", "muscleGroup", "goal", "environment", "calories", "videoUrl"],
};

const ExerciseInput = {
  type: "object",
  properties: {
    name: { type: "string" },
    muscleGroup: { type: "string" },
    goal: { type: "string" },
    environment: { type: "string" },
    calories: { type: "integer" },
    videoUrl: { type: "string", format: "uri" },
    description: { type: "string" },
    equipment: { type: "string" },
  },
  required: ["name", "muscleGroup", "goal", "environment", "calories", "videoUrl", "description", "equipment"],
};

const PortalUser = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["admin", "instrutor", "visualizador"] },
    permissions: { type: "array", items: { type: "string" } },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "name", "email", "role", "permissions", "isActive"],
};

const PortalUserInput = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    role: { type: "string", enum: ["admin", "instrutor", "visualizador"] },
    permissions: { type: "array", items: { type: "string" } },
    isActive: { type: "boolean" },
  },
  required: ["name", "email", "role"],
};

const spec = {
  openapi: "3.1.0",
  info: {
    title: "FatBurn API",
    version: "1.0.3",
    description:
      "API do FatBurn para autenticacao, app mobile do aluno, portal do instrutor, privacidade e gerenciamento de treinos.",
  },
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Exercises" },
    { name: "Users" },
    { name: "Portal" },
    { name: "Privacy" },
    { name: "Workouts" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Session Token",
      },
    },
    schemas: {
      ErrorResponse,
      LoginRequest,
      RegisterRequest,
      GenericOk,
      UserBundle,
      Exercise,
      ExerciseInput,
      PortalUser,
      PortalUserInput,
    },
    responses: {
      Unauthorized: {
        description: "Sessao invalida ou expirada",
        content: json(ErrorResponse),
      },
      Forbidden: {
        description: "Acesso negado",
        content: json(ErrorResponse),
      },
      NotFound: {
        description: "Recurso nao encontrado",
        content: json(ErrorResponse),
      },
      TooManyRequests: {
        description: "Muitas tentativas em um curto periodo",
        content: json({
          type: "object",
          properties: {
            error: { type: "string" },
            retryAfterSeconds: { type: "integer" },
          },
          required: ["error", "retryAfterSeconds"],
        }),
      },
    },
  },
  paths: {},
};

Object.assign(spec.paths, {
  "/api/health": {
    get: {
      tags: ["Health"],
      summary: "Health check do backend",
      responses: {
        200: {
          description: "Backend ativo",
          content: json({
            type: "object",
            properties: {
              ok: { type: "boolean" },
              db: { type: "string", example: "postgres" },
              seededExercises: { type: "integer" },
            },
            required: ["ok", "db", "seededExercises"],
          }),
        },
      },
    },
  },
  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login do aluno",
      requestBody: { required: true, content: json(LoginRequest) },
      responses: {
        200: {
          description: "Sessao autenticada do aluno",
          content: json({
            type: "object",
            properties: {
              token: { type: "string" },
              role: { type: "string", enum: ["user"] },
              policyVersion: { type: "string" },
              sensitiveConsentVersion: { type: "string" },
              bundle: UserBundle,
            },
            required: ["token", "role", "policyVersion", "sensitiveConsentVersion", "bundle"],
          }),
        },
        401: { $ref: "#/components/responses/Unauthorized" },
        404: { $ref: "#/components/responses/NotFound" },
        429: { $ref: "#/components/responses/TooManyRequests" },
      },
    },
  },
  "/api/auth/instructor/login": {
    post: {
      tags: ["Auth"],
      summary: "Login do portal do instrutor",
      requestBody: { required: true, content: json(LoginRequest) },
      responses: {
        200: {
          description: "Sessao autenticada do portal",
          content: json({
            type: "object",
            properties: {
              token: { type: "string" },
              role: { type: "string", enum: ["instructor"] },
              permissions: { type: "array", items: { type: "string" } },
              instructor: PortalUser,
            },
            required: ["token", "role", "permissions", "instructor"],
          }),
        },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
        404: { $ref: "#/components/responses/NotFound" },
        429: { $ref: "#/components/responses/TooManyRequests" },
      },
    },
  },
  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Logout da sessao atual",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Sessao encerrada", content: json({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
      },
    },
  },
  "/api/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Cadastro do aluno",
      requestBody: { required: true, content: json(RegisterRequest) },
      responses: {
        201: {
          description: "Aluno cadastrado e autenticado",
          content: json({
            type: "object",
            properties: {
              token: { type: "string" },
              role: { type: "string", enum: ["user"] },
              policyVersion: { type: "string" },
              sensitiveConsentVersion: { type: "string" },
              bundle: UserBundle,
            },
            required: ["token", "role", "policyVersion", "sensitiveConsentVersion", "bundle"],
          }),
        },
        400: { description: "Erro de validacao", content: json(ErrorResponse) },
        409: { description: "Email ja cadastrado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/auth/forgot-password": {
    post: {
      tags: ["Auth"],
      summary: "Solicitar codigo de redefinicao de senha",
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: { email: { type: "string", format: "email" } },
          required: ["email"],
        }),
      },
      responses: {
        200: {
          description: "Solicitacao processada",
          content: json({
            type: "object",
            properties: {
              ok: { type: "boolean" },
              message: { type: "string" },
              expiresInMinutes: { type: "integer" },
            },
            required: ["ok", "message", "expiresInMinutes"],
          }),
        },
        400: { description: "Email invalido", content: json(ErrorResponse) },
        503: { description: "Envio de email nao configurado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/auth/reset-password": {
    post: {
      tags: ["Auth"],
      summary: "Redefinir senha com codigo",
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            code: { type: "string", pattern: "^\\d{6}$" },
            password: { type: "string", minLength: 8 },
          },
          required: ["email", "code", "password"],
        }),
      },
      responses: {
        200: { description: "Senha redefinida", content: json(GenericOk) },
        400: { description: "Codigo invalido ou expirado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/exercises": {
    get: {
      tags: ["Exercises"],
      summary: "Listar exercicios",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Lista de exercicios", content: json({ type: "object", properties: { exercises: { type: "array", items: Exercise } }, required: ["exercises"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
    post: {
      tags: ["Exercises"],
      summary: "Criar exercicio",
      security: [{ BearerAuth: [] }],
      requestBody: { required: true, content: json(ExerciseInput) },
      responses: {
        201: { description: "Exercicio criado", content: json({ type: "object", properties: { exercise: Exercise }, required: ["exercise"] }) },
        400: { description: "Erro de validacao", content: json(ErrorResponse) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/exercises/{exerciseId}": {
    put: {
      tags: ["Exercises"],
      summary: "Atualizar exercicio",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "exerciseId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: json(ExerciseInput) },
      responses: {
        200: { description: "Exercicio atualizado", content: json({ type: "object", properties: { exercise: Exercise }, required: ["exercise"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
        404: { $ref: "#/components/responses/NotFound" },
      },
    },
  },
});

Object.assign(spec.paths, {
  "/api/users/{userId}/recalculate": {
    post: {
      tags: ["Workouts"],
      summary: "Recalcular treino do aluno",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Bundle recalculado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/weights": {
    post: {
      tags: ["Users"],
      summary: "Salvar peso do dia",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            weightKg: { type: "number" },
            date: { type: "string", example: "2026-05-20" },
          },
          required: ["weightKg", "date"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/completions": {
    post: {
      tags: ["Workouts"],
      summary: "Atualizar conclusao de exercicio",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutId: { type: "string" },
            exerciseId: { type: "string" },
            date: { type: "string" },
            completedSetIds: { type: "array", items: { type: "string" } },
          },
          required: ["workoutId", "exerciseId", "date", "completedSetIds"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/workouts/set": {
    post: {
      tags: ["Workouts"],
      summary: "Atualizar repeticoes ou carga de uma serie",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutId: { type: "string" },
            slotId: { type: "string" },
            setId: { type: "string" },
            repetitions: { type: "string" },
            load: { type: "string" },
          },
          required: ["workoutId", "slotId", "setId"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/workouts/replace": {
    post: {
      tags: ["Workouts"],
      summary: "Trocar exercicio por outro compativel",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutId: { type: "string" },
            slotId: { type: "string" },
            nextExerciseId: { type: "string" },
          },
          required: ["workoutId", "slotId", "nextExerciseId"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/workouts/start": {
    post: {
      tags: ["Workouts"],
      summary: "Iniciar treino da semana",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutLabel: { type: "string" },
            date: { type: "string" },
          },
          required: ["workoutLabel", "date"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/workouts/finish": {
    post: {
      tags: ["Workouts"],
      summary: "Finalizar treino da semana",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutId: { type: "string" },
            workoutLabel: { type: "string" },
            date: { type: "string" },
          },
          required: ["workoutId", "workoutLabel", "date"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}/workouts/restart": {
    post: {
      tags: ["Workouts"],
      summary: "Reiniciar treino atual",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            workoutId: { type: "string" },
            workoutLabel: { type: "string" },
            date: { type: "string" },
          },
          required: ["workoutId", "workoutLabel", "date"],
        }),
      },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
});

Object.assign(spec.paths, {
  "/api/users": {
    get: {
      tags: ["Users"],
      summary: "Listar alunos",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Lista de alunos", content: json({ type: "object", properties: { users: { type: "array", items: { type: "object", additionalProperties: true } } }, required: ["users"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/users/{userId}": {
    get: {
      tags: ["Users"],
      summary: "Obter bundle completo do aluno",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Bundle do aluno", content: json(UserBundle) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
    put: {
      tags: ["Users"],
      summary: "Atualizar perfil do aluno",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: json(RegisterRequest) },
      responses: {
        200: { description: "Bundle atualizado", content: json(UserBundle) },
        400: { description: "Erro de validacao", content: json(ErrorResponse) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
        409: { description: "Email ja utilizado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/portal-users": {
    get: {
      tags: ["Portal"],
      summary: "Listar usuarios internos do portal",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Lista de acessos", content: json({ type: "object", properties: { portalUsers: { type: "array", items: PortalUser } }, required: ["portalUsers"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
    post: {
      tags: ["Portal"],
      summary: "Criar usuario interno do portal",
      security: [{ BearerAuth: [] }],
      requestBody: { required: true, content: json(PortalUserInput) },
      responses: {
        201: { description: "Usuario criado", content: json({ type: "object", properties: { portalUser: PortalUser }, required: ["portalUser"] }) },
        400: { description: "Erro de validacao", content: json(ErrorResponse) },
        409: { description: "Email ja utilizado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/portal-users/{portalUserId}": {
    put: {
      tags: ["Portal"],
      summary: "Atualizar usuario interno do portal",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "portalUserId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: json(PortalUserInput) },
      responses: {
        200: { description: "Usuario atualizado", content: json({ type: "object", properties: { portalUser: PortalUser }, required: ["portalUser"] }) },
        400: { description: "Erro de validacao ou regra", content: json(ErrorResponse) },
        404: { $ref: "#/components/responses/NotFound" },
        409: { description: "Email ja utilizado", content: json(ErrorResponse) },
      },
    },
  },
  "/api/privacy/consent": {
    post: {
      tags: ["Privacy"],
      summary: "Registrar consentimentos obrigatorios",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          properties: {
            acceptedPrivacyPolicy: { type: "boolean" },
            acceptedSensitiveDataConsent: { type: "boolean" },
          },
          required: ["acceptedPrivacyPolicy", "acceptedSensitiveDataConsent"],
        }),
      },
      responses: {
        200: {
          description: "Consentimento registrado",
          content: json({
            type: "object",
            properties: {
              policyVersion: { type: "string" },
              sensitiveConsentVersion: { type: "string" },
              bundle: UserBundle,
            },
            required: ["policyVersion", "sensitiveConsentVersion", "bundle"],
          }),
        },
        400: { description: "Consentimento incompleto", content: json(ErrorResponse) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/privacy/export": {
    get: {
      tags: ["Privacy"],
      summary: "Exportar dados do aluno",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Exportacao do titular", content: json({ type: "object", additionalProperties: true }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
  "/api/account": {
    delete: {
      tags: ["Privacy"],
      summary: "Excluir conta do aluno",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Conta excluida", content: json({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }) },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
      },
    },
  },
});

export function buildOpenApiSpec(origin = "/") {
  return {
    ...spec,
    servers: [{ url: origin, description: "Ambiente atual" }],
  };
}

export function renderSwaggerUiHtml(specPath = "/api/docs/openapi.json") {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FatBurn API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>html,body{margin:0;padding:0}.topbar{display:none}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: ${JSON.stringify(specPath)}, dom_id: "#swagger-ui", deepLinking: true, persistAuthorization: true, docExpansion: "list" });
    </script>
  </body>
</html>`;
}
