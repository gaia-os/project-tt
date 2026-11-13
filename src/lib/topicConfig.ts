/**
 * Shared (client-safe) topic types and helpers.
 *
 * A "topic" is a tech-tree dataset: a folder under `data/extracted/<name>`
 * seeded into MongoDB as the database `<name>` by scripts/seed-dataset.ts.
 * Discovery happens server-side in `src/lib/topics.server.ts`; client code
 * gets the list from `GET /api/topics`.
 */

export type TopicKey = string;

export interface TopicConfig {
  /** Folder name in data/extracted AND the MongoDB database name. */
  id: TopicKey;
  /** Human-readable name shown in the selector (from dataset.json meta). */
  label: string;
  dbName: string;
  systemPrompt: string;
}

/** Shape of the optional `dataset.json` at the root of a dataset folder. */
export interface DatasetMeta {
  label?: string;
  systemPrompt?: string;
}

/** "smr-qwen38" -> "Smr Qwen38" — used when a dataset has no dataset.json label. */
export function titleizeLabel(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** MongoDB database name for a dataset folder (identity mapping). */
export function dbNameForTopic(id: string): string {
  return id;
}

export function defaultSystemPrompt(label: string): string {
  return `You are an expert in ${label}. Answer questions clearly and accurately based on the provided tech tree context.

IMPORTANT INSTRUCTIONS:
- Only answer questions related to ${label}.
- If a question is outside this domain, politely state that it is out of scope.
- Base your answers on the provided tech tree context where relevant.

FORMATTING REQUIREMENTS - VERY IMPORTANT:
- You MUST format your entire response as clean, well-structured HTML
- Use proper HTML tags: <h2>, <h3>, <h4> for headings, <p> for paragraphs, <ul>/<ol> for lists, <strong> for emphasis
- Add proper spacing between sections with margin classes
- Structure your response with clear visual hierarchy

Remember: Format everything as HTML with proper tags and spacing. No plain text or markdown formatting.`;
}
