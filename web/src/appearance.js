// The Appearance tab: tab semantics, the theme choice, per-texture custom image selection with validation, previews, reset and
// clearing of stored images. It only swaps the wall, floor and ceiling pictures through renderer.setThemeTextures(); it never
// touches the maze, the walker, the camera, timing or the settings of a run, so changing a theme cannot reset anything.
import { createBrickTexture, createStippleTexture, createWoodTexture } from "./procedural-textures.js";
import { SLOTS, TextureError, describeSources, loadBackrooms, restoreCustom, storage, textureFromUpload, textureToBlob } from "./themes.js";

const TITLES = { wall: "Wall", floor: "Floor", ceiling: "Ceiling" };
const CLASSIC = { wall: createBrickTexture, floor: createWoodTexture, ceiling: createStippleTexture };
const FILE_ID = { wall: "fileWall", floor: "fileFloor", ceiling: "fileCeiling" };
const REMOVE_ID = { wall: "removeWall", floor: "removeFloor", ceiling: "removeCeiling" };
const PREVIEW_ID = { wall: "previewWall", floor: "previewFloor", ceiling: "previewCeiling" };
const RADIO_ID = { classic: "themeClassic", backrooms: "themeBackrooms", custom: "themeCustom" };

/**
 * @param {object} deps
 * @param {Record<string, HTMLElement>} deps.elements  all elements by id
 * @param {object|null} deps.renderer  the WebGL renderer, or null when WebGL 2 is unavailable
 * @param {{theme: string}} deps.settings  resolved settings (theme is updated here)
 * @param {() => void} deps.saveSettings
 * @param {(message: string) => void} deps.announce  screen-reader announcement
 * @param {() => void} deps.render  redraw (never resets the run)
 */
export function setupAppearance({ elements, renderer, settings, saveSettings, announce, render }) {
  const state = {
    theme: "classic",
    sources: { wall: "classic", floor: "classic", ceiling: "classic" },
    custom: { wall: null, floor: null, ceiling: null }, // decoded runtime copies of the user's images (RGBA)
    customLoaded: false,
    validation: "none", // none | ok | rejected | fallback
    token: 0, // guards against a slow earlier request finishing after a later one
    stored: true, // false when IndexedDB is unavailable
  };

  const status = (message, kind = "info", speak = true) => {
    elements.appearanceStatus.textContent = message;
    elements.appearanceStatus.dataset.state = kind;
    if (speak) announce(message);
  };

  // ---- tabs (WAI-ARIA tabs pattern: arrow keys move, Home and End jump, only the selected tab is in the Tab order) ----
  const tabs = [elements.tabControls, elements.tabAppearance];
  const panels = { tabControls: elements.panelControls, tabAppearance: elements.panelAppearance };
  function selectTab(tab, focus = false) {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      panels[t.id].hidden = !selected;
    }
    if (focus) tab.focus();
    if (tab === elements.tabAppearance) ensureCustomLoaded();
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); selectTab(next, true); }
    });
  }

  // ---- previews ----
  function paintPreview(slot, texture, label) {
    const canvas = elements[PREVIEW_ID[slot]];
    const context = canvas.getContext("2d");
    const scratch = document.createElement("canvas");
    scratch.width = texture.width;
    scratch.height = texture.height;
    scratch.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(texture.data.buffer, texture.data.byteOffset, texture.data.byteLength), texture.width, texture.height), 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", `${TITLES[slot]} texture preview: ${label}`);
  }

  let activePreview = { wall: null, floor: null, ceiling: null }; // textures currently shown (backrooms ones are re-decoded per switch)

  function refreshControls() {
    for (const slot of SLOTS) elements[REMOVE_ID[slot]].disabled = !state.custom[slot];
    for (const [theme, id] of Object.entries(RADIO_ID)) elements[id].checked = state.theme === theme;
    elements.appearanceClear.disabled = !SLOTS.some((slot) => state.custom[slot]) && state.customLoaded;
  }

  function paintAll() {
    const labels = { classic: "Classic", builtin: "Backrooms-inspired", user: "your image" };
    for (const slot of SLOTS) {
      const texture = activePreview[slot] ?? CLASSIC[slot]();
      paintPreview(slot, texture, labels[state.sources[slot]] ?? "Classic");
    }
  }

  // ---- applying a theme: swaps textures only ----
  async function apply(theme, { message = null, quiet = false } = {}) {
    const token = ++state.token;
    let textures = { wall: null, floor: null, ceiling: null };
    let sources = { wall: "classic", floor: "classic", ceiling: "classic" };
    let effective = theme;
    let problem = null;
    if (theme === "backrooms") {
      status("Loading the Backrooms-inspired textures…", "info", !quiet);
      try {
        textures = await loadBackrooms();
        sources = { wall: "builtin", floor: "builtin", ceiling: "builtin" };
      } catch {
        effective = "classic";
        textures = { wall: null, floor: null, ceiling: null };
        problem = "The Backrooms-inspired textures could not be loaded, so Classic is shown.";
      }
    } else if (theme === "custom") {
      await ensureCustomLoaded();
      for (const slot of SLOTS) {
        if (state.custom[slot]) { textures[slot] = state.custom[slot]; sources[slot] = "user"; }
      }
      if (!SLOTS.some((slot) => textures[slot])) {
        effective = "classic";
        problem = state.stored
          ? "No custom images are stored yet, so Classic is shown. Choose a wall, floor or ceiling image."
          : "Custom images cannot be stored in this browser and none are loaded, so Classic is shown.";
      }
    }
    if (token !== state.token) return; // a newer request superseded this one
    state.theme = effective;
    state.sources = sources;
    activePreview = { wall: textures.wall, floor: textures.floor, ceiling: textures.ceiling };
    renderer?.setThemeTextures(textures);
    settings.theme = effective;
    saveSettings();
    if (problem) state.validation = "fallback";
    else if (state.validation === "fallback") state.validation = "none";
    paintAll();
    refreshControls();
    render();
    const summary = effective === "classic" ? "Classic textures." : `${effective === "backrooms" ? "Backrooms-inspired" : "Custom"} theme: ${describeSources(sources)}.`;
    status(problem ?? message ?? summary, problem ? "error" : "ok", !quiet || Boolean(problem));
  }

  async function ensureCustomLoaded() {
    if (state.customLoaded) return;
    state.customLoaded = true;
    const restored = await restoreCustom();
    state.stored = restored.available;
    for (const slot of SLOTS) if (restored.textures[slot]) state.custom[slot] = restored.textures[slot];
    if (restored.problems.length) {
      for (const slot of restored.problems) storage.remove(slot).catch(() => {});
      state.validation = "fallback";
      status(`A stored ${restored.problems.join(" and ")} image was damaged and was removed; Classic is used for it.`, "error");
    }
    refreshControls();
  }

  // ---- custom images ----
  async function chooseFile(slot, file) {
    const input = elements[FILE_ID[slot]];
    try {
      status(`Reading the ${slot} image…`, "info");
      await ensureCustomLoaded();
      const texture = await textureFromUpload(file);
      state.custom[slot] = texture;
      state.validation = "ok";
      try {
        await storage.save(slot, await textureToBlob(texture));
        state.stored = true;
      } catch {
        state.stored = false; // keep working for this session
      }
      await apply("custom", { message: `${TITLES[slot]} image applied. ${state.stored ? "A resized copy is stored in this browser only." : "It could not be stored, so it will be forgotten when you close the page."}` });
    } catch (error) {
      state.validation = "rejected";
      const message = error instanceof TextureError ? error.message : "That image could not be used.";
      status(`${TITLES[slot]} image rejected: ${message}`, "error");
    } finally {
      input.value = ""; // never keep the file name in the page
    }
  }

  for (const slot of SLOTS) {
    elements[FILE_ID[slot]].addEventListener("change", () => {
      const file = elements[FILE_ID[slot]].files?.[0];
      if (file) chooseFile(slot, file);
    });
    elements[REMOVE_ID[slot]].addEventListener("click", async () => {
      state.custom[slot] = null;
      await storage.remove(slot).catch(() => {});
      await apply(state.theme === "custom" ? "custom" : state.theme, { message: `${TITLES[slot]} image removed; Classic is used for it.` });
      elements[FILE_ID[slot]].focus();
    });
  }
  for (const [theme, id] of Object.entries(RADIO_ID)) {
    elements[id].addEventListener("change", () => { if (elements[id].checked) apply(theme); });
  }
  elements.appearanceReset.addEventListener("click", () => apply("classic", { message: "Reset to Classic textures. Stored custom images are kept." }));
  elements.appearanceClear.addEventListener("click", async () => {
    state.custom = { wall: null, floor: null, ceiling: null };
    state.customLoaded = true;
    try { await storage.clear(); } catch { /* nothing stored or storage unavailable */ }
    await apply(state.theme === "custom" ? "classic" : state.theme, { message: "Stored custom images cleared." });
  });

  if (!renderer) {
    for (const el of elements.panelAppearance.querySelectorAll("input, button")) el.disabled = true;
    status("Texture themes need WebGL 2, which is unavailable here.", "error", false);
  } else {
    paintAll();
    refreshControls();
    // Restore the saved or URL-selected theme; Classic needs no work and downloads nothing.
    if (settings.theme !== "classic") apply(settings.theme, { quiet: true });
  }

  return {
    /** What the evidence export may say: the theme, where each slot's picture comes from, and a validation state. Nothing else. */
    describeForExport: () => ({ theme: state.theme, wall: state.sources.wall, floor: state.sources.floor, ceiling: state.sources.ceiling, validation: state.validation }),
  };
}
