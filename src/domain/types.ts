export type ISODate = string;
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type DataSource = "label" | "personal" | "official" | "ai_estimate" | "fatsecret" | "manual";
export type Confidence = "high" | "medium" | "low";
export type NutrientState = "unknown" | "zero" | "known";
export type AiProviderId = "openai" | "deepseek" | "openai-compatible";

export interface NutrientValue {
  state: NutrientState;
  value?: number;
  unit: "kcal" | "g" | "mg";
  source: DataSource;
  confidence: Confidence;
}

export interface NutritionFacts {
  calories: NutrientValue;
  protein: NutrientValue;
  carbohydrates: NutrientValue;
  fat: NutrientValue;
  fiber: NutrientValue;
  sugar: NutrientValue;
  sodium: NutrientValue;
}

export interface UserProfile {
  name: string;
  sex: "male" | "female" | "other";
  age: number;
  heightCm: number;
  startWeightKg: number;
  targetWeightKg: number;
  timezone: string;
  dailyCalories: { min: number; target: number; max: number };
  proteinTargetG: number;
  fiberTargetG: number;
  equipment: string[];
}

export interface MealEntry {
  id: string;
  date: ISODate;
  type: MealType;
  name: string;
  amountLabel: string;
  nutrition: NutritionFacts;
  consumedRatio: number;
  source: DataSource;
  confidence: Confidence;
  preparedBatchId?: string;
  consumptionEventId?: string;
  createdAt: string;
}

export interface DailyCheckIn {
  date: ISODate;
  hunger?: number;
  energy?: number;
  complete: boolean;
  completedAt?: string;
}

export interface BodyMeasurement {
  id: string;
  date: ISODate;
  weightKg: number;
  waistCm?: number;
  bodyFatPercent?: number;
  isOutlier?: boolean;
  status?: "active" | "superseded";
  supersedesId?: string;
  createdAt: string;
}

export interface WorkoutSession {
  id: string;
  date: ISODate;
  name: string;
  type: string;
  durationMinutes: number;
  caloriesKcal?: number;
  load?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  sourceFingerprint?: string;
  createdAt: string;
}

export interface RecipeIngredient {
  foodId: string;
  name: string;
  amount: number;
  unit: "g" | "ml" | "piece";
  measurementBasis: "raw" | "cooked" | "package";
}

export interface RecipeVersion {
  id: string;
  recipeId: string;
  name: string;
  version: number;
  ingredients: RecipeIngredient[];
  nutrition: NutritionFacts;
  totalMinutes: number;
  equipment: string[];
  source: DataSource;
  createdAt: string;
}

export interface PreparedBatch {
  id: string;
  recipeVersionId: string;
  date: ISODate;
  inventoryDeducted: boolean;
  consumedRatio: number;
  wastedRatio: number;
  remainingRatio: number;
  status: "open" | "closed";
  ratioIsEstimated: boolean;
  cookedWeightG?: number;
  closedAt?: string;
  createdAt: string;
}

export interface ConsumptionEvent {
  id: string;
  batchId: string;
  date: ISODate;
  mealType: MealType;
  ratio: number;
  ratioIsEstimated: boolean;
  createdAt: string;
}

export interface WasteEvent {
  id: string;
  batchId: string;
  date: ISODate;
  ratio: number;
  reason: "discarded" | "spoiled" | "other";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface InventoryLot {
  id: string;
  foodId: string;
  name: string;
  purchasedAmount: number;
  remainingAmount: number;
  unit: "g" | "ml" | "piece";
  purchasePriceCny: number;
  purchasedAt: ISODate;
  receivedAt?: ISODate;
  expiresAt?: ISODate;
  opened: boolean;
  confidence: Confidence;
  source?: string;
  nutrition?: NutritionFacts;
}

export type InventoryMovementType = "purchase" | "cooking" | "waste" | "adjustment" | "return";
export interface InventoryMovement {
  id: string;
  lotId: string;
  type: InventoryMovementType;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface PurchaseDraft {
  id: string;
  name: string;
  platform: "duoduo" | "online" | "supermarket" | "other";
  url?: string;
  amount: number;
  unit: "g" | "ml" | "piece";
  priceCny: number;
  expectedArrival?: ISODate;
  status: "draft" | "ordered" | "received" | "cancelled";
  confidence: Confidence;
}

export interface InboxItem {
  id: string;
  kind: "image" | "text" | "link";
  title: string;
  preview: string;
  receivedAt: string;
  status: "unreviewed" | "drafted" | "confirmed" | "discarded";
  artifactPath?: string;
  fingerprint?: string;
}

export interface PlanCandidate {
  id: string;
  date: ISODate;
  title: string;
  description: string;
  caloriesKcal: number;
  proteinG: number;
  fiberG: number;
  estimatedCostCny: number;
  cookingMinutes: number;
  inventoryCoverage: number;
  reasons: string[];
  missingIngredients: string[];
  status: "candidate" | "selected" | "dismissed";
}

export interface AiSettings {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  monthlyLimitCny?: number;
  estimatedSpendCny: number;
  usageMonth: string;
  cloudEnabled: boolean;
}

export interface AppState {
  profile: UserProfile;
  meals: MealEntry[];
  checkIns: DailyCheckIn[];
  measurements: BodyMeasurement[];
  workouts: WorkoutSession[];
  recipes: RecipeVersion[];
  batches: PreparedBatch[];
  consumptionEvents: ConsumptionEvent[];
  wasteEvents: WasteEvent[];
  auditEvents: AuditEvent[];
  inventory: InventoryLot[];
  inventoryMovements: InventoryMovement[];
  purchases: PurchaseDraft[];
  inbox: InboxItem[];
  plans: PlanCandidate[];
  aiSettings: AiSettings;
}

export const nutrientKeys = [
  "calories",
  "protein",
  "carbohydrates",
  "fat",
  "fiber",
  "sugar",
  "sodium",
] as const;

export type NutrientKey = (typeof nutrientKeys)[number];
