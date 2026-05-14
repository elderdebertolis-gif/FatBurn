const MAIN_EXERCISE_COUNT = 3;

const SPLITS = {
  2: [
    { label: "A", name: "Costas + triceps", focus: "Puxadas e extensoes para tronco superior com cardio ao final.", muscleGroups: ["costas", "triceps"] },
    { label: "B", name: "Pernas + peito", focus: "Base de membros inferiores com empurradas para peitoral.", muscleGroups: ["pernas", "peito"] },
  ],
  3: [
    { label: "A", name: "Costas + triceps", focus: "Sessao de costas e triceps com fechamento aerobico.", muscleGroups: ["costas", "triceps"] },
    { label: "B", name: "Pernas + gluteos", focus: "Trabalho principal de membros inferiores com cardio leve.", muscleGroups: ["pernas", "gluteos"] },
    { label: "C", name: "Peito + biceps", focus: "Peitoral e biceps com um aerobico no fim da sessao.", muscleGroups: ["peito", "biceps"] },
  ],
  4: [
    { label: "A", name: "Costas + triceps", focus: "Sessao focada em puxadas e extensoes com cardio controlado.", muscleGroups: ["costas", "triceps"] },
    { label: "B", name: "Pernas + gluteos", focus: "Membros inferiores com foco em potencia e estabilidade.", muscleGroups: ["pernas", "gluteos"] },
    { label: "C", name: "Peito + biceps", focus: "Empurradas e flexoes de cotovelo com final aerobico.", muscleGroups: ["peito", "biceps"] },
    { label: "D", name: "Ombros + costas", focus: "Deltoides e dorsais para reforcar postura e volume total.", muscleGroups: ["ombros", "costas"] },
  ],
  5: [
    { label: "A", name: "Costas + triceps", focus: "Puxadas, remadas e extensoes com cardio ao final.", muscleGroups: ["costas", "triceps"] },
    { label: "B", name: "Pernas + gluteos", focus: "Forca e definicao de membros inferiores com aerobico leve.", muscleGroups: ["pernas", "gluteos"] },
    { label: "C", name: "Peito + biceps", focus: "Peitoral e biceps com volume moderado e cardio.", muscleGroups: ["peito", "biceps"] },
    { label: "D", name: "Ombros + triceps", focus: "Deltoides e triceps com ritmo mais metabolico.", muscleGroups: ["ombros", "triceps"] },
    { label: "E", name: "Costas + biceps", focus: "Reforco de cadeia posterior com trabalho complementar de biceps.", muscleGroups: ["costas", "biceps"] },
  ],
  6: [
    { label: "A", name: "Costas + triceps", focus: "Treino tecnico de costas e triceps com cardio.", muscleGroups: ["costas", "triceps"] },
    { label: "B", name: "Pernas + gluteos", focus: "Volume de inferiores com finalizacao aerobica.", muscleGroups: ["pernas", "gluteos"] },
    { label: "C", name: "Peito + biceps", focus: "Peitoral e biceps com controle de execucao.", muscleGroups: ["peito", "biceps"] },
    { label: "D", name: "Ombros + triceps", focus: "Deltoides e triceps para acabamento superior.", muscleGroups: ["ombros", "triceps"] },
    { label: "E", name: "Costas + biceps", focus: "Remadas, puxadas e flexoes de cotovelo com aerobico curto.", muscleGroups: ["costas", "biceps"] },
    { label: "F", name: "Peito + pernas", focus: "Sessao complementar para manter volume total da semana.", muscleGroups: ["peito", "pernas"] },
  ],
};

const STRENGTH_REP_SCHEMES = {
  perda_de_peso: ["15", "15", "15"],
  definicao: ["12", "12", "10", "10"],
};

export const MUSCLE_GROUP_LABELS = {
  peito: "Peito",
  costas: "Costas",
  pernas: "Pernas",
  gluteos: "Gluteos",
  ombros: "Ombros",
  biceps: "Biceps",
  triceps: "Triceps",
  cardio: "Aerobico",
};

export function calculateBmi(weightKg, heightCm) {
  const heightM = heightCm / 100;
  if (!heightM || !weightKg) {
    return 0;
  }
  return Number((weightKg / (heightM * heightM)).toFixed(1));
}

export function getBmiClass(bmi) {
  if (bmi < 18.5) return "Abaixo do peso";
  if (bmi < 25) return "Peso adequado";
  if (bmi < 30) return "Sobrepeso";
  return "Obesidade";
}

export function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isGoalCompatible(exerciseGoal, objective) {
  return exerciseGoal === "geral" || exerciseGoal === objective;
}

function getSplitForFrequency(trainingDaysPerWeek) {
  const bounded = Math.min(6, Math.max(2, trainingDaysPerWeek));
  return SPLITS[bounded];
}

function environmentCompatible(exerciseEnvironment, trainingEnvironment) {
  return exerciseEnvironment === trainingEnvironment;
}

function getExercisesForGroup(exercises, group, objective, trainingEnvironment) {
  const compatible = exercises.filter(
    (exercise) =>
      exercise.muscleGroup === group &&
      environmentCompatible(exercise.environment, trainingEnvironment) &&
      isGoalCompatible(exercise.goal, objective)
  );

  const fallback = exercises.filter(
    (exercise) =>
      exercise.muscleGroup === group &&
      environmentCompatible(exercise.environment, trainingEnvironment)
  );

  return compatible.length ? compatible : fallback;
}

function getCardioPool(exercises, objective, bmi, trainingEnvironment) {
  const compatible = getExercisesForGroup(exercises, "cardio", objective, trainingEnvironment);
  const sorted = [...compatible].sort((left, right) => left.calories - right.calories);

  if (objective === "perda_de_peso" && bmi >= 30) {
    return sorted;
  }

  if (objective === "perda_de_peso") {
    return [...sorted].reverse();
  }

  return bmi < 25 ? [...sorted].reverse() : sorted;
}

function selectExercises(pool, count, startOffset) {
  if (!pool.length) return [];

  const selected = [];
  for (let index = 0; index < count; index += 1) {
    selected.push(pool[(startOffset + index) % pool.length]);
  }
  return selected;
}

function buildSessionGuidance(user, template) {
  if (user.objective === "perda_de_peso" && user.bmi >= 30) {
    return `${template.focus} Como o IMC esta mais alto, o cardio escolhido prioriza impacto menor e constancia.`;
  }

  if (user.objective === "perda_de_peso") {
    return `${template.focus} O IMC atual pede um cardio mais dinamico ao final para elevar o gasto calorico diario.`;
  }

  if (user.bmi < 25) {
    return `${template.focus} O IMC favorece um treino mais forte na parte resistida com cardio curto para acabamento.`;
  }

  return `${template.focus} Mantenha a tecnica e use o aerobico final para melhorar condicionamento sem perder qualidade.`;
}

function getStrengthRepetitions(user) {
  return STRENGTH_REP_SCHEMES[user.objective] ?? STRENGTH_REP_SCHEMES.definicao;
}

function getCardioDuration(user) {
  let durationMinutes = user.objective === "perda_de_peso" ? 20 : 15;
  if (user.bmi >= 30) {
    durationMinutes += 4;
  }

  return durationMinutes;
}

function getSetLoadLabel(exercise, muscleGroup) {
  if (muscleGroup === "cardio") {
    return "Ritmo";
  }

  const equipment = String(exercise.equipment ?? "").toLowerCase();

  if (equipment.includes("peso corporal")) {
    return "Corpo";
  }

  if (equipment.includes("elastico") || equipment.includes("mini band")) {
    return "Tensao";
  }

  return "Ajustar";
}

function getRestSeconds(user, muscleGroup) {
  if (muscleGroup === "cardio") {
    return 30;
  }

  return user.objective === "perda_de_peso" ? 45 : 60;
}

function buildSetRows(user, exercise, muscleGroup, seedPrefix) {
  if (muscleGroup === "cardio") {
    const repetitionsScheme = getStrengthRepetitions(user);
    const totalDuration = getCardioDuration(user);
    const durationPerSet = Math.max(4, Math.round(totalDuration / repetitionsScheme.length));

    return repetitionsScheme.map((_, index) => ({
        id: generateId(`${seedPrefix}-set-${index + 1}`),
        label: `${index + 1}a`,
        repetitions: `${durationPerSet} min`,
        load: "",
      }));
  }

  return getStrengthRepetitions(user).map((repetitions, index) => ({
    id: generateId(`${seedPrefix}-set-${index + 1}`),
    label: `${index + 1}a`,
    repetitions,
    load: "",
  }));
}

function buildExerciseSlot(user, exercise, muscleGroup, slotIdPrefix) {
  const slotId = generateId(slotIdPrefix);

  return {
    slotId,
    exerciseId: exercise.id,
    muscleGroup,
    sets: buildSetRows(user, exercise, muscleGroup, slotId),
    restSeconds: getRestSeconds(user, muscleGroup),
  };
}

function normalizeSetRows(existingSets, fallbackSets) {
  if (!Array.isArray(existingSets) || !existingSets.length) {
    return fallbackSets;
  }

  return fallbackSets.map((fallbackSet, index) => {
    const existingSet = existingSets[index];

    return {
      id: existingSet?.id ?? fallbackSet.id ?? generateId(`normalized-set-${index + 1}`),
      label: fallbackSet.label ?? existingSet?.label ?? `${index + 1}a`,
      repetitions:
        typeof existingSet?.repetitions === "string" && existingSet.repetitions.trim()
          ? existingSet.repetitions
          : fallbackSet.repetitions ?? "",
      load: typeof existingSet?.load === "string" ? existingSet.load : fallbackSet.load ?? "",
    };
  });
}

export function normalizeWorkoutPlan(plan, user, exercises) {
  const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  if (!Array.isArray(plan)) {
    return [];
  }

  return plan.map((workout, workoutIndex) => ({
    ...workout,
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.map((slot, slotIndex) => {
          const muscleGroup = slot.muscleGroup ?? "cardio";
          const exercise = exercisesById.get(slot.exerciseId);
          const fallbackSlot =
            exercise
              ? buildExerciseSlot(
                  user,
                  exercise,
                  muscleGroup,
                  `normalized-slot-${workoutIndex}-${slotIndex}`
                )
              : {
                  slotId: slot.slotId ?? generateId(`normalized-slot-${workoutIndex}-${slotIndex}`),
                  exerciseId: slot.exerciseId,
                  muscleGroup,
                  sets: [],
                  restSeconds: getRestSeconds(user, muscleGroup),
                };

          return {
            ...slot,
            slotId: slot.slotId ?? fallbackSlot.slotId,
            exerciseId: slot.exerciseId,
            muscleGroup,
            sets: normalizeSetRows(slot.sets, fallbackSlot.sets),
            restSeconds:
              typeof slot.restSeconds === "number" ? slot.restSeconds : fallbackSlot.restSeconds,
          };
        })
      : [],
  }));
}

export function buildWorkoutPlan(user, exercises) {
  const templates = getSplitForFrequency(user.trainingDaysPerWeek);
  const cardioPool = getCardioPool(
    exercises,
    user.objective,
    user.bmi,
    user.trainingEnvironment
  );

  return templates.map((template, sessionIndex) => {
    const selectedExercises = [];

    template.muscleGroups.forEach((group, groupIndex) => {
      const pool = getExercisesForGroup(
        exercises,
        group,
        user.objective,
        user.trainingEnvironment
      );
      const groupExercises = selectExercises(pool, MAIN_EXERCISE_COUNT, sessionIndex + groupIndex);

      groupExercises.forEach((exercise, exerciseIndex) => {
        selectedExercises.push(
          buildExerciseSlot(
            user,
            exercise,
            group,
            `slot-${sessionIndex}-${groupIndex}-${exerciseIndex}`
          )
        );
      });
    });

    const cardio = cardioPool.length ? cardioPool[sessionIndex % cardioPool.length] : null;
    if (cardio) {
      selectedExercises.push(
        buildExerciseSlot(user, cardio, "cardio", `slot-cardio-${sessionIndex}`)
      );
    }

    return {
      id: generateId("workout"),
      label: template.label,
      name: template.name,
      focus: template.focus,
      muscleGroups: [...template.muscleGroups, "cardio"],
      exercises: selectedExercises,
      guidance: buildSessionGuidance(user, template),
    };
  });
}

export function createReplacementSlot(user, exercise, muscleGroup, slotId) {
  const replacement = buildExerciseSlot(user, exercise, muscleGroup, slotId);
  return {
    ...replacement,
    slotId,
  };
}

export function hydrateUser(row, exercises) {
  const bmi = calculateBmi(row.weightKg, row.heightCm);
  const normalizedUser = {
    objective: row.objective,
    trainingDaysPerWeek: row.trainingDaysPerWeek,
    bmi,
    weightKg: row.weightKg,
    heightCm: row.heightCm,
    trainingEnvironment: row.trainingEnvironment,
    level: row.level,
  };
  const parsedPlan = row.customWorkoutPlan ? JSON.parse(row.customWorkoutPlan) : null;
  const workoutPlan =
    parsedPlan && Array.isArray(parsedPlan)
      ? normalizeWorkoutPlan(parsedPlan, normalizedUser, exercises)
      : buildWorkoutPlan(normalizedUser, exercises);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    age: row.age,
    sex: row.sex,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    targetWeightKg: row.targetWeightKg,
    objective: row.objective,
    trainingEnvironment: row.trainingEnvironment,
    trainingDaysPerWeek: row.trainingDaysPerWeek,
    level: row.level,
    restrictions: row.restrictions ?? "",
    bmi,
    bmiClass: getBmiClass(bmi),
    workoutPlan,
    createdAt: row.createdAt,
    privacyPolicyVersion: row.privacyPolicyVersion ?? null,
    privacyAcceptedAt: row.privacyAcceptedAt ?? null,
    sensitiveConsentVersion: row.sensitiveConsentVersion ?? null,
    sensitiveConsentAcceptedAt: row.sensitiveConsentAcceptedAt ?? null,
  };
}
