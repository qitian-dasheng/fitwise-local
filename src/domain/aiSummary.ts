/**
 * M3：授权摘要导出。
 *
 * 把「外部 AI 生成菜单草稿所需的最小事实」整理成一段用户可审阅、可编辑的文本：
 * 目标、身体、近 7 天摄入、库存剩余。导出前先在界面里展示全文（用户确认 = 看到
 * 并可修改），复制或保存的动作由用户触发。
 *
 * 安全边界：只读 profile / measurements / meals / inventory；不包含 AI 凭据
 * （本就不在 AppState 里）、审计事件、命令回执；不含任何写入能力——外部 AI
 * 拿到的只是「读」的授权，回传只能走草稿导入通道。
 */
import { activeMeals, summarizeMeals } from "./calculations";
import { shiftDiaryDate, diaryToday } from "./diary";
import { menuDraftFormatExample } from "./menuDrafts";
import type { AppState } from "./types";

const SUMMARY_DAYS = 7;

export function buildAiSummary(state: AppState, today = diaryToday()): string {
  const { profile, meals, measurements, inventory } = state;

  const lines: string[] = [];
  lines.push(`# 轻衡 · 菜单授权摘要（生成于 ${today}）`);
  lines.push("");
  lines.push("## 目标");
  lines.push(
    `- 每日热量：${profile.dailyCalories.min}–${profile.dailyCalories.max} kcal（目标 ${profile.dailyCalories.target} kcal）`,
  );
  lines.push(`- 蛋白质 ≥ ${profile.proteinTargetG} g；膳食纤维 ≥ ${profile.fiberTargetG} g`);
  lines.push("");

  const representatives = measurements
    .filter((item) => item.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestWeight = representatives.at(-1);
  lines.push("## 身体");
  lines.push(`- 身高 ${profile.heightCm} cm；阶段体重 ${profile.startWeightKg} → ${profile.targetWeightKg} kg`);
  lines.push(
    latestWeight
      ? `- 最新晨重 ${latestWeight.weightKg.toFixed(1)} kg（${latestWeight.date}）`
      : "- 尚无称重记录",
  );
  lines.push("");

  // 近 7 天：只统计「有记录且热量全部已知」的完整日，缺失日不按 0 摊薄（与趋势页同口径）。
  const days = Array.from({ length: SUMMARY_DAYS }, (_, index) => shiftDiaryDate(today, index - (SUMMARY_DAYS - 1)));
  let completeDays = 0;
  let caloriesSum = 0;
  let proteinSum = 0;
  let recordedDays = 0;
  for (const day of days) {
    const dayMeals = activeMeals(meals).filter((meal) => meal.date === day);
    if (!dayMeals.length) continue;
    recordedDays += 1;
    const summary = summarizeMeals(dayMeals);
    if (summary.coverage.calories >= 100) {
      completeDays += 1;
      caloriesSum += summary.totals.calories;
      proteinSum += summary.totals.protein;
    }
  }
  lines.push(`## 近 ${SUMMARY_DAYS} 天摄入`);
  if (completeDays > 0) {
    lines.push(
      `- 完整日 ${completeDays} 天（有记录 ${recordedDays} 天）：日均热量 ${Math.round(caloriesSum / completeDays)} kcal、蛋白 ${Math.round(proteinSum / completeDays)} g`,
    );
  } else {
    lines.push(`- 完整日 0 天（有记录 ${recordedDays} 天）：热量不全时不给 AI 日均值，避免误导。`);
  }
  lines.push("");

  lines.push("## 当前库存（剩余量，未合并批次）");
  const remaining = inventory.filter((lot) => lot.remainingAmount > 0);
  if (!remaining.length) {
    lines.push("- （空）");
  } else {
    const grouped = new Map<string, number>();
    for (const lot of remaining) {
      const key = `${lot.name}|${lot.unit}`;
      grouped.set(key, (grouped.get(key) ?? 0) + lot.remainingAmount);
    }
    for (const [key, amount] of [...grouped.entries()].slice(0, 30)) {
      const [name, unit] = key.split("|");
      lines.push(`- ${name}：${Math.round(amount * 10) / 10} ${unit}`);
    }
  }
  lines.push("");
  lines.push("## 请你输出");
  lines.push("- 按下面格式输出**一份**明日菜单草稿 JSON，除 JSON 外不要输出其他内容：");
  lines.push("```json");
  lines.push(menuDraftFormatExample);
  lines.push("```");
  lines.push("- 硬性约束：items[].basisUnit 只能是 g / ml / piece / serving / package 之一（不要写「份」「克」等中文或「100g」这类粘连写法；数字一律放 basisQuantity）。");
  lines.push("- 忌口与偏好：（请在此补充，例如：不吃鱼类、不吃青椒、尽量不放番茄）");
  return lines.join("\n");
}
