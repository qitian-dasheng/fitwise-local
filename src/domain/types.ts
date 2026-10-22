export type ISODate = string;
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type DataSource = "label" | "personal" | "official" | "ai_estimate" | "fatsecret" | "manual";
export type Confidence = "high" | "medium" | "low";
export type NutrientState = "unknown" | "zero" | "known";

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

export type FoodUnit = "g" | "ml" | "piece" | "serving" | "package";
export type FoodMeasurementBasis = "raw" | "cooked" | "packaged" | "edible";
export interface FoodUnitConversion {
  unit: FoodUnit;
  quantity: number;
  basisQuantity: number;
}
export interface FoodDefinitionInput {
  name: string;
  brand?: string;
  measurementBasis: FoodMeasurementBasis;
  basis: { quantity: number; unit: FoodUnit };
  energyUnit: "kcal" | "kJ";
  nutrients: Partial<Record<NutrientKey, number>>;
  conversions: FoodUnitConversion[];
  source: DataSource;
}
export interface FoodDefinition {
  id: string;
  name: string;
  brand?: string;
  measurementBasis: FoodMeasurementBasis;
  activeVersionId: string;
  favorite: boolean;
  createdAt: string;
}
export interface FoodDefinitionVersion {
  origin?: { method: "manual_label"; labelDraftId: string; sourceReceiptId: string | null; artifactId: string | null; confirmedAt: string };
  id: string;
  foodId: string;
  version: number;
  basis: FoodDefinitionInput["basis"];
  energyUnit: "kcal" | "kJ";
  labelNutrients: FoodDefinitionInput["nutrients"];
  conversions: FoodUnitConversion[];
  nutrition: NutritionFacts;
  source: DataSource;
  confirmedBy: string;
  confirmedAt: string;
}
export interface FoodMealInput {
  date: string;
  type: MealType;
  entries: { foodVersionId: string; quantity: number; unit: FoodUnit }[];
}
export interface FoodLibraryItem {
  definition: FoodDefinition;
  version: FoodDefinitionVersion;
  per100g?: NutritionFacts;
  per100ml?: NutritionFacts;
  lastUsedAt?: string;
}
export interface FoodMealPreview {
  nutrition: NutritionFacts;
  factor: number;
  basisQuantity: number;
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
  status?: "active" | "superseded" | "void";
  supersedesId?: string;
  supersededBy?: string;
  correctedAt?: string;
  correctionReason?: string;
  date: ISODate;
  type: MealType;
  name: string;
  amountLabel: string;
  nutrition: NutritionFacts;
  consumedRatio: number;
  source: DataSource;
  confidence: Confidence;
  /** 「照搬上次」产生的新记录指回来源条目，便于回溯这次复制从哪来。 */
  copiedFromId?: string;
  foodDefinitionId?: string;
  foodVersionId?: string;
  foodSnapshot?: {
    definition: FoodDefinition;
    version: FoodDefinitionVersion;
    quantity: number;
    unit: FoodUnit;
    factor: number;
    basisQuantity: number;
  };
  createdAt: string;
}

export interface DailyCheckIn {
  date: ISODate;
  hunger?: number;
  energy?: number;
  complete: boolean;
  completedAt?: string;
}

export type MeasurementCondition = "morning" | "other";

export interface BodyMeasurement {
  id: string;
  /** 日记日（北京时间自然日）：投影与趋势窗口都依赖它，是权威日期。 */
  date: ISODate;
  weightKg: number;
  /** 称重时刻，'YYYY-MM-DDTHH:mm:ss+08:00'。旧记录缺失，缺失时不要用 createdAt 冒充。 */
  measuredAt?: string;
  condition?: MeasurementCondition;
  note?: string;
  source?: "manual" | "import";
  waistCm?: number;
  bodyFatPercent?: number;
  isOutlier?: boolean;
  /** superseded = 已被更正，void = 已作废；缺失视为 active。 */
  status?: "active" | "superseded" | "void";
  supersedesId?: string;
  supersededBy?: string;
  correctionReason?: string;
  correctedAt?: string;
  voidedAt?: string;
  /** 当日趋势代表值，同一日最多一条为真。 */
  dayRepresentative?: boolean;
  createdAt: string;
}

export interface WorkoutSession {
  id: string;
  /**
   * 缺失视为 active。`superseded` = 被更正的旧值；`reverted` = 被撤销的那次更正；
   * `void` = 本来就不该存在的记录。三者都不是有效记录，只有 active 参与统计。
   */
  status?: "active" | "superseded" | "void" | "reverted";
  supersedesId?: string;
  supersededBy?: string;
  correctionReason?: string;
  correctedAt?: string;
  voidedAt?: string;
  /** 被撤销的那次更正：撤销时刻与撤销原因（原因可空）。 */
  revertedAt?: string;
  revertedReason?: string;
  /** 重新生效的时刻与原因，撤销更正与恢复作废共用。 */
  restoredAt?: string;
  restoredReason?: string;
  /** 撤销更正时写上「被撤销的那次更正是哪一条」，作为父子链的补充证据。 */
  restoredCorrectionId?: string;
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
  measurementBasis: "raw" | "cooked" | "package" | "edible";
  foodVersionId?: string;
  nutritionQuantity?: number;
  nutritionUnit?: FoodUnit;
  foodSnapshot?: MealEntry["foodSnapshot"];
}

export interface RecipeVersion {
  id: string;
  copiedFromVersionId?: string;
  recipeId: string;
  name: string;
  version: number;
  ingredients: RecipeIngredient[];
  nutrition: NutritionFacts;
  totalMinutes: number;
  equipment: string[];
  source: DataSource;
  confirmedBy?: string;
  confirmedAt?: string;
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

export interface AppState {
  foodDefinitions: FoodDefinition[];
  foodDefinitionVersions: FoodDefinitionVersion[];
  profile: UserProfile;
  meals: MealEntry[];
  checkIns: DailyCheckIn[];
  measurements: BodyMeasurement[];
  workouts: WorkoutSession[];
  recipes: RecipeVersion[];
  auditEvents: AuditEvent[];
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

export interface MealCorrectionInput {
  mealId: string;
  reason: string;
  date?: string;
  type?: MealType;
  quantity?: number;
  unit?: FoodUnit;
  ratio?: number;
  name?: string;
  amountLabel?: string;
  nutrients?: Partial<Record<NutrientKey, number>>;
}
export interface RecipeInput {
  copiedFromVersionId?: string;
  name: string;
  totalMinutes: number;
  equipment: string[];
  ingredients: { foodVersionId: string; quantity: number; unit: FoodUnit }[];
  recipeId?: string;
  expectedVersionId?: string;
}
