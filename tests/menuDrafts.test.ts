import { describe, expect, it } from "vitest";
import { menuDraftFormatExample, validateMenuDraftPayload } from "../src/domain/menuDrafts";

const valid = JSON.stringify({
  date: "2026-10-23",
  title: "标准锅日",
  caloriesKcal: 2015,
  proteinG: 160,
  items: [
    {
      name: "白菜豆腐炖里脊",
      basisQuantity: 100,
      basisUnit: "g",
      energyUnit: "kcal",
      nutrients: { calories: 120, protein: 15, sodium: 300 },
      nrv: { protein: 25 },
    },
  ],
});

describe("validateMenuDraftPayload（粘贴层轻校验）", () => {
  it("合法草稿原样通过，营养校验留给 Rust 导入时统一执行", () => {
    const draft = validateMenuDraftPayload(valid);
    expect(draft.title).toBe("标准锅日");
    expect(draft.items[0].name).toBe("白菜豆腐炖里脊");
  });

  it("非 JSON、非对象直接拒绝", () => {
    expect(() => validateMenuDraftPayload("好的，这是你要的菜单：")).toThrow("JSON");
    expect(() => validateMenuDraftPayload("[1,2,3]")).toThrow("JSON 对象");
  });

  it("必填字段缺失逐个点名", () => {
    const noDate = JSON.parse(valid); delete noDate.date;
    expect(() => validateMenuDraftPayload(JSON.stringify(noDate))).toThrow("date");
    const noTitle = JSON.parse(valid); delete noTitle.title;
    expect(() => validateMenuDraftPayload(JSON.stringify(noTitle))).toThrow("title");
    const noCalories = JSON.parse(valid); delete noCalories.caloriesKcal;
    expect(() => validateMenuDraftPayload(JSON.stringify(noCalories))).toThrow("caloriesKcal");
    const noProtein = JSON.parse(valid); delete noProtein.proteinG;
    expect(() => validateMenuDraftPayload(JSON.stringify(noProtein))).toThrow("proteinG");
    const noItems = JSON.parse(valid); delete noItems.items;
    expect(() => validateMenuDraftPayload(JSON.stringify(noItems))).toThrow("items");
  });

  it("菜目结构错误精确到条目", () => {
    const noName = JSON.parse(valid); delete noName.items[0].name;
    expect(() => validateMenuDraftPayload(JSON.stringify(noName))).toThrow("名称");
    const badQuantity = JSON.parse(valid); badQuantity.items[0].basisQuantity = 0;
    expect(() => validateMenuDraftPayload(JSON.stringify(badQuantity))).toThrow("basisQuantity");
    const badUnit = JSON.parse(valid); badUnit.items[0].basisUnit = "kg";
    expect(() => validateMenuDraftPayload(JSON.stringify(badUnit))).toThrow("basisUnit");
    const badKey = JSON.parse(valid); badKey.items[0].nutrients.vitaminC = 10;
    expect(() => validateMenuDraftPayload(JSON.stringify(badKey))).toThrow("vitaminC");
    const badValue = JSON.parse(valid); badValue.items[0].nutrients.calories = "120";
    expect(() => validateMenuDraftPayload(JSON.stringify(badValue))).toThrow("非负数字");
  });

  it("外部多余字段被容忍，格式示例自解析", () => {
    const lenient = JSON.parse(valid); lenient.generatedBy = "外部 AI";
    expect(() => validateMenuDraftPayload(JSON.stringify(lenient))).not.toThrow();
    // 格式示例本身必须能通过校验：给 AI 的样例和校验器不能互相打脸。
    expect(() => validateMenuDraftPayload(menuDraftFormatExample)).not.toThrow();
  });
});

describe("中文/变体单位自动映射（M4 归档项①）", () => {
  const draftWithUnit = (basisUnit: unknown) =>
    JSON.stringify({
      date: "2026-10-23", title: "单位映射点验", caloriesKcal: 500, proteinG: 30,
      items: [{ name: "燕麦粥", basisQuantity: 100, basisUnit, nutrients: { calories: 120, protein: 5 } }],
    });

  it("常见中文单位映射回合法值，并回写结果传给 Rust", () => {
    for (const [input, expected] of [
      ["份", "serving"], ["餐", "serving"], ["碗", "serving"],
      ["克", "g"], ["毫升", "ml"], ["个", "piece"], ["包", "package"],
    ] as const) {
      const draft = validateMenuDraftPayload(draftWithUnit(input));
      expect(draft.items[0].basisUnit).toBe(expected);
    }
  });

  it("大小写宽容：G / ML 归一为小写合法值", () => {
    expect(validateMenuDraftPayload(draftWithUnit("G")).items[0].basisUnit).toBe("g");
    expect(validateMenuDraftPayload(draftWithUnit("ML")).items[0].basisUnit).toBe("ml");
  });

  it("未知单位仍拒绝，报错保留 basisUnit 字样并指向格式示例", () => {
    for (const bad of ["kg", "100g", "碗半", "夸脱"]) {
      expect(() => validateMenuDraftPayload(draftWithUnit(bad))).toThrow(/basisUnit/);
      expect(() => validateMenuDraftPayload(draftWithUnit(bad))).toThrow(/查看草稿格式/);
    }
  });

  it("数字粘连给专门提示：数字进 basisQuantity", () => {
    expect(() => validateMenuDraftPayload(draftWithUnit("100g"))).toThrow(/basisQuantity/);
  });
});
