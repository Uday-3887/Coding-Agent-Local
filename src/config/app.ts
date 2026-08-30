/**
 * ─────────────────────────────────────────────────────────────
 *  LocalForge AI — single source of application identity.
 *  Change the product name / defaults here and nowhere else.
 * ─────────────────────────────────────────────────────────────
 */
export const APP_NAME = "LocalForge AI";
export const APP_SHORT = "LocalForge";
export const APP_VERSION = "0.1.0";
export const APP_TAGLINE = "Local-first · Multi-agent · Private by design";

/** Default Ollama endpoint. Never hardcoded anywhere else — always read from settings. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Built-in heuristic model id used when no Ollama model is selected. Clearly labeled in the UI. */
export const OFFLINE_MODEL_ID = "localforge-heuristic-v1";
export const OFFLINE_MODEL_LABEL = "LocalForge Heuristic v1 (built-in, no LLM)";

export const DEFAULT_IGNORED = [
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".cache", ".venv", "venv", "__pycache__", ".env", ".idea", ".vscode",
];

/** Files treated as sensitive — contents are masked before entering AI context. */
export const SECRET_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials/i,
  /secret/i,
  /id_rsa/i,
];

export const LIMITS = {
  /** max characters of a single file loaded into memory/context */
  maxFileChars: 200_000,
  /** max chars assembled into a model prompt context */
  maxContextChars: 24_000,
  /** max search results rendered */
  maxSearchResults: 300,
  /** terminal lines kept per session */
  maxTerminalLines: 800,
  /** max files indexed from a local folder */
  maxIndexedFiles: 1500,
  /** max agent loop iterations safety valve */
  maxIterationsHardCap: 40,
};

export const WELCOME_TITLE = `Welcome to ${APP_NAME}`;
