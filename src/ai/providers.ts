import type { AiProviderId, AiSettings } from "../domain/types";

export interface AiProviderDescriptor {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  apiStyle: "openai-compatible";
}

export const aiProviders: AiProviderDescriptor[] = [
  { id: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", apiStyle: "openai-compatible" },
  { id: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com", apiStyle: "openai-compatible" },
  { id: "openai-compatible", label: "OpenAI 兼容服务", defaultBaseUrl: "http://127.0.0.1:11434/v1", apiStyle: "openai-compatible" },
];

export function providerDescriptor(id: AiProviderId) {
  return aiProviders.find((provider) => provider.id === id) ?? aiProviders[0];
}

export function validateProviderSettings(settings: AiSettings): string[] {
  const errors: string[] = [];
  let url: URL | undefined;
  try {
    url = new URL(settings.baseUrl);
  } catch {
    errors.push("接口地址不是有效 URL");
  }
  if (url && url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    errors.push("云端接口必须使用 HTTPS；仅本机服务可使用 HTTP");
  }
  if (!settings.model.trim()) errors.push("需要填写模型名称");
  if (settings.monthlyLimitCny !== undefined && settings.monthlyLimitCny < 0) errors.push("月度软上限不能为负数");
  return errors;
}

export function aiBudgetState(settings: AiSettings) {
  const limit = settings.monthlyLimitCny;
  const exhausted = limit !== undefined && settings.estimatedSpendCny >= limit;
  return {
    exhausted,
    remainingCny: limit === undefined ? undefined : Math.max(0, limit - settings.estimatedSpendCny),
    canCallCloud: settings.cloudEnabled && !exhausted && validateProviderSettings(settings).length === 0,
  };
}
