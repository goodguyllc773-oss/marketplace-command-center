// Copy to config.local.js (gitignored) and fill in the API key — the
// LOCAL_API_KEY from apps/server/.env. With it, the extension works in any
// Chrome profile as soon as it's loaded: no settings to type. Without it,
// enter the same values on the extension's settings page instead.
self.MCC_CONFIG = { serverUrl: "http://127.0.0.1:4000", apiKey: "" };
