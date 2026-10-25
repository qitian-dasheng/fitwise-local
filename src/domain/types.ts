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
  /** 归档：从日常挑选入口隐藏；历史记录与菜谱快照不受影响。旧数据缺省为未归档。 */
  archived?: boolean;
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
/** 菜谱快速入餐：entries 必须来自 recipeVersionId 的原料快照，由后端逐项校验。 */
export interface RecipeMealInput {
  date: string;
  type: MealType;
  recipeVersionId: string;
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

/** set_target_profile 的载荷：只允许改目标类字段，身份字段（姓名/身高等）不在其中。 */
export interface TargetProfileInput {
  dailyCalories: { min: number; target: number; max: number };
  proteinTargetG: number;
  fiberTargetG: number;
  targetWeightKg: number;
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
  /** 菜谱快速入餐产生的条目指回菜谱版本，便于回溯这次记录来自哪个配方。 */
  recipeVersionId?: string;
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
  /** 适用餐次（OBS-010，0.9.4）：多选标签；缺失 = 未分类。 */
  mealTags?: MealType[];
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
  /** 食物柜（0.9.4 库存轻量版）：家里有什么、快没了没；与饮食记录解耦，不自动扣减。 */
  pantryItems: PantryItem[];
}

/** 食物柜条目：挂食材库定义；同一定义只有一条（数量增减，不叠条目）。 */
export interface PantryItem {
  id: string;
  foodDefinitionId: string;
  quantity: number;
  unit: FoodUnit;
  /** 到期日（YYYY-MM-DD），可空。 */
  expiresAt?: string;
  /** 低存量阈值：低于它就高亮提醒补货。 */
  lowStockThreshold?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
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
  mealTags?: MealType[];
  ingredients: { foodVersionId: string; quantity: number; unit: FoodUnit }[];
  recipeId?: string;
  expectedVersionId?: string;
}
