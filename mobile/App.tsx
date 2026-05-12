import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import YoutubePlayer from "react-native-youtube-iframe";
import {
  API_BASE_URL,
  finishWorkout,
  UserBundle,
  UserPayload,
  checkServerHealth,
  fetchUserBundle,
  loginUser,
  recalculateWorkout,
  registerUser,
  replaceWorkoutExercise,
  restartWorkout,
  saveDailyWeight,
  startWorkout,
  toggleExerciseCompletion,
  updateWorkoutSet,
  updateUserProfile,
} from "./src/api";
import { styles } from "./src/styles";
import {
  CompletionEntry,
  MuscleGroup,
  UserProfile,
  WorkoutSet,
  WorkoutStatus,
} from "./src/types";
import { formatDateLabel, getDayKey } from "./src/utils/date";
import { getObjectiveLabel } from "./src/utils/health";
import { MUSCLE_GROUP_LABELS } from "./src/utils/workout";

const SESSION_KEY = "@fatburn/current-user-id";

const TAB_ITEMS = [
  { key: "dashboard", label: "Resumo" },
  { key: "workouts", label: "Treinos" },
  { key: "progress", label: "Evolucao" },
  { key: "profile", label: "Perfil" },
] as const;

const OBJECTIVE_OPTIONS = [
  { value: "perda_de_peso", label: "Perda de peso" },
  { value: "definicao", label: "Definicao" },
] as const;

const SEX_OPTIONS = [
  { value: "masculino", label: "Masculino" },
  { value: "feminino", label: "Feminino" },
  { value: "outro", label: "Outro" },
] as const;

const LEVEL_OPTIONS = [
  { value: "iniciante", label: "Iniciante" },
  { value: "intermediario", label: "Intermediario" },
  { value: "avancado", label: "Avancado" },
] as const;

const ENVIRONMENT_OPTIONS = [
  { value: "casa", label: "Casa" },
  { value: "academia", label: "Academia" },
] as const;

const TRAINING_DAYS_OPTIONS = ["2", "3", "4", "5", "6"] as const;

type TabKey = (typeof TAB_ITEMS)[number]["key"];
type AuthMode = "login" | "register";

type ProfileFormState = {
  name: string;
  email: string;
  password: string;
  age: string;
  sex: UserProfile["sex"];
  heightCm: string;
  weightKg: string;
  targetWeightKg: string;
  objective: UserProfile["objective"];
  trainingEnvironment: UserProfile["trainingEnvironment"];
  trainingDaysPerWeek: string;
  level: UserProfile["level"];
  restrictions: string;
};

type ReplacementContext = {
  workoutId: string;
  slotId: string;
  exerciseId: string;
  muscleGroup: MuscleGroup;
} | null;
type VideoContext = { title: string; url: string } | null;

type ApiError = Error & { message: string };
type SetDraftMap = Record<string, { repetitions: string; load: string }>;

function createEmptyForm(): ProfileFormState {
  return {
    name: "",
    email: "",
    password: "",
    age: "",
    sex: "masculino",
    heightCm: "",
    weightKg: "",
    targetWeightKg: "",
    objective: "perda_de_peso",
    trainingEnvironment: "academia",
    trainingDaysPerWeek: "3",
    level: "iniciante",
    restrictions: "",
  };
}

function buildFormFromUser(user: UserProfile): ProfileFormState {
  return {
    name: user.name,
    email: user.email,
    password: user.password,
    age: String(user.age),
    sex: user.sex,
    heightCm: String(user.heightCm),
    weightKg: String(user.weightKg),
    targetWeightKg: String(user.targetWeightKg),
    objective: user.objective,
    trainingEnvironment: user.trainingEnvironment,
    trainingDaysPerWeek: String(user.trainingDaysPerWeek),
    level: user.level,
    restrictions: user.restrictions,
  };
}

function normalizeNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function validateForm(form: ProfileFormState): string | null {
  if (!form.name.trim()) return "Informe o nome.";
  if (!form.email.trim() || !form.email.includes("@")) return "Informe um email valido.";
  if (!form.password.trim() || form.password.trim().length < 4) {
    return "A senha deve ter pelo menos 4 caracteres.";
  }
  if (!Number.isFinite(normalizeNumber(form.age)) || normalizeNumber(form.age) < 12) {
    return "Informe uma idade valida.";
  }
  if (
    !Number.isFinite(normalizeNumber(form.heightCm)) ||
    normalizeNumber(form.heightCm) < 100
  ) {
    return "Informe uma altura valida em cm.";
  }
  if (
    !Number.isFinite(normalizeNumber(form.weightKg)) ||
    normalizeNumber(form.weightKg) <= 0
  ) {
    return "Informe um peso atual valido.";
  }
  if (
    !Number.isFinite(normalizeNumber(form.targetWeightKg)) ||
    normalizeNumber(form.targetWeightKg) <= 0
  ) {
    return "Informe uma meta de peso valida.";
  }
  if (
    !Number.isFinite(normalizeNumber(form.trainingDaysPerWeek)) ||
    normalizeNumber(form.trainingDaysPerWeek) < 2 ||
    normalizeNumber(form.trainingDaysPerWeek) > 6
  ) {
    return "Escolha uma frequencia entre 2 e 6 dias.";
  }
  return null;
}

function formToPayload(form: ProfileFormState): UserPayload {
  return {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    password: form.password.trim(),
    age: Math.round(normalizeNumber(form.age)),
    sex: form.sex,
    heightCm: normalizeNumber(form.heightCm),
    weightKg: normalizeNumber(form.weightKg),
    targetWeightKg: normalizeNumber(form.targetWeightKg),
    objective: form.objective,
    trainingEnvironment: form.trainingEnvironment,
    trainingDaysPerWeek: Math.round(normalizeNumber(form.trainingDaysPerWeek)),
    level: form.level,
    restrictions: form.restrictions.trim(),
  };
}

function getEnvironmentLabel(value: UserProfile["trainingEnvironment"]): string {
  return value === "casa" ? "Casa" : "Academia";
}

function getLevelLabel(value: UserProfile["level"]): string {
  if (value === "iniciante") return "Iniciante";
  if (value === "intermediario") return "Intermediario";
  return "Avancado";
}

function formatRestLabel(restSeconds: number): string {
  return `${restSeconds}s`;
}

function buildFallbackSetRows(
  muscleGroup: MuscleGroup,
  slotId: string,
  objective: UserProfile["objective"]
) {
  const count = objective === "definicao" ? 4 : 3;
  const defaultValue = muscleGroup === "cardio" ? "5 min" : objective === "definicao" ? "12" : "15";

  return Array.from({ length: count }, (_, index) => ({
    id: `${slotId}-fallback-${index + 1}`,
    label: `${index + 1}a`,
    repetitions: defaultValue,
    load: "",
  }));
}

function getCompletionKey(entry: Pick<CompletionEntry, "workoutId" | "exerciseId" | "date">) {
  return `${entry.date}:${entry.workoutId}:${entry.exerciseId}`;
}

function getWorkoutStatusLabel(status: WorkoutStatus["status"]) {
  if (status === "concluido") {
    return "Concluido";
  }

  if (status === "em_andamento") {
    return "Em andamento";
  }

  return "Pendente";
}

function extractYouTubeVideoId(videoUrl: string) {
  try {
    const url = new URL(videoUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      return videoId ?? null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      const fromWatch = url.searchParams.get("v");
      const fromEmbed = pathParts[0] === "embed" ? pathParts[1] : null;
      const fromShorts = pathParts[0] === "shorts" ? pathParts[1] : null;
      return fromWatch || fromEmbed || fromShorts || null;
    }
  } catch {
    return null;
  }

  return null;
}

function buildDirectVideoHtml(videoUrl: string) {
  const safeVideoUrl = videoUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
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

function LabeledInput({
  label,
  multiline,
  ...props
}: { label: string; multiline?: boolean } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#9b8f84"
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        multiline={multiline}
        {...props}
      />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  secondary,
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.button,
        secondary ? styles.buttonSecondary : styles.buttonPrimary,
        compact ? styles.buttonCompact : null,
        disabled ? { opacity: 0.55 } : null,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.buttonText,
          compact ? styles.buttonTextCompact : null,
          secondary ? styles.buttonSecondaryText : styles.buttonPrimaryText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SegmentedSelector<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (nextValue: T) => void;
}) {
  return (
    <View style={styles.segmentedWrap}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.pill, active ? styles.pillActive : null]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function UserFormFields({
  form,
  onChange,
}: {
  form: ProfileFormState;
  onChange: <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => void;
}) {
  return (
    <>
      <LabeledInput label="Nome" value={form.name} onChangeText={(value) => onChange("name", value)} />
      <LabeledInput
        label="Email"
        value={form.email}
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={(value) => onChange("email", value)}
      />
      <LabeledInput
        label="Senha"
        value={form.password}
        secureTextEntry
        onChangeText={(value) => onChange("password", value)}
      />
      <LabeledInput
        label="Idade"
        value={form.age}
        keyboardType="number-pad"
        onChangeText={(value) => onChange("age", value)}
      />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Sexo biologico</Text>
        <SegmentedSelector value={form.sex} options={SEX_OPTIONS} onChange={(value) => onChange("sex", value)} />
      </View>
      <LabeledInput
        label="Altura (cm)"
        value={form.heightCm}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChange("heightCm", value)}
      />
      <LabeledInput
        label="Peso atual (kg)"
        value={form.weightKg}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChange("weightKg", value)}
      />
      <LabeledInput
        label="Meta de peso (kg)"
        value={form.targetWeightKg}
        keyboardType="decimal-pad"
        onChangeText={(value) => onChange("targetWeightKg", value)}
      />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Objetivo</Text>
        <SegmentedSelector
          value={form.objective}
          options={OBJECTIVE_OPTIONS}
          onChange={(value) => onChange("objective", value)}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Vai treinar onde?</Text>
        <SegmentedSelector
          value={form.trainingEnvironment}
          options={ENVIRONMENT_OPTIONS}
          onChange={(value) => onChange("trainingEnvironment", value)}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Treinos por semana</Text>
        <SegmentedSelector
          value={form.trainingDaysPerWeek}
          options={TRAINING_DAYS_OPTIONS.map((value) => ({ value, label: `${value}x` }))}
          onChange={(value) => onChange("trainingDaysPerWeek", value)}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Nivel</Text>
        <SegmentedSelector
          value={form.level}
          options={LEVEL_OPTIONS}
          onChange={(value) => onChange("level", value)}
        />
      </View>
      <LabeledInput
        label="Restricoes ou observacoes"
        value={form.restrictions}
        multiline
        onChangeText={(value) => onChange("restrictions", value)}
      />
    </>
  );
}

export default function App() {
  const { width: windowWidth } = useWindowDimensions();
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [bundle, setBundle] = useState<UserBundle | null>(null);
  const [serverHealthy, setServerHealthy] = useState<boolean | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerForm, setRegisterForm] = useState<ProfileFormState>(createEmptyForm());
  const [profileForm, setProfileForm] = useState<ProfileFormState>(createEmptyForm());
  const [weightInput, setWeightInput] = useState("");
  const [replacementContext, setReplacementContext] = useState<ReplacementContext>(null);
  const [videoContext, setVideoContext] = useState<VideoContext>(null);
  const [setDrafts, setSetDrafts] = useState<SetDraftMap>({});
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);

  useEffect(() => {
    void runConnectionGate();
  }, []);

  useEffect(() => {
    if (!bundle) {
      return;
    }
    setProfileForm(buildFormFromUser(bundle.user));
    setWeightInput(String(bundle.user.weightKg));
    setSetDrafts({});
    setSelectedWorkoutId((current) =>
      current && bundle.user.workoutPlan?.some((workout) => workout.id === current) ? current : null
    );
  }, [bundle]);

  async function refreshServerHealth(): Promise<boolean> {
    try {
      await checkServerHealth();
      setServerHealthy(true);
      setSessionError("");
      return true;
    } catch (error) {
      setServerHealthy(false);
      setSessionError((error as ApiError).message ?? "Servidor indisponivel.");
      return false;
    }
  }

  async function restoreStoredSession() {
    const storedUserId = await AsyncStorage.getItem(SESSION_KEY);
    if (!storedUserId) {
      return;
    }

    try {
      const nextBundle = await fetchUserBundle(storedUserId);
      setBundle(nextBundle);
      setProfileForm(buildFormFromUser(nextBundle.user));
      setWeightInput(String(nextBundle.user.weightKg));
      setSessionError("");
    } catch (error) {
      await AsyncStorage.removeItem(SESSION_KEY);
      setBundle(null);
      setSessionError((error as ApiError).message ?? "Nao foi possivel restaurar a sessao.");
    }
  }

  async function runConnectionGate() {
    setBusy(true);
    setBooting(true);
    const connected = await refreshServerHealth();

    if (connected) {
      await restoreStoredSession();
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
      setBundle(null);
    }

    setBooting(false);
    setBusy(false);
  }

  async function persistBundle(nextBundle: UserBundle) {
    setBundle(nextBundle);
    await AsyncStorage.setItem(SESSION_KEY, nextBundle.user.id);
  }

  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert("Login", "Preencha email e senha.");
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await loginUser(loginEmail.trim(), loginPassword.trim());
      await persistBundle(nextBundle);
      setActiveTab("dashboard");
      setLoginPassword("");
      setSessionError("");
    } catch (error) {
      Alert.alert("Erro ao entrar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    const validationError = validateForm(registerForm);
    if (validationError) {
      Alert.alert("Cadastro", validationError);
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await registerUser(formToPayload(registerForm));
      await persistBundle(nextBundle);
      setRegisterForm(createEmptyForm());
      setActiveTab("dashboard");
      setAuthMode("login");
      setSessionError("");
    } catch (error) {
      Alert.alert("Erro ao cadastrar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await AsyncStorage.removeItem(SESSION_KEY);
    setBundle(null);
    setLoginEmail("");
    setLoginPassword("");
    setAuthMode("login");
    setActiveTab("dashboard");
    setSelectedWorkoutId(null);
  }

  async function refreshCurrentUser() {
    if (!bundle) {
      await refreshServerHealth();
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await fetchUserBundle(bundle.user.id);
      await persistBundle(nextBundle);
      setSessionError("");
      setServerHealthy(true);
    } catch (error) {
      Alert.alert("Falha ao sincronizar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveProfile() {
    if (!bundle) {
      return;
    }

    const validationError = validateForm(profileForm);
    if (validationError) {
      Alert.alert("Perfil", validationError);
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await updateUserProfile(bundle.user.id, formToPayload(profileForm));
      await persistBundle(nextBundle);
      setSessionError("");
      Alert.alert("Perfil atualizado", "Cadastro salvo e treino recalculado.");
    } catch (error) {
      Alert.alert("Erro ao salvar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalculateWorkout() {
    if (!bundle) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await recalculateWorkout(bundle.user.id);
      await persistBundle(nextBundle);
      Alert.alert("Treino atualizado", "A divisao foi refeita com base no perfil atual.");
    } catch (error) {
      Alert.alert("Erro ao recalcular", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveWeight() {
    if (!bundle) {
      return;
    }

    const weightKg = normalizeNumber(weightInput);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      Alert.alert("Pesagem", "Informe um peso valido.");
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await saveDailyWeight(bundle.user.id, weightKg, getDayKey());
      await persistBundle(nextBundle);
      Alert.alert("Pesagem salva", "A evolucao diaria foi atualizada.");
    } catch (error) {
      Alert.alert("Erro ao salvar peso", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleCompletion(
    workoutId: string,
    exerciseId: string,
    completedSetIds: string[]
  ) {
    if (!bundle) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await toggleExerciseCompletion(
        bundle.user.id,
        workoutId,
        exerciseId,
        getDayKey(),
        completedSetIds
      );
      await persistBundle(nextBundle);
    } catch (error) {
      Alert.alert("Erro ao registrar exercicio", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReplaceExercise(nextExerciseId: string) {
    if (!bundle || !replacementContext) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await replaceWorkoutExercise(
        bundle.user.id,
        replacementContext.workoutId,
        replacementContext.slotId,
        nextExerciseId
      );
      await persistBundle(nextBundle);
      setReplacementContext(null);
    } catch (error) {
      Alert.alert("Erro ao trocar exercicio", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function getDraftForSet(set: WorkoutSet) {
    return setDrafts[set.id] ?? {
      repetitions: set.repetitions,
      load: set.load,
    };
  }

  function updateSetDraft(
    set: WorkoutSet,
    field: "repetitions" | "load",
    value: string
  ) {
    setSetDrafts((current) => ({
      ...current,
      [set.id]: {
        repetitions: current[set.id]?.repetitions ?? set.repetitions,
        load: current[set.id]?.load ?? set.load,
        [field]: value,
      },
    }));
  }

  async function handleSaveWorkoutSet(workoutId: string, slotId: string, set: WorkoutSet) {
    if (!bundle) {
      return;
    }

    const draft = getDraftForSet(set);
    if (draft.repetitions === set.repetitions && draft.load === set.load) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await updateWorkoutSet(bundle.user.id, workoutId, slotId, set.id, {
        repetitions: draft.repetitions,
        load: draft.load,
      });
      await persistBundle(nextBundle);
    } catch (error) {
      Alert.alert("Erro ao salvar serie", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStartWorkoutSession(workoutId: string, workoutLabel: string) {
    if (!bundle) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await startWorkout(bundle.user.id, workoutLabel, todayKey);
      await persistBundle(nextBundle);
      setSelectedWorkoutId(workoutId);
    } catch (error) {
      Alert.alert("Nao foi possivel iniciar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishWorkoutSession(workoutId: string, workoutLabel: string) {
    if (!bundle) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await finishWorkout(bundle.user.id, workoutId, workoutLabel, todayKey);
      await persistBundle(nextBundle);
      setSelectedWorkoutId(null);
    } catch (error) {
      Alert.alert("Nao foi possivel finalizar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestartWorkoutSession(workoutId: string, workoutLabel: string) {
    if (!bundle) {
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await restartWorkout(bundle.user.id, workoutId, workoutLabel, todayKey);
      await persistBundle(nextBundle);
    } catch (error) {
      Alert.alert("Nao foi possivel reiniciar", (error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleWorkoutSet(
    workoutId: string,
    exerciseId: string,
    setId: string,
    completedSetIds: string[],
    allSetIds: string[]
  ) {
    const toggled = completedSetIds.includes(setId)
      ? completedSetIds.filter((id) => id !== setId)
      : [...completedSetIds, setId];
    const orderedSetIds = allSetIds.filter((id) => toggled.includes(id));
    await handleToggleCompletion(workoutId, exerciseId, orderedSetIds);
  }

  async function handleToggleAllWorkoutSets(
    workoutId: string,
    exerciseId: string,
    allSetIds: string[],
    allCompleted: boolean
  ) {
    await handleToggleCompletion(workoutId, exerciseId, allCompleted ? [] : allSetIds);
  }

  function updateRegisterForm<K extends keyof ProfileFormState>(
    field: K,
    value: ProfileFormState[K]
  ) {
    setRegisterForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileForm<K extends keyof ProfileFormState>(
    field: K,
    value: ProfileFormState[K]
  ) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#1f4037" />
        <Text style={styles.loadingTitle}>FatBurn</Text>
        <Text style={styles.loadingText}>Verificando conexao com o servidor.</Text>
      </SafeAreaView>
    );
  }

  if (!bundle && serverHealthy === false) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.authScreen}>
          <View style={styles.authBrandBlock}>
            <Text style={styles.authBrand}>FatBurn</Text>
            <Text style={styles.authBrandTitle}>Nao foi possivel conectar</Text>
            <Text style={styles.authBrandText}>
              Confirme se a API esta ativa e se o app esta apontando para o IP correto.
            </Text>
          </View>

          <View style={styles.authCard}>
            <Text style={styles.cardTitle}>Servidor indisponivel</Text>
            <Text style={styles.cardBody}>{sessionError || `API atual: ${API_BASE_URL}`}</Text>
            <Text style={styles.infoNote}>API configurada: {API_BASE_URL}</Text>
            <View style={styles.buttonRow}>
              <ActionButton
                label={busy ? "Testando..." : "Tentar novamente"}
                onPress={() => {
                  void runConnectionGate();
                }}
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!bundle) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.authScreen}>
          <View style={styles.authBrandBlock}>
            <Text style={styles.authBrand}>FatBurn</Text>
            <Text style={styles.authBrandTitle}>
              {authMode === "login" ? "Entrar" : "Criar conta"}
            </Text>
            <Text style={styles.authBrandText}>
              {authMode === "login"
                ? "Acesse sua conta para acompanhar treino, peso e calorias."
                : "Cadastre seus dados para gerar o treino ideal."}
            </Text>
          </View>

          <View style={styles.authCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{authMode === "login" ? "Login" : "Cadastro"}</Text>
              <Text style={styles.sectionSubtitle}>
                {authMode === "login"
                  ? "Informe seu email e senha."
                  : "Voce podera alterar essas informacoes depois no perfil."}
              </Text>
            </View>

            {sessionError ? <Text style={styles.infoNote}>{sessionError}</Text> : null}

            {authMode === "login" ? (
              <>
                <LabeledInput
                  label="Email"
                  value={loginEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={setLoginEmail}
                />
                <LabeledInput
                  label="Senha"
                  value={loginPassword}
                  secureTextEntry
                  onChangeText={setLoginPassword}
                />
                <View style={styles.buttonRow}>
                  <ActionButton label="Entrar" onPress={() => void handleLogin()} disabled={busy} />
                </View>
                <Pressable style={styles.authSwitch} onPress={() => setAuthMode("register")}>
                  <Text style={styles.authSwitchText}>Nao tem conta? Criar cadastro</Text>
                </Pressable>
              </>
            ) : (
              <>
                <UserFormFields form={registerForm} onChange={updateRegisterForm} />
                <View style={styles.buttonRow}>
                  <ActionButton
                    label="Cadastrar e montar treino"
                    onPress={() => void handleRegister()}
                    disabled={busy}
                  />
                </View>
                <Pressable style={styles.authSwitch} onPress={() => setAuthMode("login")}>
                  <Text style={styles.authSwitchText}>Ja tem conta? Entrar</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { user, exercises, weightEntries, completionEntries, workoutStatuses } = bundle;
  const workoutPlan = Array.isArray(user.workoutPlan) ? user.workoutPlan : [];
  const orderedWorkoutStatuses = [...(Array.isArray(workoutStatuses) ? workoutStatuses : [])].sort(
    (left, right) => left.workoutOrder - right.workoutOrder
  );
  const workoutStatusByLabel = new Map(
    orderedWorkoutStatuses.map((status) => [status.workoutLabel, status])
  );
  const currentWorkoutStatus =
    orderedWorkoutStatuses.find((status) => status.status === "em_andamento") ?? null;
  const selectedWorkout =
    workoutPlan.find((workout) => workout.id === selectedWorkoutId) ?? null;
  const selectedWorkoutStatus = selectedWorkout
    ? workoutStatusByLabel.get(selectedWorkout.label) ?? null
    : null;
  const todayKey = getDayKey();
  const exercisesById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const completionByKey = new Map(
    completionEntries.map((entry) => [getCompletionKey(entry), entry])
  );
  const todayCompletions = completionEntries.filter((entry) => entry.date === todayKey);
  const todayCompletedExercises = todayCompletions.filter((entry) => entry.calories > 0);
  const todayCalories = todayCompletedExercises.reduce((sum, entry) => sum + entry.calories, 0);
  const startingWeight = weightEntries[0]?.weightKg ?? user.weightKg;
  const totalDistance = Math.abs(startingWeight - user.targetWeightKg);
  const remainingDistance = Math.abs(user.weightKg - user.targetWeightKg);
  const progressRatio =
    totalDistance === 0 ? 1 : Math.max(0, 1 - remainingDistance / totalDistance);
  const recentWeights = [...weightEntries].slice(-7).reverse();

  const caloriesByDate = completionEntries.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.date] = (accumulator[entry.date] ?? 0) + entry.calories;
    return accumulator;
  }, {});

  const recentCalories = Object.entries(caloriesByDate)
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 7);

  const replacementOptions = replacementContext
    ? exercises.filter((exercise) => {
        if (exercise.id === replacementContext.exerciseId) {
          return false;
        }
        if (exercise.muscleGroup !== replacementContext.muscleGroup) {
          return false;
        }
        if (exercise.environment !== user.trainingEnvironment) {
          return false;
        }
        return exercise.goal === "geral" || exercise.goal === user.objective;
      })
    : [];

  const fallbackReplacementOptions =
    replacementContext && replacementOptions.length === 0
      ? exercises.filter(
          (exercise) =>
            exercise.id !== replacementContext.exerciseId &&
            exercise.muscleGroup === replacementContext.muscleGroup &&
            exercise.environment === user.trainingEnvironment
        )
      : replacementOptions;
  const activeVideoId = videoContext ? extractYouTubeVideoId(videoContext.url) : null;
  const videoPlayerWidth = Math.max(200, Math.floor(windowWidth - 28));
  const videoPlayerHeight = Math.max(200, Math.round((videoPlayerWidth * 9) / 16));

  function renderDashboard() {
    return (
      <>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>
            {getObjectiveLabel(user.objective)} | {getEnvironmentLabel(user.trainingEnvironment)}
          </Text>
          <Text style={styles.heroTitle}>{user.name}, seu plano esta ativo.</Text>
          <Text style={styles.heroText}>
            {user.trainingDaysPerWeek} treinos por semana, IMC {user.bmi} ({user.bmiClass}) e
            biblioteca filtrada para {getEnvironmentLabel(user.trainingEnvironment).toLowerCase()}.
          </Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricTitle}>IMC</Text>
            <Text style={styles.metricValue}>{user.bmi.toFixed(1)}</Text>
            <Text style={styles.metricSubtitle}>{user.bmiClass}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricTitle}>Hoje</Text>
            <Text style={styles.metricValue}>{todayCalories} kcal</Text>
            <Text style={styles.metricSubtitle}>
              {todayCompletedExercises.length} exercicios concluidos
            </Text>
          </View>
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.highlightEyebrow}>Meta de peso</Text>
          <Text style={styles.highlightTitle}>{user.targetWeightKg.toFixed(1)} kg</Text>
          <Text style={styles.highlightText}>
            Peso atual {user.weightKg.toFixed(1)} kg. Faltam {remainingDistance.toFixed(1)} kg para
            alcancar a meta.
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progressRatio * 100)}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {Math.round(progressRatio * 100)}% do caminho concluido
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Base usada para montar o treino</Text>
          <Text style={styles.cardBody}>
            {
              exercises.filter(
                (exercise) => exercise.environment === user.trainingEnvironment
              ).length
            }{" "}
            exercicios pre-cadastrados disponiveis para{" "}
            {getEnvironmentLabel(user.trainingEnvironment).toLowerCase()}.
          </Text>
          <Text style={styles.infoNote}>
            Cada treino usa 3 exercicios de cada grupo muscular principal e 1 aerobico, sempre
            puxando opcoes da base compartilhada com o portal do instrutor.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sua divisao atual</Text>
          {workoutPlan.map((workout) => (
            <View key={workout.id} style={styles.labelValue}>
              <Text style={styles.labelValueLabel}>
                {workout.label} | {workout.name}
              </Text>
              <Text style={styles.labelValueValue}>{workout.exercises.length} exercicios</Text>
            </View>
          ))}
        </View>
      </>
    );
  }

  function renderWorkouts() {
    if (!selectedWorkout) {
      return (
        <>
          <View style={[styles.card, styles.highlightCardAlt]}>
            <Text style={styles.cardTitle}>Semana de treinos</Text>
            <Text style={styles.cardBody}>
              {currentWorkoutStatus
                ? `O treino ${currentWorkoutStatus.workoutLabel} esta em andamento nesta semana. Abra a ficha para iniciar ou continuar a sessao.`
                : "Todos os treinos da semana atual foram concluidos."}
            </Text>
            <Text style={styles.infoNote}>
              Os exercicios so aparecem depois que voce abre um treino. Videos, marcacoes e trocas
              ficam liberados apos tocar em Iniciar treino.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selecione o treino</Text>
            <Text style={styles.cardBody}>
              Cada card mostra o status da semana e um resumo da divisao. Toque para abrir a ficha.
            </Text>

            {workoutPlan.length ? (
              workoutPlan.map((workout) => {
                const status = workoutStatusByLabel.get(workout.label);

                return (
                  <Pressable
                    key={workout.id}
                    style={styles.workoutSummaryCard}
                    onPress={() => setSelectedWorkoutId(workout.id)}
                  >
                    <View style={styles.workoutSummaryHeader}>
                      <View style={styles.workoutHeaderLeft}>
                        <Text style={styles.workoutLabel}>Treino {workout.label}</Text>
                        <Text style={styles.workoutTitle}>{workout.name}</Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          status?.status === "concluido"
                            ? styles.statusBadgeDone
                            : status?.status === "em_andamento"
                              ? styles.statusBadgeActive
                              : styles.statusBadgePending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            status?.status === "em_andamento" ? styles.statusBadgeTextActive : null,
                          ]}
                        >
                          {getWorkoutStatusLabel(status?.status ?? "pendente")}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.workoutFocus}>{workout.focus}</Text>
                    <Text style={styles.workoutSummaryText}>
                      {(Array.isArray(workout.muscleGroups) ? workout.muscleGroups : [])
                        .map((group) => MUSCLE_GROUP_LABELS[group])
                        .join(" | ")}
                    </Text>
                    <Text style={styles.workoutSummaryText}>
                      {workout.exercises.length} exercicios planejados
                    </Text>
                  </Pressable>
                );
              })
            ) : (
              <Text style={styles.emptyText}>Nenhum treino disponivel no momento.</Text>
            )}
          </View>
        </>
      );
    }

    const workoutInteractionEnabled =
      selectedWorkoutStatus?.status === "em_andamento" && Boolean(selectedWorkoutStatus.startedAt);
    const canStartWorkout =
      selectedWorkoutStatus?.status === "em_andamento" && !selectedWorkoutStatus.startedAt;
    const canRestartWorkout = selectedWorkoutStatus?.status !== undefined && selectedWorkoutStatus.status !== "pendente";
    const canFinishWorkout = workoutInteractionEnabled;
    const currentWorkoutLabel = currentWorkoutStatus?.workoutLabel ?? null;

    return (
      <>
        <View style={styles.card}>
          <Pressable style={styles.backLink} onPress={() => setSelectedWorkoutId(null)}>
            <Text style={styles.backLinkText}>{"<"} Voltar para os treinos</Text>
          </Pressable>

          <View style={styles.workoutSummaryHeader}>
            <View style={styles.workoutHeaderLeft}>
              <Text style={styles.workoutLabel}>Treino {selectedWorkout.label}</Text>
              <Text style={styles.workoutTitle}>{selectedWorkout.name}</Text>
              <Text style={styles.workoutFocus}>{selectedWorkout.focus}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                selectedWorkoutStatus?.status === "concluido"
                  ? styles.statusBadgeDone
                  : selectedWorkoutStatus?.status === "em_andamento"
                    ? styles.statusBadgeActive
                    : styles.statusBadgePending,
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  selectedWorkoutStatus?.status === "em_andamento"
                    ? styles.statusBadgeTextActive
                    : null,
                ]}
              >
                {getWorkoutStatusLabel(selectedWorkoutStatus?.status ?? "pendente")}
              </Text>
            </View>
          </View>

          <View style={styles.tagsRow}>
            {(Array.isArray(selectedWorkout.muscleGroups) ? selectedWorkout.muscleGroups : []).map(
              (group) => (
                <View key={`${selectedWorkout.id}-${group}`} style={styles.pill}>
                  <Text style={styles.pillText}>{MUSCLE_GROUP_LABELS[group]}</Text>
                </View>
              )
            )}
          </View>

          <Text style={styles.workoutGuidance}>{selectedWorkout.guidance}</Text>

          {selectedWorkoutStatus?.status === "pendente" ? (
            <Text style={styles.infoNote}>
              Esse treino ainda nao esta liberado. Finalize primeiro o treino{" "}
              {currentWorkoutLabel ?? "atual"} para avancar a semana.
            </Text>
          ) : selectedWorkoutStatus?.status === "concluido" ? (
            <Text style={styles.infoNote}>
              Esse treino ja foi concluido nesta semana. Toque em Reiniciar treino para refazer a
              sessao de hoje.
            </Text>
          ) : canStartWorkout ? (
            <Text style={styles.infoNote}>
              Toque em Iniciar treino para liberar videos, trocas de exercicio e marcacao das
              series.
            </Text>
          ) : (
            <Text style={styles.infoNote}>
              Treino iniciado. Marque o que foi realizado e finalize quando quiser encerrar a
              sessao, mesmo que nem todos os exercicios tenham sido concluidos.
            </Text>
          )}

          <View style={styles.buttonRow}>
            {canStartWorkout ? (
              <ActionButton
                label="Iniciar treino"
                onPress={() => void handleStartWorkoutSession(selectedWorkout.id, selectedWorkout.label)}
                disabled={busy}
              />
            ) : null}
            {canRestartWorkout ? (
              <ActionButton
                label="Reiniciar treino"
                onPress={() =>
                  void handleRestartWorkoutSession(selectedWorkout.id, selectedWorkout.label)
                }
                secondary
                disabled={busy}
              />
            ) : null}
          </View>
        </View>

        {(Array.isArray(selectedWorkout.exercises) ? selectedWorkout.exercises : []).map((slot) => {
          const exercise = exercisesById.get(slot.exerciseId);
          if (!exercise) {
            return null;
          }

          const setRows =
            Array.isArray(slot.sets) && slot.sets.length
              ? slot.sets
              : buildFallbackSetRows(slot.muscleGroup, slot.slotId, user.objective);
          const restSeconds = typeof slot.restSeconds === "number" ? slot.restSeconds : 60;
          const completionKey = getCompletionKey({
            date: todayKey,
            workoutId: selectedWorkout.id,
            exerciseId: exercise.id,
          });
          const completionEntry = completionByKey.get(completionKey);
          const completedSetIds = completionEntry?.completedSetIds ?? [];
          const allSetIds = setRows.map((set) => set.id);
          const done =
            allSetIds.length > 0 && allSetIds.every((setId) => completedSetIds.includes(setId));
          const partiallyDone = !done && completedSetIds.length > 0;

          return (
            <View
              key={slot.slotId}
              style={[
                styles.exerciseItem,
                done ? styles.exerciseItemDone : null,
                partiallyDone ? styles.exerciseItemPartial : null,
                !workoutInteractionEnabled ? styles.exerciseItemLocked : null,
              ]}
            >
              <View style={styles.exerciseTop}>
                <View style={styles.exerciseInfo}>
                  <Text style={styles.exerciseName}>{exercise.name}</Text>
                  <Text style={styles.exerciseMeta}>
                    {MUSCLE_GROUP_LABELS[exercise.muscleGroup]} | {exercise.equipment} |{" "}
                    {exercise.calories} kcal
                  </Text>
                  <Text style={styles.exerciseDescription}>{exercise.description}</Text>
                </View>
              </View>

              <View style={styles.seriesTable}>
                <View style={styles.seriesHeaderRow}>
                  <View style={styles.seriesHeaderCellBadge}>
                    <Text style={styles.seriesHeaderText}>Serie</Text>
                  </View>
                  <View style={styles.seriesHeaderCellInput}>
                    <Text style={styles.seriesHeaderText}>Repeticoes</Text>
                  </View>
                  <View style={styles.seriesHeaderCellInput}>
                    <Text style={styles.seriesHeaderText}>Carga</Text>
                  </View>
                  <View style={styles.seriesHeaderCellAction}>
                    <Text style={styles.seriesHeaderText}>OK</Text>
                  </View>
                </View>

                {setRows.map((set) => (
                  <View
                    key={set.id}
                    style={[
                      styles.seriesRow,
                      completedSetIds.includes(set.id) ? styles.seriesRowDone : null,
                    ]}
                  >
                    <View style={styles.seriesBadge}>
                      <Text style={styles.seriesBadgeText}>{set.label}</Text>
                    </View>
                    <TextInput
                      style={styles.seriesInput}
                      value={getDraftForSet(set).repetitions}
                      editable={!busy && workoutInteractionEnabled}
                      onChangeText={(value) => updateSetDraft(set, "repetitions", value)}
                      onBlur={() => {
                        void handleSaveWorkoutSet(selectedWorkout.id, slot.slotId, set);
                      }}
                    />
                    <TextInput
                      style={styles.seriesInput}
                      value={getDraftForSet(set).load}
                      placeholder="kg"
                      placeholderTextColor="#aa9d91"
                      editable={!busy && workoutInteractionEnabled}
                      onChangeText={(value) => updateSetDraft(set, "load", value)}
                      onBlur={() => {
                        void handleSaveWorkoutSet(selectedWorkout.id, slot.slotId, set);
                      }}
                    />
                    <Pressable
                      style={[
                        styles.seriesToggleButton,
                        completedSetIds.includes(set.id) ? styles.seriesToggleButtonDone : null,
                      ]}
                      onPress={() =>
                        void handleToggleWorkoutSet(
                          selectedWorkout.id,
                          exercise.id,
                          set.id,
                          completedSetIds,
                          allSetIds
                        )
                      }
                      disabled={busy || !workoutInteractionEnabled}
                    >
                      <Text
                        style={[
                          styles.seriesToggleText,
                          completedSetIds.includes(set.id) ? styles.seriesToggleTextDone : null,
                        ]}
                      >
                        {"\u2713"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>

              <Text style={styles.seriesFootnote}>
                Descanso sugerido: {formatRestLabel(restSeconds)} entre series.
              </Text>

              <View style={styles.exerciseButtons}>
                <ActionButton
                  label="Video"
                  onPress={() =>
                    setVideoContext({
                      title: exercise.name,
                      url: exercise.videoUrl,
                    })
                  }
                  secondary
                  disabled={busy || !workoutInteractionEnabled}
                  compact
                />
                <ActionButton
                  label={done ? "Limpar" : "Todas"}
                  onPress={() =>
                    void handleToggleAllWorkoutSets(
                      selectedWorkout.id,
                      exercise.id,
                      allSetIds,
                      done
                    )
                  }
                  disabled={busy || !workoutInteractionEnabled}
                  compact
                />
                <ActionButton
                  label="Trocar"
                  onPress={() =>
                    setReplacementContext({
                      workoutId: selectedWorkout.id,
                      slotId: slot.slotId,
                      exerciseId: exercise.id,
                      muscleGroup: slot.muscleGroup,
                    })
                  }
                  secondary
                  disabled={busy || !workoutInteractionEnabled}
                  compact
                />
              </View>
            </View>
          );
        })}

        {canFinishWorkout ? (
          <View style={styles.card}>
            <View style={styles.buttonRow}>
              <ActionButton
                label="Finalizar treino"
                onPress={() => void handleFinishWorkoutSession(selectedWorkout.id, selectedWorkout.label)}
                disabled={busy}
              />
              <ActionButton
                label="Reiniciar treino"
                onPress={() =>
                  void handleRestartWorkoutSession(selectedWorkout.id, selectedWorkout.label)
                }
                secondary
                disabled={busy}
              />
            </View>
          </View>
        ) : null}
      </>
    );
  }

  function renderProgress() {
    return (
      <>
        <View style={styles.card}>
          <Text style={styles.highlightEyebrow}>Peso</Text>
          <Text style={styles.goalHeadline}>{user.weightKg.toFixed(1)} kg</Text>
          <Text style={styles.highlightText}>
            Registrado hoje: {formatDateLabel(todayKey)}. A ficha usa esse peso para recalcular IMC
            e orientar o treino.
          </Text>
          <View style={{ flex: 1, minWidth: 180 }}>
            <LabeledInput
              label="Atualizar pesagem diaria"
              value={weightInput}
              keyboardType="decimal-pad"
              onChangeText={setWeightInput}
            />
          </View>
          <View style={styles.buttonRow}>
            <ActionButton label="Salvar pesagem" onPress={() => void handleSaveWeight()} disabled={busy} />
          </View>
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.highlightEyebrow}>Evolucao da meta</Text>
          <Text style={styles.highlightTitle}>{remainingDistance.toFixed(1)} kg restantes</Text>
          <Text style={styles.highlightText}>
            Inicio em {startingWeight.toFixed(1)} kg, meta em {user.targetWeightKg.toFixed(1)} kg.
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progressRatio * 100)}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {Math.round(progressRatio * 100)}% da meta concluida
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Peso por dia</Text>
          {recentWeights.length ? (
            recentWeights.map((entry) => (
              <View key={entry.id} style={styles.chartRow}>
                <View style={styles.chartLabelRow}>
                  <Text style={styles.chartLabel}>{formatDateLabel(entry.date)}</Text>
                  <Text style={styles.chartValue}>{entry.weightKg.toFixed(1)} kg</Text>
                </View>
                <View style={styles.chartTrack}>
                  <View
                    style={[
                      styles.chartFill,
                      {
                        width: `${Math.max(
                          8,
                          Math.round(
                            (entry.weightKg /
                              Math.max(startingWeight, user.weightKg, user.targetWeightKg)) *
                              100
                          )
                        )}%`,
                        backgroundColor: "#e86b35",
                      },
                    ]}
                  />
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Nenhuma pesagem registrada ainda.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Calorias registradas</Text>
          {recentCalories.length ? (
            recentCalories.map(([date, calories]) => (
              <View key={date} style={styles.labelValue}>
                <Text style={styles.labelValueLabel}>{formatDateLabel(date)}</Text>
                <Text style={styles.labelValueValue}>{calories} kcal</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>
              Marque os exercicios como realizados para acompanhar o gasto diario.
            </Text>
          )}
        </View>
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <View style={[styles.card, styles.highlightCardAlt]}>
          <Text style={styles.cardTitle}>Resumo do perfil</Text>
          <Text style={styles.cardBody}>
            {user.email} | {getObjectiveLabel(user.objective)} |{" "}
            {getEnvironmentLabel(user.trainingEnvironment)} | {getLevelLabel(user.level)}
          </Text>
          <Text style={styles.infoNote}>
            Cadastro criado em {formatDateLabel(user.createdAt.slice(0, 10))}. O portal web usa a
            mesma base SQLite.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Editar cadastro</Text>
            <Text style={styles.sectionSubtitle}>
              Altere objetivo, ambiente, frequencia e dados fisicos quando precisar.
            </Text>
          </View>

          <UserFormFields form={profileForm} onChange={updateProfileForm} />

          <View style={styles.buttonRow}>
            <ActionButton label="Salvar perfil" onPress={() => void handleSaveProfile()} disabled={busy} />
            <ActionButton
              label="Recalcular treino"
              onPress={() => void handleRecalculateWorkout()}
              secondary
              disabled={busy}
            />
          </View>
          <View style={styles.buttonRow}>
            <ActionButton label="Sair da conta" onPress={() => void handleLogout()} secondary disabled={busy} />
          </View>
        </View>
      </>
    );
  }

  const tabTitles: Record<TabKey, { title: string; subtitle: string }> = {
    dashboard: {
      title: "Resumo diario",
      subtitle: "Meta, IMC, calorias e visao geral do plano.",
    },
    workouts: {
      title: "Treinos",
      subtitle: "Resumo semanal, inicio da sessao e conclusao do proximo treino.",
    },
    progress: {
      title: "Progresso",
      subtitle: "Pesagem diaria e calorias registradas.",
    },
    profile: {
      title: "Perfil",
      subtitle: "Edite o cadastro sempre que precisar.",
    },
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.appHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>FatBurn</Text>
            <Text style={styles.headerTitle}>{tabTitles[activeTab].title}</Text>
            <Text style={styles.headerSubtitle}>{tabTitles[activeTab].subtitle}</Text>
          </View>
          <Pressable style={styles.headerAction} onPress={() => void refreshCurrentUser()}>
            <Text style={styles.headerActionText}>{busy ? "..." : "Sincronizar"}</Text>
          </Pressable>
        </View>

        {serverHealthy === false ? (
          <View style={[styles.card, styles.highlightCard]}>
            <Text style={styles.cardTitle}>Servidor offline</Text>
            <Text style={styles.cardBody}>
              O app precisa do servidor local para login, banco SQLite e portal do instrutor. API
              atual: {API_BASE_URL}
            </Text>
          </View>
        ) : null}

        {activeTab === "dashboard" ? renderDashboard() : null}
        {activeTab === "workouts" ? renderWorkouts() : null}
        {activeTab === "progress" ? renderProgress() : null}
        {activeTab === "profile" ? renderProfile() : null}
      </ScrollView>

      <View style={styles.tabBar}>
        {TAB_ITEMS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Modal
        animationType="slide"
        transparent
        visible={replacementContext !== null}
        onRequestClose={() => setReplacementContext(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Trocar exercicio</Text>
            <Text style={styles.modalSubtitle}>
              Sugestoes do mesmo grupo muscular para{" "}
              {getEnvironmentLabel(user.trainingEnvironment).toLowerCase()}.
            </Text>

            <ScrollView style={styles.modalScroll}>
              {fallbackReplacementOptions.length ? (
                fallbackReplacementOptions.map((exercise) => (
                  <Pressable
                    key={exercise.id}
                    style={styles.replacementItem}
                    onPress={() => void handleReplaceExercise(exercise.id)}
                  >
                    <Text style={styles.replacementTitle}>{exercise.name}</Text>
                    <Text style={styles.replacementText}>
                      {MUSCLE_GROUP_LABELS[exercise.muscleGroup]} | {exercise.equipment} |{" "}
                      {exercise.calories} kcal
                    </Text>
                    <Text style={styles.replacementText}>{exercise.description}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  Nao ha outra opcao compativel cadastrada para esse grupo no ambiente escolhido.
                </Text>
              )}
            </ScrollView>

            <View style={styles.buttonRow}>
              <ActionButton
                label="Fechar"
                onPress={() => setReplacementContext(null)}
                secondary
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        visible={videoContext !== null}
        onRequestClose={() => setVideoContext(null)}
      >
        <View style={styles.videoScreen}>
          <View style={styles.videoScreenHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.videoScreenTitle}>Video do exercicio</Text>
              <Text style={styles.videoScreenSubtitle}>{videoContext?.title ?? ""}</Text>
            </View>
            <Pressable style={styles.videoScreenClose} onPress={() => setVideoContext(null)}>
              <Text style={styles.videoScreenCloseText}>Fechar</Text>
            </Pressable>
          </View>

          <View style={styles.videoScreenFrame}>
            {videoContext ? (
              activeVideoId ? (
                <YoutubePlayer
                  key={activeVideoId}
                  height={videoPlayerHeight}
                  width={videoPlayerWidth}
                  videoId={activeVideoId}
                  play
                  useLocalHTML={false}
                  initialPlayerParams={{
                    controls: true,
                    rel: false,
                    loop: false,
                  }}
                  webViewStyle={styles.videoWebView}
                  webViewProps={{
                    allowsFullscreenVideo: true,
                    cacheEnabled: false,
                  }}
                  onError={(error: string) => {
                    Alert.alert("Video indisponivel", `O player retornou: ${error}`);
                  }}
                />
              ) : (
                <WebView
                  key={videoContext.url}
                  source={{
                    html: buildDirectVideoHtml(videoContext.url),
                  }}
                  style={styles.videoWebView}
                  originWhitelist={["*"]}
                  javaScriptEnabled
                  domStorageEnabled
                  allowsFullscreenVideo
                  allowsInlineMediaPlayback
                  setSupportMultipleWindows={false}
                  mediaPlaybackRequiresUserAction={false}
                  startInLoadingState
                  cacheEnabled={false}
                  scrollEnabled={false}
                  bounces={false}
                />
              )
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

