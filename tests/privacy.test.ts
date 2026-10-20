import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../src/domain/privacy";

describe("privacy preview", () => {
  it("redacts common identifiers without changing the source value", () => {
    const source = "电话 13812345678，订单 order:ABC-123456，https://example.com/item?id=99";
    const preview = redactSensitiveText(source);

    expect(source).toContain("13812345678");
    expect(preview.redacted).not.toContain("13812345678");
    expect(preview.redacted).not.toContain("id=99");
    expect(preview.findings).toContain("手机号");
    expect(preview.findings).toContain("订单或运单号");
    expect(preview.findings).toContain("链接参数");
  });
});
