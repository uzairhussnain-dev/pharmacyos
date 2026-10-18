/** Duck-typed check for a MongoDB unique-index violation (robust to multiple driver copies). */
export function isDuplicateKeyError(err: unknown): err is { code: 11000; keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> } {
  return Boolean(err) && typeof err === 'object' && (err as { code?: unknown }).code === 11000;
}
