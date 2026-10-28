export interface ValidationResult {
  /** 是否允许保存（仅标题必填为阻断项） */
  valid: boolean;
  /** 阻断性错误 */
  errors: string[];
  /** 非阻断提示（例如正文为空） */
  warnings: string[];
}

/**
 * 资料校验。
 * 规则（依据规格书）：标题必填；正文允许为空，但需给出明确提示。
 */
export function validateDocument(input: { title: string; content: string }): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.title || !input.title.trim()) {
    errors.push("标题不能为空");
  }
  if (!input.content || !input.content.trim()) {
    warnings.push("正文为空，已保存为空白资料");
  }

  return { valid: errors.length === 0, errors, warnings };
}
