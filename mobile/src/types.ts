export type FitnessObjective = "perda_de_peso" | "definicao";
export type ExerciseGoal = FitnessObjective | "geral";
export type TrainingLevel = "iniciante" | "intermediario" | "avancado";
export type BiologicalSex = "masculino" | "feminino" | "outro";
export type TrainingEnvironment = "casa" | "academia";
export type MuscleGroup =
  | "peito"
  | "costas"
  | "pernas"
  | "gluteos"
  | "ombros"
  | "biceps"
  | "triceps"
  | "cardio";

export type WorkoutSet = {
  id: string;
  label: string;
  repetitions: string;
  load: string;
};

export type WorkoutExercise = {
  slotId: string;
  exerciseId: string;
  muscleGroup: MuscleGroup;
  sets: WorkoutSet[];
  restSeconds: number;
};

export type WorkoutDay = {
  id: string;
  label: string;
  name: string;
  focus: string;
  muscleGroups: MuscleGroup[];
  exercises: WorkoutExercise[];
  guidance: string;
};

export type Exercise = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  goal: ExerciseGoal;
  environment: TrainingEnvironment;
  calories: number;
  videoUrl: string;
  description: string;
  equipment: string;
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  age: number;
  sex: BiologicalSex;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  objective: FitnessObjective;
  trainingEnvironment: TrainingEnvironment;
  trainingDaysPerWeek: number;
  level: TrainingLevel;
  restrictions: string;
  bmi: number;
  bmiClass: string;
  workoutPlan: WorkoutDay[];
  createdAt: string;
  consents: {
    privacyPolicyVersion: string;
    privacyAcceptedAt: string | null;
    sensitiveConsentVersion: string;
    sensitiveConsentAcceptedAt: string | null;
    accepted: boolean;
  };
};

export type WeightEntry = {
  id: string;
  userId: string;
  date: string;
  weightKg: number;
};

export type CompletionEntry = {
  id: string;
  userId: string;
  date: string;
  workoutId: string;
  exerciseId: string;
  calories: number;
  completedSetIds: string[];
};

export type WorkoutStatus = {
  id: string;
  weekKey: string;
  workoutId: string | null;
  workoutLabel: string;
  workoutName: string;
  workoutOrder: number;
  status: "pendente" | "em_andamento" | "concluido";
  startedAt: string | null;
  completedAt: string | null;
};

export type AppState = {
  users: UserProfile[];
  currentUserId: string | null;
  exercises: Exercise[];
  weightEntries: WeightEntry[];
  completionEntries: CompletionEntry[];
  workoutStatuses: WorkoutStatus[];
};
