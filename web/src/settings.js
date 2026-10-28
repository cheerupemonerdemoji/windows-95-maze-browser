// Pure settings resolution (no DOM): precedence is URL parameter > saved setting > default.
// Only UI choices are stored; nothing personal is collected.

export const SETTINGS_KEY = "glmaze.settings.v1";
export const QUALITY_CHOICES = Object.freeze(["high", "standard", "turbo"]);
export const THEME_CHOICES = Object.freeze(["classic", "backrooms", "custom"]);
export const SETTING_FIELDS = Object.freeze(["quality", "view", "objects", "reducedMotion", "markers", "pictures", "logos", "rats", "theme"]);

/** `saved` is whatever was parsed from storage (any shape); `params` is a URLSearchParams. */
export function resolveSettings(params, saved) {
  const stored = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const quality = params.get("quality") ?? stored.quality;
  const view = params.get("view") ?? stored.view;
  const theme = params.get("theme") ?? stored.theme; // URL overrides the stored choice; anything unknown means classic
  const objects = params.has("objects") ? params.get("objects") !== "0" : stored.objects;
  const reduced = params.has("reduced") ? params.get("reduced") === "1" : stored.reducedMotion;
  const markers = params.has("markers") ? params.get("markers") === "1" : stored.markers;
  const flag = (name) => (params.has(name) ? params.get(name) === "1" : stored[name]) === true; // experimental, off by default
  return {
    quality: QUALITY_CHOICES.includes(quality) ? quality : "high",
    theme: THEME_CHOICES.includes(theme) ? theme : "classic", // Classic is the faithful default; the others are optional presentation
    markers: markers === true, // experimental, off by default
    pictures: flag("pictures"),
    logos: flag("logos"),
    rats: flag("rats"),
    view: view === "map" ? "map" : "first",
    objects: objects !== false,
    reducedMotion: typeof reduced === "boolean" ? reduced : null, // null follows the system preference
  };
}

/** Parses a storage string defensively; corrupt or missing data yields an empty object. */
export function parseSavedSettings(text) {
  try {
    const value = JSON.parse(text ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function serializeSettings(settings) {
  const out = {};
  for (const field of SETTING_FIELDS) out[field] = settings[field];
  return JSON.stringify(out);
}
