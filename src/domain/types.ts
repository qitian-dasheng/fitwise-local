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
  preparedBatchId?: string;
  consumptionEventId?: string;
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
  measurementBasis: "raw" | "cooked" | "package" | "edible";
  foodVersionId?: string;
  nutritionQuantity?: number;
  nutritionUnit?: FoodUnit;
  foodSnapshot?: MealEntry["foodSnapshot"];
  inventoryConfirmed?: boolean;
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

export interface PreparedBatch {
  id: string;
  recipeVersionId: string;
  date: ISODate;
  inventoryDeducted: boolean;
  consumedRatio: number;
  wastedRatio: number;
  remainingRatio: number;
  status: "open" | "closed" | "void";
  inventoryDeductions?: { movementId: string; lotBefore: InventoryLot; lotAfter: InventoryLot }[];
  voidedAt?: string;
  correctionReason?: string;
  ratioIsEstimated: boolean;
  cookedWeightG?: number;
  closedAt?: string;
  createdAt: string;
}

export interface ConsumptionEvent {
  id: string;
  status?: "active" | "superseded" | "void";
  supersedesId?: string;
  batchId: string;
  date: ISODate;
  mealType: MealType;
  ratio: number;
  ratioIsEstimated: boolean;
  createdAt: string;
}

export interface WasteEvent {
  id: string;
  status?: "active" | "superseded" | "void";
  supersedesId?: string;
  supersededBy?: string;
  correctedAt?: string;
  correctionReason?: string;
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
  purchaseId?: string;
  receiptId?: string;
  specification?: string;
  lastCountedAt?: string;
  openedAt?: string;
  returnedAmount?: number;
  wastedAmount?: number;
}

export type InventoryMovementType = "purchase" | "cooking" | "waste" | "adjustment" | "return";
export interface InventoryMovement {
  id: string;
  lotId: string;
  batchId?: string;
  reversesMovementId?: string;
  type: InventoryMovementType;
  amount: number;
  reason: string;
  createdAt: string;
}

export type PurchaseUnit = "g" | "kg" | "ml" | "l" | "piece" | "bag" | "box" | "bottle" | "pack";
export type PurchasePlatform = "duoduo" | "pinduoduo" | "taobao" | "tmall" | "jd" | "douyin" | "meituan" | "online" | "supermarket" | "other";
export interface PurchasePackaging { count: number; container: "bag" | "box" | "bottle" | "piece"; contentAmount: number; contentUnit: "g" | "kg" | "ml" | "l" | "piece" }
export interface PurchaseReceipt {
  id: string; lotId: string; quantity: number; actualAmount: number; unit: InventoryLot["unit"]; costCny: number;
  name: string; foodId: string; receivedAt: string; expiresAt?: string; reason: string; replacement: boolean;
}
export interface ReceivePurchaseInput {
  purchaseId: string; quantity: number; actualAmount: number; costCny: number; receivedAt: string; expiresAt?: string;
  final: boolean; reason: string; replacement?: { name: string; foodId?: string };
}
export interface InventoryCountInput { lotId: string; remainingAmount: number; opened: boolean; expiresAt: string | null; reason: string }
export interface InventoryDisposalInput { lotId: string; amount: number; kind: "return" | "waste"; reason: string; refundCny?: number }

export interface PurchaseDraft {
  id: string;
  foodId?: string;
  name: string;
  platform: PurchasePlatform;
  platformName?: string;
  url?: string;
  amount: number;
  unit: PurchaseUnit;
  packaging?: PurchasePackaging;
  packagingConfirmed?: boolean;
  orderedAt?: string;
  timezone?: string;
  createdAt?: string;
  paidCny?: number;
  refundedCny?: number;
  receipts?: PurchaseReceipt[];
  closedQuantity?: number;
  closedReason?: string;
  priceCny: number;
  expectedArrival?: ISODate;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled" | "closed";
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
  recipeVersionId?: string;
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
  foodDefinitions: FoodDefinition[];
  foodDefinitionVersions: FoodDefinitionVersion[];
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
  ingredients: { foodVersionId: string; quantity: number; unit: FoodUnit; inventoryFoodId: string; inventoryUnit: InventoryLot["unit"]; inventoryConfirmed: boolean }[];
  recipeId?: string;
  expectedVersionId?: string;
}
