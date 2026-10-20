export interface PrivacyPreview {
  redacted: string;
  findings: string[];
}

export function redactSensitiveText(input: string): PrivacyPreview {
  const findings = new Set<string>();
  let redacted = input;

  redacted = redacted.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, () => {
    findings.add("手机号");
    return "[已遮挡手机号]";
  });
  redacted = redacted.replace(/\b(?:order|订单|运单|快递)[\s:#：-]*[A-Z0-9-]{6,}\b/gi, () => {
    findings.add("订单或运单号");
    return "[已遮挡订单号]";
  });
  redacted = redacted.replace(/https?:\/\/[^\s]+/gi, (value) => {
    try {
      const url = new URL(value);
      if (url.search || url.hash) {
        findings.add("链接参数");
        return `${url.origin}${url.pathname}[已移除参数]`;
      }
    } catch {
      findings.add("无法验证的链接");
      return "[已遮挡链接]";
    }
    return value;
  });
  redacted = redacted.replace(/[^，。\n]{0,24}(?:省|市|区|县|街道|小区|楼|室)[^，。\n]{0,28}/g, (value) => {
    if (value.length < 4) return value;
    findings.add("疑似地址");
    return "[疑似地址，需人工复核]";
  });

  return { redacted, findings: [...findings] };
}
