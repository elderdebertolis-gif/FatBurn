import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  useFonts,
} from "@expo-google-fonts/space-grotesk";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import YoutubePlayer from "react-native-youtube-iframe";
import {
  acceptPrivacyConsents,
  API_BASE_URL,
  AuthenticatedUserSession,
  deleteMyAccount,
  exportMyData,
  finishWorkout,
  UserBundle,
  UserPayload,
  checkServerHealth,
  fetchUserBundle,
  loginUser,
  logoutUser,
  requestPasswordReset,
  registerUser,
  resetPasswordWithCode,
  replaceWorkoutExercise,
  restartWorkout,
  saveDailyWeight,
  setSessionToken,
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

const SESSION_KEY = "@fatburn/current-session";

const TAB_ITEMS = [
  { key: "dashboard", label: "Resumo", icon: "view-dashboard-outline" },
  { key: "workouts", label: "Treinos", icon: "dumbbell" },
  { key: "progress", label: "Evolucao", icon: "chart-line" },
  { key: "profile", label: "Perfil", icon: "account-outline" },
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

const BRAND_LOGO_HORIZONTAL = require("./assets/branding/logo-horizontal-dark.png");
const APP_VERSION = "1.0.1";
const ANDROID_TOP_OFFSET = Platform.OS === "android" ? NativeStatusBar.currentHeight ?? 0 : 0;
const TAB_BAR_OFFSET = Platform.OS === "android" ? 18 : 12;

type TabKey = (typeof TAB_ITEMS)[number]["key"];
type AuthMode = "login" | "register";
type NoticeTone = "info" | "success" | "error";
type PasswordResetStep = "request" | "confirm";

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
type NoticeState = { title: string; message: string; tone: NoticeTone } | null;

type ApiError = Error & { message: string };
type SetDraftMap = Record<string, { repetitions: string; load: string }>;
type StoredSession = { token: string; userId: string };

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
    password: "",
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

function validateForm(form: ProfileFormState, options?: { requirePassword?: boolean }): string | null {
  if (!form.name.trim()) return "Informe o nome.";
  if (!form.email.trim() || !form.email.includes("@")) return "Informe um email valido.";
  if (options?.requirePassword && (!form.password.trim() || form.password.trim().length < 8)) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }
  if (!options?.requirePassword && form.password.trim() && form.password.trim().length < 8) {
    return "A nova senha deve ter pelo menos 8 caracteres.";
  }
  if (!Number.isFinite(normalizeNumber(form.age)) || normalizeNumber(form.age) < 18) {
    return "O cadastro requer usuario com 18 anos ou mais.";
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

function validateMatchingPasswords(password: string, confirmPassword: string): string | null {
  if (!confirmPassword.trim()) {
    return "Confirme a senha para continuar.";
  }

  if (password.trim() !== confirmPassword.trim()) {
    return "As senhas digitadas nao coincidem.";
  }

  return null;
}

function formToPayload(form: ProfileFormState): UserPayload {
  return {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    ...(form.password.trim() ? { password: form.password.trim() } : {}),
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

type BrandIconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function BrandWordmark({
  compact,
  centered,
}: {
  compact?: boolean;
  centered?: boolean;
}) {
  return (
    <Image
      source={BRAND_LOGO_HORIZONTAL}
      resizeMode="contain"
      style={[
        styles.brandHorizontal,
        compact ? styles.brandHorizontalCompact : null,
        centered ? styles.brandHorizontalCentered : null,
      ]}
    />
  );
}

function MetricChip({
  label,
  icon = "fire",
}: {
  label: string;
  icon?: BrandIconName;
}) {
  return (
    <View style={styles.metricChip}>
      <MaterialCommunityIcons name={icon} size={15} color="#ff6a00" />
      <Text style={styles.metricChipText}>{label}</Text>
    </View>
  );
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
  actionLabel,
  onActionPress,
  ...props
}: {
  label: string;
  multiline?: boolean;
  actionLabel?: string;
  onActionPress?: () => void;
} & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {actionLabel && onActionPress && !multiline ? (
        <View style={styles.inputRow}>
          <TextInput
            placeholderTextColor="#6f6f6f"
            style={[styles.input, styles.inputControl]}
            multiline={multiline}
            {...props}
          />
          <Pressable style={styles.inputActionButton} onPress={onActionPress}>
            <Text style={styles.inputActionText}>{actionLabel}</Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          placeholderTextColor="#6f6f6f"
          style={[styles.input, multiline ? styles.inputMultiline : null]}
          multiline={multiline}
          {...props}
        />
      )}
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
      {secondary ? (
        <Text
          style={[
            styles.buttonText,
            compact ? styles.buttonTextCompact : null,
            styles.buttonSecondaryText,
          ]}
        >
          {label}
        </Text>
      ) : (
        <LinearGradient
          colors={["#ff9d00", "#ff5a00"] as const}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.buttonFill}
        >
          <Text
            style={[
              styles.buttonText,
              compact ? styles.buttonTextCompact : null,
              styles.buttonPrimaryText,
            ]}
          >
            {label}
          </Text>
        </LinearGradient>
      )}
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

function ToggleCheck({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.checkRow} onPress={onPress}>
      <View style={[styles.checkBox, checked ? styles.checkBoxActive : null]}>
        {checked ? (
          <MaterialCommunityIcons name="check" size={16} color="#1A1A1A" />
        ) : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

function UserFormFields({
  form,
  onChange,
  passwordLabel,
  passwordVisible,
  onTogglePasswordVisibility,
  afterPasswordField,
}: {
  form: ProfileFormState;
  onChange: <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => void;
  passwordLabel?: string;
  passwordVisible?: boolean;
  onTogglePasswordVisibility?: () => void;
  afterPasswordField?: React.ReactNode;
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
        label={passwordLabel ?? "Senha"}
        value={form.password}
        secureTextEntry={!passwordVisible}
        actionLabel={passwordVisible ? "Ocultar" : "Mostrar"}
        onActionPress={onTogglePasswordVisibility}
        onChangeText={(value) => onChange("password", value)}
      />
      {afterPasswordField ?? null}
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
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [bundle, setBundle] = useState<UserBundle | null>(null);
  const [serverHealthy, setServerHealthy] = useState<boolean | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [registerForm, setRegisterForm] = useState<ProfileFormState>(createEmptyForm());
  const [registerPasswordVisible, setRegisterPasswordVisible] = useState(false);
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [registerConfirmPasswordVisible, setRegisterConfirmPasswordVisible] = useState(false);
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = useState(false);
  const [acceptedSensitiveConsent, setAcceptedSensitiveConsent] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(createEmptyForm());
  const [profilePasswordVisible, setProfilePasswordVisible] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [replacementContext, setReplacementContext] = useState<ReplacementContext>(null);
  const [videoContext, setVideoContext] = useState<VideoContext>(null);
  const [setDrafts, setSetDrafts] = useState<SetDraftMap>({});
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetStep, setPasswordResetStep] = useState<PasswordResetStep>("request");
  const [passwordResetEmail, setPasswordResetEmail] = useState("");
  const [passwordResetCode, setPasswordResetCode] = useState("");
  const [passwordResetPassword, setPasswordResetPassword] = useState("");
  const [passwordResetPasswordVisible, setPasswordResetPasswordVisible] = useState(false);
  const [passwordResetConfirmPassword, setPasswordResetConfirmPassword] = useState("");
  const [passwordResetConfirmPasswordVisible, setPasswordResetConfirmPasswordVisible] =
    useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const authScrollRef = useRef<ScrollView | null>(null);
  const appScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    void runConnectionGate();
  }, []);

  useEffect(() => {
    if (!bundle) {
      return;
    }
    setProfileForm(buildFormFromUser(bundle.user));
    setProfilePasswordVisible(false);
    setWeightInput(String(bundle.user.weightKg));
    setSetDrafts({});
    setProfileEditorOpen(false);
    setSelectedWorkoutId((current) =>
      current && bundle.user.workoutPlan?.some((workout) => workout.id === current) ? current : null
    );
  }, [bundle]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      authScrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });

    return () => cancelAnimationFrame(timer);
  }, [authMode]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      appScrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });

    return () => cancelAnimationFrame(timer);
  }, [activeTab, selectedWorkoutId]);

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

  function readStoredSession(rawValue: string | null): StoredSession | null {
    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as StoredSession;
      if (!parsed?.token || !parsed?.userId) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function restoreStoredSession() {
    const storedSession = readStoredSession(await AsyncStorage.getItem(SESSION_KEY));
    if (!storedSession) {
      return;
    }

    try {
      setSessionToken(storedSession.token);
      const nextBundle = await fetchUserBundle(storedSession.userId);
      setBundle(nextBundle);
      setProfileForm(buildFormFromUser(nextBundle.user));
      setWeightInput(String(nextBundle.user.weightKg));
      setSessionError("");
    } catch (error) {
      setSessionToken(null);
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
      setSessionToken(null);
      await AsyncStorage.removeItem(SESSION_KEY);
      setBundle(null);
    }

    setBooting(false);
    setBusy(false);
  }

  async function persistBundle(nextBundle: UserBundle) {
    setBundle(nextBundle);
    const storedSession = readStoredSession(await AsyncStorage.getItem(SESSION_KEY));
    if (storedSession) {
      await AsyncStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...storedSession, userId: nextBundle.user.id })
      );
    }
  }

  async function persistAuthenticatedSession(nextSession: AuthenticatedUserSession) {
    setSessionToken(nextSession.token);
    setBundle(nextSession.bundle);
    await AsyncStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: nextSession.token,
        userId: nextSession.bundle.user.id,
      } satisfies StoredSession)
    );
  }

  async function clearStoredSession() {
    setSessionToken(null);
    await AsyncStorage.removeItem(SESSION_KEY);
  }

  function openPasswordResetModal() {
    setPasswordResetEmail(loginEmail.trim().toLowerCase());
    setPasswordResetCode("");
    setPasswordResetPassword("");
    setPasswordResetConfirmPassword("");
    setPasswordResetPasswordVisible(false);
    setPasswordResetConfirmPasswordVisible(false);
    setPasswordResetStep("request");
    setPasswordResetOpen(true);
  }

  function closePasswordResetModal() {
    setPasswordResetOpen(false);
    setPasswordResetCode("");
    setPasswordResetPassword("");
    setPasswordResetConfirmPassword("");
    setPasswordResetPasswordVisible(false);
    setPasswordResetConfirmPasswordVisible(false);
    setPasswordResetStep("request");
  }

  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setNotice({ title: "Entrar", message: "Preencha email e senha.", tone: "error" });
      return;
    }

    setBusy(true);
    try {
      const nextSession = await loginUser(loginEmail.trim(), loginPassword.trim());
      await persistAuthenticatedSession(nextSession);
      setActiveTab("dashboard");
      setPasswordResetOpen(false);
      setLoginPassword("");
      setLoginPasswordVisible(false);
      setSessionError("");
    } catch (error) {
      setNotice({
        title: "Erro ao entrar",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    const validationError = validateForm(registerForm, { requirePassword: true });
    if (validationError) {
      setNotice({ title: "Cadastro", message: validationError, tone: "error" });
      return;
    }

    const passwordValidation = validateMatchingPasswords(
      registerForm.password,
      registerConfirmPassword
    );
    if (passwordValidation) {
      setNotice({ title: "Cadastro", message: passwordValidation, tone: "error" });
      return;
    }

    if (!acceptedPrivacyPolicy || !acceptedSensitiveConsent) {
      setNotice({
        title: "Privacidade",
        message: "Aceite o aviso de privacidade e o tratamento de dados de saude para continuar.",
        tone: "error",
      });
      return;
    }

    setBusy(true);
    try {
      const nextSession = await registerUser({
        ...formToPayload(registerForm),
        acceptedPrivacyPolicy,
        acceptedSensitiveDataConsent: acceptedSensitiveConsent,
      });
      await persistAuthenticatedSession(nextSession);
      setRegisterForm(createEmptyForm());
      setRegisterPasswordVisible(false);
      setRegisterConfirmPassword("");
      setRegisterConfirmPasswordVisible(false);
      setAcceptedPrivacyPolicy(false);
      setAcceptedSensitiveConsent(false);
      setActiveTab("dashboard");
      setAuthMode("login");
      setSessionError("");
    } catch (error) {
      setNotice({
        title: "Erro ao cadastrar",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } catch {
      // Mantem logout local mesmo se a sessao ja tiver expirado no servidor.
    }
    await clearStoredSession();
    setBundle(null);
    setLoginEmail("");
    setLoginPassword("");
    setLoginPasswordVisible(false);
    setAuthMode("login");
    setActiveTab("dashboard");
    setSelectedWorkoutId(null);
  }

  async function handleSaveProfile() {
    if (!bundle) {
      return;
    }

    const validationError = validateForm(profileForm);
    if (validationError) {
      setNotice({ title: "Perfil", message: validationError, tone: "error" });
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await updateUserProfile(bundle.user.id, formToPayload(profileForm));
      await persistBundle(nextBundle);
      setSessionError("");
      setProfileEditorOpen(false);
      setProfileForm((current) => ({ ...current, password: "" }));
      setProfilePasswordVisible(false);
      setNotice({
        title: "Perfil atualizado",
        message: "Cadastro salvo e treino recalculado.",
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Erro ao salvar",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestPasswordReset() {
    const email = passwordResetEmail.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      setNotice({
        title: "Recuperacao de senha",
        message: "Informe o email cadastrado para receber o codigo.",
        tone: "error",
      });
      return;
    }

    setBusy(true);
    try {
      const response = await requestPasswordReset(email);
      setPasswordResetEmail(email);
      setPasswordResetStep("confirm");
      setNotice({
        title: "Codigo enviado",
        message: response.message,
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Recuperacao de senha",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPasswordReset() {
    const email = passwordResetEmail.trim().toLowerCase();
    const code = passwordResetCode.trim();

    if (!email || !email.includes("@")) {
      setNotice({
        title: "Redefinir senha",
        message: "Informe o email cadastrado para concluir a redefinicao.",
        tone: "error",
      });
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setNotice({
        title: "Redefinir senha",
        message: "Informe o codigo de 6 digitos enviado por email.",
        tone: "error",
      });
      return;
    }

    if (passwordResetPassword.trim().length < 8) {
      setNotice({
        title: "Redefinir senha",
        message: "A nova senha deve ter pelo menos 8 caracteres.",
        tone: "error",
      });
      return;
    }

    const passwordValidation = validateMatchingPasswords(
      passwordResetPassword,
      passwordResetConfirmPassword
    );
    if (passwordValidation) {
      setNotice({
        title: "Redefinir senha",
        message: passwordValidation,
        tone: "error",
      });
      return;
    }

    setBusy(true);
    try {
      const response = await resetPasswordWithCode(email, code, passwordResetPassword.trim());
      closePasswordResetModal();
      setLoginEmail(email);
      setLoginPassword("");
      setNotice({
        title: "Senha redefinida",
        message: response.message,
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Redefinir senha",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptPrivacyConsent() {
    setBusy(true);
    try {
      const response = await acceptPrivacyConsents();
      await persistBundle(response.bundle);
      setNotice({
        title: "Privacidade atualizada",
        message: "Consentimentos registrados. Voce ja pode usar o app normalmente.",
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Nao foi possivel registrar",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPrivacyData() {
    setBusy(true);
    try {
      const payload = await exportMyData();
      await Share.share({
        title: "Exportacao de dados FatBurn",
        message: JSON.stringify(payload, null, 2),
      });
    } catch (error) {
      setNotice({
        title: "Exportacao",
        message: (error as ApiError).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount() {
    setBusy(true);
    try {
      await deleteMyAccount();
      await clearStoredSession();
      setBundle(null);
      setDeleteConfirmOpen(false);
      setNotice({
        title: "Conta excluida",
        message: "Seus dados foram removidos do aplicativo atual.",
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Erro ao excluir conta",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({ title: "Pesagem", message: "Informe um peso valido.", tone: "error" });
      return;
    }

    setBusy(true);
    try {
      const nextBundle = await saveDailyWeight(bundle.user.id, weightKg, getDayKey());
      await persistBundle(nextBundle);
      setNotice({
        title: "Pesagem salva",
        message: "A evolucao diaria foi atualizada.",
        tone: "success",
      });
    } catch (error) {
      setNotice({
        title: "Erro ao salvar peso",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Erro ao registrar exercicio",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Erro ao trocar exercicio",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Erro ao salvar serie",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Nao foi possivel iniciar",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Nao foi possivel finalizar",
        message: (error as ApiError).message,
        tone: "error",
      });
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
      setNotice({
        title: "Nao foi possivel reiniciar",
        message: (error as ApiError).message,
        tone: "error",
      });
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

  function renderNoticeModal() {
    return (
      <Modal
        animationType="fade"
        transparent
        visible={notice !== null}
        onRequestClose={() => setNotice(null)}
      >
        <View style={styles.dialogOverlay}>
          <View
            style={[
              styles.dialogCard,
              notice?.tone === "error"
                ? styles.dialogCardError
                : notice?.tone === "success"
                  ? styles.dialogCardSuccess
                  : null,
            ]}
          >
            <Text style={styles.dialogTitle}>{notice?.title ?? ""}</Text>
            <Text style={styles.dialogText}>{notice?.message ?? ""}</Text>
            <View style={styles.dialogActions}>
              <ActionButton label="Entendi" onPress={() => setNotice(null)} compact />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderPrivacyNoticeModal() {
    const consentInfo = bundle?.user.consents;
    const policyVersion = consentInfo?.privacyPolicyVersion ?? "2026.05";
    const sensitiveVersion = consentInfo?.sensitiveConsentVersion ?? "2026.05";

    return (
      <Modal
        animationType="slide"
        transparent
        visible={privacyNoticeOpen}
        onRequestClose={() => setPrivacyNoticeOpen(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={[styles.dialogCard, styles.privacyDialogCard]}>
            <Text style={styles.dialogTitle}>Aviso de privacidade</Text>
            <ScrollView style={styles.privacyDialogScroll}>
              <Text style={styles.dialogText}>
                Controlador: FatBurn. Este app trata dados cadastrais e dados de saude usados para
                montar treino, calcular IMC e acompanhar evolucao fisica.
              </Text>
              <Text style={styles.dialogText}>
                Finalidades: autenticar sua conta, montar e recalcular sua ficha, registrar peso,
                calorias, series realizadas e disponibilizar gestao ao instrutor autorizado.
              </Text>
              <Text style={styles.dialogText}>
                Dados tratados: nome, email, idade, sexo biologico, altura, peso, meta,
                restricoes, ambiente de treino, frequencia, nivel, historico de peso e treino.
              </Text>
              <Text style={styles.dialogText}>
                Seus direitos: acessar, corrigir, exportar e excluir os dados pelo proprio app. Ao
                revogar o tratamento sensivel, o uso do app deixa de ser viavel para a finalidade
                principal de treino e acompanhamento.
              </Text>
              <Text style={styles.infoNote}>Versao da politica: {policyVersion}</Text>
              <Text style={styles.infoNote}>Versao do consentimento sensivel: {sensitiveVersion}</Text>
            </ScrollView>
            <View style={styles.dialogActions}>
              <ActionButton label="Fechar" onPress={() => setPrivacyNoticeOpen(false)} compact />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderPasswordResetModal() {
    return (
      <Modal
        animationType="fade"
        transparent
        visible={passwordResetOpen}
        onRequestClose={closePasswordResetModal}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>
              {passwordResetStep === "request" ? "Esqueci minha senha" : "Redefinir senha"}
            </Text>
            <Text style={styles.dialogText}>
              {passwordResetStep === "request"
                ? "Informe o email cadastrado para receber um codigo de redefinicao."
                : "Digite o codigo enviado por email e escolha sua nova senha."}
            </Text>
            <View style={{ marginTop: 14 }}>
              <LabeledInput
                label="Email"
                value={passwordResetEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={passwordResetStep === "request"}
                onChangeText={setPasswordResetEmail}
              />
              {passwordResetStep === "confirm" ? (
                <>
                  <LabeledInput
                    label="Codigo"
                    value={passwordResetCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={setPasswordResetCode}
                  />
                  <LabeledInput
                    label="Nova senha"
                    value={passwordResetPassword}
                    secureTextEntry={!passwordResetPasswordVisible}
                    actionLabel={passwordResetPasswordVisible ? "Ocultar" : "Mostrar"}
                    onActionPress={() =>
                      setPasswordResetPasswordVisible((current) => !current)
                    }
                    onChangeText={setPasswordResetPassword}
                  />
                  <LabeledInput
                    label="Confirmar nova senha"
                    value={passwordResetConfirmPassword}
                    secureTextEntry={!passwordResetConfirmPasswordVisible}
                    actionLabel={passwordResetConfirmPasswordVisible ? "Ocultar" : "Mostrar"}
                    onActionPress={() =>
                      setPasswordResetConfirmPasswordVisible((current) => !current)
                    }
                    onChangeText={setPasswordResetConfirmPassword}
                  />
                </>
              ) : null}
            </View>
            <View style={styles.dialogActions}>
              {passwordResetStep === "confirm" ? (
                <ActionButton
                  label="Voltar"
                  onPress={() => setPasswordResetStep("request")}
                  secondary
                  compact
                />
              ) : (
                <ActionButton
                  label="Fechar"
                  onPress={closePasswordResetModal}
                  secondary
                  compact
                />
              )}
              <ActionButton
                label={passwordResetStep === "request" ? "Enviar codigo" : "Salvar senha"}
                onPress={() =>
                  void (
                    passwordResetStep === "request"
                      ? handleRequestPasswordReset()
                      : handleConfirmPasswordReset()
                  )
                }
                compact
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  function renderConsentGate() {
    if (!bundle || bundle.user.consents.accepted) {
      return null;
    }

    return (
      <SafeAreaView style={[styles.safeArea, { paddingTop: ANDROID_TOP_OFFSET }]}>
        <StatusBar style="light" translucent={false} backgroundColor="#1A1A1A" />
        <ScrollView contentContainerStyle={styles.authScreen}>
          <View style={styles.authHeroPanel}>
            <BrandWordmark centered />
          </View>
          <View style={styles.authCard}>
            <Text style={styles.sectionTitle}>Privacidade e dados sensiveis</Text>
            <Text style={styles.cardBody}>
              Para continuar usando o FatBurn, registre o aceite do aviso de privacidade e do
              tratamento de dados de saude usados para calculo de IMC, treino e acompanhamento.
            </Text>
            <View style={styles.stackedActions}>
              <ActionButton
                label="Ler aviso de privacidade"
                onPress={() => setPrivacyNoticeOpen(true)}
                secondary
              />
              <ActionButton
                label="Aceitar e continuar"
                onPress={() => void handleAcceptPrivacyConsent()}
                disabled={busy}
              />
              <ActionButton
                label="Exportar meus dados"
                onPress={() => void handleExportPrivacyData()}
                secondary
                disabled={busy}
              />
              <ActionButton
                label="Excluir conta"
                onPress={() => setDeleteConfirmOpen(true)}
                secondary
                disabled={busy}
              />
              <ActionButton label="Sair da conta" onPress={() => void handleLogout()} secondary />
            </View>
          </View>
        </ScrollView>
        {renderPrivacyNoticeModal()}
        {renderNoticeModal()}
      </SafeAreaView>
    );
  }

  if (!fontsLoaded || booting) {
    return (
      <SafeAreaView style={[styles.loadingScreen, { paddingTop: ANDROID_TOP_OFFSET }]}>
        <StatusBar style="light" translucent={false} backgroundColor="#1A1A1A" />
        <BrandWordmark centered />
        <ActivityIndicator size="large" color="#ff6a00" />
        <Text style={styles.loadingText}>Conectando seu plano.</Text>
      </SafeAreaView>
    );
  }

  if (!bundle && serverHealthy === false) {
    return (
      <SafeAreaView style={[styles.safeArea, { paddingTop: ANDROID_TOP_OFFSET }]}>
        <StatusBar style="light" translucent={false} backgroundColor="#1A1A1A" />
        <View style={styles.authScreen}>
          <View style={styles.authHeroPanel}>
            <BrandWordmark centered />
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
          {renderNoticeModal()}
        </View>
      </SafeAreaView>
    );
  }

  if (!bundle) {
    return (
      <SafeAreaView style={[styles.safeArea, { paddingTop: ANDROID_TOP_OFFSET }]}>
        <StatusBar style="light" translucent={false} backgroundColor="#1A1A1A" />
        <ScrollView ref={authScrollRef} contentContainerStyle={styles.authScreen}>
          <View style={styles.authHeroPanel}>
            <BrandWordmark centered />
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
                  secureTextEntry={!loginPasswordVisible}
                  actionLabel={loginPasswordVisible ? "Ocultar" : "Mostrar"}
                  onActionPress={() => setLoginPasswordVisible((current) => !current)}
                  onChangeText={setLoginPassword}
                />
                <View style={[styles.buttonRow, styles.buttonRowCentered]}>
                  <ActionButton label="Entrar" onPress={() => void handleLogin()} disabled={busy} />
                </View>
                <Pressable style={styles.authInlineLink} onPress={openPasswordResetModal}>
                  <Text style={styles.authInlineLinkText}>Esqueci minha senha</Text>
                </Pressable>
                <Pressable
                  style={styles.authSwitch}
                  onPress={() => {
                    setRegisterForm(createEmptyForm());
                    setRegisterPasswordVisible(false);
                    setRegisterConfirmPassword("");
                    setRegisterConfirmPasswordVisible(false);
                    setAcceptedPrivacyPolicy(false);
                    setAcceptedSensitiveConsent(false);
                    setAuthMode("register");
                  }}
                >
                  <Text style={styles.authSwitchText}>Nao tem conta? Criar cadastro</Text>
                </Pressable>
              </>
            ) : (
              <>
                <UserFormFields
                  form={registerForm}
                  onChange={updateRegisterForm}
                  passwordLabel="Senha"
                  passwordVisible={registerPasswordVisible}
                  onTogglePasswordVisibility={() =>
                    setRegisterPasswordVisible((current) => !current)
                  }
                  afterPasswordField={
                    <LabeledInput
                      label="Confirmar senha"
                      value={registerConfirmPassword}
                      secureTextEntry={!registerConfirmPasswordVisible}
                      actionLabel={registerConfirmPasswordVisible ? "Ocultar" : "Mostrar"}
                      onActionPress={() =>
                        setRegisterConfirmPasswordVisible((current) => !current)
                      }
                      onChangeText={setRegisterConfirmPassword}
                    />
                  }
                />
                <View style={styles.cardInset}>
                  <ToggleCheck
                    checked={acceptedPrivacyPolicy}
                    label="Li e aceito o aviso de privacidade."
                    onPress={() => setAcceptedPrivacyPolicy((current) => !current)}
                  />
                  <ToggleCheck
                    checked={acceptedSensitiveConsent}
                    label="Autorizo o tratamento de dados de saude para treino e acompanhamento."
                    onPress={() => setAcceptedSensitiveConsent((current) => !current)}
                  />
                  <Pressable style={styles.inlineAction} onPress={() => setPrivacyNoticeOpen(true)}>
                    <Text style={styles.inlineActionText}>Ler aviso completo</Text>
                  </Pressable>
                </View>
                <View style={[styles.buttonRow, styles.buttonRowCentered]}>
                  <ActionButton
                    label="Cadastrar e montar treino"
                    onPress={() => void handleRegister()}
                    disabled={busy}
                  />
                </View>
                <Pressable
                  style={styles.authSwitch}
                  onPress={() => {
                    setRegisterPasswordVisible(false);
                    setRegisterConfirmPassword("");
                    setRegisterConfirmPasswordVisible(false);
                    setAuthMode("login");
                  }}
                >
                  <Text style={styles.authSwitchText}>Ja tem conta? Entrar</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
        {renderPrivacyNoticeModal()}
        {renderPasswordResetModal()}
        {renderNoticeModal()}
      </SafeAreaView>
    );
  }

  if (!bundle.user.consents.accepted) {
    return renderConsentGate();
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
          <View style={styles.heroTopRow}>
            <View style={styles.heroBrandBadge}>
              <Text style={styles.heroEyebrow}>{getObjectiveLabel(user.objective)}</Text>
            </View>
            <View style={styles.heroFocusPill}>
              <Text style={styles.heroFocusText}>{getEnvironmentLabel(user.trainingEnvironment)}</Text>
            </View>
          </View>
          <Text style={styles.heroText}>
            {user.name}, seu plano atual tem {user.trainingDaysPerWeek} treinos por semana na{" "}
            {getEnvironmentLabel(user.trainingEnvironment).toLowerCase()}, com IMC atual de{" "}
            {user.bmi.toFixed(1)} ({user.bmiClass}) e meta em {user.targetWeightKg.toFixed(1)} kg.
          </Text>
          <View style={styles.heroMetricRow}>
            <MetricChip label={`${user.trainingDaysPerWeek}x por semana`} icon="calendar-week" />
            <MetricChip label={`${todayCalories} kcal hoje`} icon="fire" />
          </View>
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

        <Pressable
          style={styles.card}
          onPress={() => {
            setSelectedWorkoutId(null);
            setActiveTab("workouts");
          }}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardTitle}>Sua divisao atual</Text>
            <Text style={styles.inlineActionText}>Abrir treinos</Text>
          </View>
          {workoutPlan.map((workout) => (
            <View key={workout.id} style={styles.labelValue}>
              <Text style={styles.labelValueLabel}>
                {workout.label} | {workout.name}
              </Text>
              <Text style={styles.labelValueValue}>{workout.exercises.length} exercicios</Text>
            </View>
          ))}
        </Pressable>
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
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Selecione o treino</Text>

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
                            status?.status === "concluido" ? styles.statusBadgeTextDone : null,
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
                  selectedWorkoutStatus?.status === "concluido"
                    ? styles.statusBadgeTextDone
                    : null,
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
          {selectedWorkoutStatus?.status === "pendente" ? (
            <Text style={styles.workoutHint}>
              Disponivel apos concluir o treino {currentWorkoutLabel ?? "atual"}.
            </Text>
          ) : null}

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
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderBlock}>
              <Text style={styles.sectionTitle}>Cadastro</Text>
              <Text style={styles.sectionSubtitle}>
                {profileEditorOpen
                  ? "Atualize seus dados e salve para refazer seu treino automaticamente."
                  : "Toque em editar para alterar seus dados quando precisar."}
              </Text>
            </View>
            <Pressable
              style={styles.inlineAction}
              onPress={() => setProfileEditorOpen((current) => !current)}
            >
              <Text style={styles.inlineActionText}>
                {profileEditorOpen ? "Fechar" : "Editar"}
              </Text>
            </Pressable>
          </View>

          {profileEditorOpen ? (
            <UserFormFields
              form={profileForm}
              onChange={updateProfileForm}
              passwordLabel="Nova senha (opcional)"
              passwordVisible={profilePasswordVisible}
              onTogglePasswordVisibility={() => setProfilePasswordVisible((current) => !current)}
            />
          ) : null}

          {profileEditorOpen ? (
            <View style={styles.buttonRow}>
              <ActionButton
                label="Salvar perfil"
                onPress={() => void handleSaveProfile()}
                disabled={busy}
              />
            </View>
          ) : null}
          <View style={styles.buttonRow}>
            <ActionButton label="Sair da conta" onPress={() => void handleLogout()} secondary disabled={busy} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacidade e dados</Text>
          <View style={styles.labelValue}>
            <Text style={styles.labelValueLabel}>Politica aceita em</Text>
            <Text style={styles.labelValueValue}>
              {user.consents.privacyAcceptedAt
                ? formatDateLabel(user.consents.privacyAcceptedAt.slice(0, 10))
                : "Pendente"}
            </Text>
          </View>
          <View style={styles.labelValue}>
            <Text style={styles.labelValueLabel}>Consentimento sensivel</Text>
            <Text style={styles.labelValueValue}>
              {user.consents.sensitiveConsentAcceptedAt
                ? formatDateLabel(user.consents.sensitiveConsentAcceptedAt.slice(0, 10))
                : "Pendente"}
            </Text>
          </View>
          <View style={styles.stackedActions}>
            <ActionButton
              label="Ler aviso de privacidade"
              onPress={() => setPrivacyNoticeOpen(true)}
              secondary
            />
            <ActionButton
              label="Exportar meus dados"
              onPress={() => void handleExportPrivacyData()}
              secondary
              disabled={busy}
            />
            <ActionButton
              label="Excluir conta"
              onPress={() => setDeleteConfirmOpen(true)}
              secondary
              disabled={busy}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sobre</Text>
          <View style={styles.labelValue}>
            <Text style={styles.labelValueLabel}>Versao</Text>
            <Text style={styles.labelValueValue}>{APP_VERSION}</Text>
          </View>
          <View style={styles.labelValue}>
            <Text style={styles.labelValueLabel}>Desenvolvido por</Text>
            <Text style={styles.labelValueValue}>Elder Debertolis</Text>
          </View>
          <View style={styles.labelValue}>
            <Text style={styles.labelValueLabel}>Cadastro criado em</Text>
            <Text style={styles.labelValueValue}>{formatDateLabel(user.createdAt.slice(0, 10))}</Text>
          </View>
        </View>
      </>
    );
  }

  const tabTitles: Record<TabKey, { title: string; subtitle: string }> = {
    dashboard: {
      title: "Resumo diario",
      subtitle: "",
    },
    workouts: {
      title: "Treinos",
      subtitle: "",
    },
    progress: {
      title: "Progresso",
      subtitle: "",
    },
    profile: {
      title: "Perfil",
      subtitle: "",
    },
  };

  return (
    <SafeAreaView style={[styles.safeArea, { paddingTop: ANDROID_TOP_OFFSET }]}>
      <StatusBar style="light" translucent={false} backgroundColor="#1A1A1A" />
      <ScrollView ref={appScrollRef} contentContainerStyle={styles.content}>
        <View style={styles.appHeader}>
          <View style={{ flex: 1 }}>
            <BrandWordmark compact />
            <Text style={styles.headerTitle}>{tabTitles[activeTab].title}</Text>
            {tabTitles[activeTab].subtitle ? (
              <Text style={styles.headerSubtitle}>{tabTitles[activeTab].subtitle}</Text>
            ) : null}
          </View>
        </View>

        {serverHealthy === false ? (
          <View style={[styles.card, styles.highlightCard]}>
            <Text style={styles.cardTitle}>Servidor offline</Text>
            <Text style={styles.cardBody}>O app nao conseguiu acessar a API em {API_BASE_URL}.</Text>
          </View>
        ) : null}

        {activeTab === "dashboard" ? renderDashboard() : null}
        {activeTab === "workouts" ? renderWorkouts() : null}
        {activeTab === "progress" ? renderProgress() : null}
        {activeTab === "profile" ? renderProfile() : null}
      </ScrollView>

      <View style={[styles.tabBar, { bottom: TAB_BAR_OFFSET }]}>
        {TAB_ITEMS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab.key)}
            >
              <MaterialCommunityIcons
                name={tab.icon}
                size={18}
                color={active ? "#ff6a00" : "#8f8f8f"}
                style={styles.tabButtonIcon}
              />
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
                    setNotice({
                      title: "Video indisponivel",
                      message: `O player retornou: ${error}`,
                      tone: "error",
                    });
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

      <Modal
        animationType="fade"
        transparent
        visible={deleteConfirmOpen}
        onRequestClose={() => setDeleteConfirmOpen(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={[styles.dialogCard, styles.dialogCardError]}>
            <Text style={styles.dialogTitle}>Excluir conta</Text>
            <Text style={styles.dialogText}>
              Esta acao remove seu cadastro, pesagens, historico de treino e sessoes ativas deste
              ambiente.
            </Text>
            <View style={styles.dialogActions}>
              <ActionButton
                label="Cancelar"
                onPress={() => setDeleteConfirmOpen(false)}
                secondary
                compact
              />
              <ActionButton
                label="Excluir agora"
                onPress={() => void handleDeleteAccount()}
                compact
                disabled={busy}
              />
            </View>
          </View>
        </View>
      </Modal>

      {renderPrivacyNoticeModal()}
      {renderNoticeModal()}
    </SafeAreaView>
  );
}

