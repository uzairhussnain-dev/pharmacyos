/**
 * Loose document shape used by DTO mappers that accept lean docs, hydrated docs, and
 * `.toObject()` output interchangeably. Mappers read fields defensively and return typed DTOs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;
