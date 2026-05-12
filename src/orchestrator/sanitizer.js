// Basic logic to sanitize logs/data from process.env variables (like tokens/keys)
export function sanitizeLog(text) {
  if (!text) return text
  let sanitized = String(text)
  const sensitiveKeys = ['GITHUB_TOKEN', 'JULES_API_KEY', 'GEMINI_API_KEY']
  for (const key of sensitiveKeys) {
    const val = process.env[key]
    if (val && val.length > 0) {
      // replace all occurrences of the sensitive value with [REDACTED]
      sanitized = sanitized.split(val).join(`[REDACTED_${key}]`)
    }
  }
  return sanitized
}
