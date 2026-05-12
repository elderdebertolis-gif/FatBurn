import { Platform } from "react-native";
import {
  CompletionEntry,
  Exercise,
  UserProfile,
  WeightEntry,
  WorkoutStatus,
} from "./types";

const defaultBaseUrl =
  Platform.OS === "android" ? "http://10.0.2.2:3030" : "http://localhost:3030";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl;
const REQUEST_TIMEOUT_MS = 5000;

export type UserBundle = {
  user: UserProfile;
  exercises: Exercise[];
  weightEntries: WeightEntry[];
  completionEntries: CompletionEntry[];
  workoutStatuses: WorkoutStatus[];
};

export type UserPayload = {
  name: string;
  email: string;
  password: string;
  age: number;
  sex: UserProfile["sex"];
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  objective: UserProfile["objective"];
  trainingEnvironment: UserProfile["trainingEnvironment"];
  trainingDaysPerWeek: number;
  level: UserProfile["level"];
  restrictions: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const payload = rawText ? JSON.parse(rawText) : {};

    if (!response.ok) {
      throw new Error(payload.error ?? "Falha ao comunicar com o servidor.");
    }

    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Tempo esgotado ao acessar ${API_BASE_URL}. Se estiver no celular fisico, defina EXPO_PUBLIC_API_URL com o IP da sua maquina.`
      );
    }

    if (error instanceof Error) {
      throw new Error(
        `Nao foi possivel acessar ${API_BASE_URL}. Se estiver no celular fisico, defina EXPO_PUBLIC_API_URL com o IP da sua maquina.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkServerHealth(): Promise<{ ok: boolean; db: string }> {
  return request("/api/health");
}

export async function loginUser(
  email: string,
  password: string
): Promise<UserBundle> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function registerUser(payload: UserPayload): Promise<UserBundle> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUserProfile(
  userId: string,
  payload: UserPayload
): Promise<UserBundle> {
  return request(`/api/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchUserBundle(userId: string): Promise<UserBundle> {
  return request(`/api/users/${userId}`);
}

export async function recalculateWorkout(userId: string): Promise<UserBundle> {
  return request(`/api/users/${userId}/recalculate`, {
    method: "POST",
  });
}

export async function saveDailyWeight(
  userId: string,
  weightKg: number,
  date: string
): Promise<UserBundle> {
  return request(`/api/users/${userId}/weights`, {
    method: "POST",
    body: JSON.stringify({ weightKg, date }),
  });
}

export async function toggleExerciseCompletion(
  userId: string,
  workoutId: string,
  exerciseId: string,
  date: string,
  completedSetIds: string[]
): Promise<UserBundle> {
  return request(`/api/users/${userId}/completions`, {
    method: "POST",
    body: JSON.stringify({ workoutId, exerciseId, date, completedSetIds }),
  });
}

export async function replaceWorkoutExercise(
  userId: string,
  workoutId: string,
  slotId: string,
  nextExerciseId: string
): Promise<UserBundle> {
  return request(`/api/users/${userId}/workouts/replace`, {
    method: "POST",
    body: JSON.stringify({ workoutId, slotId, nextExerciseId }),
  });
}

export async function updateWorkoutSet(
  userId: string,
  workoutId: string,
  slotId: string,
  setId: string,
  payload: { repetitions?: string; load?: string }
): Promise<UserBundle> {
  return request(`/api/users/${userId}/workouts/set`, {
    method: "POST",
    body: JSON.stringify({ workoutId, slotId, setId, ...payload }),
  });
}

export async function startWorkout(
  userId: string,
  workoutLabel: string,
  date: string
): Promise<UserBundle> {
  return request(`/api/users/${userId}/workouts/start`, {
    method: "POST",
    body: JSON.stringify({ workoutLabel, date }),
  });
}

export async function finishWorkout(
  userId: string,
  workoutId: string,
  workoutLabel: string,
  date: string
): Promise<UserBundle> {
  return request(`/api/users/${userId}/workouts/finish`, {
    method: "POST",
    body: JSON.stringify({ workoutId, workoutLabel, date }),
  });
}

export async function restartWorkout(
  userId: string,
  workoutId: string,
  workoutLabel: string,
  date: string
): Promise<UserBundle> {
  return request(`/api/users/${userId}/workouts/restart`, {
    method: "POST",
    body: JSON.stringify({ workoutId, workoutLabel, date }),
  });
}
