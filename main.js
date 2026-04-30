import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

const STORAGE_KEY = "foodlensxr-state-v1";
const LEGACY_LOGS_KEY = "foodLogs";
const LEGACY_SETTINGS_KEY = "appSettings";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_GEMINI_API_KEY = "";
const GEMINI_DEBUG = true;

const DEFAULT_STATE = {
    settings: {
        apiKey: DEFAULT_GEMINI_API_KEY,
        model: DEFAULT_GEMINI_MODEL,
        goals: {
            calories: 2100,
            protein: 140,
            carbs: 220,
            fat: 70
        }
    },
    logs: [],
    lastAnalysis: null
};

const state = loadState();
const elements = {};
let selectedImage = null;
let speechRecognition = null;
let xrDashboard = null;
let activeCameraStream = null;

document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    hydrateSettingsForm();
    bindEvents();
    initCameraCapture();
    initVoiceCapture();
    detectXRSupport();
    renderApp();
    registerServiceWorker();
});

function cacheElements() {
    const ids = [
        "analyze-meal",
        "api-key",
        "camera-panel",
        "camera-status",
        "camera-stream",
        "capture-frame",
        "clear-entry",
        "close-camera",
        "clear-photo",
        "clear-today",
        "coach-strip",
        "enter-xr",
        "entry-status",
        "goal-calories",
        "goal-carbs",
        "goal-fat",
        "goal-protein",
        "hero-calories",
        "hero-coach",
        "latest-analysis",
        "manual-calories",
        "manual-carbs",
        "manual-fat",
        "manual-protein",
        "meal-description",
        "meal-log",
        "meal-photo",
        "meal-type",
        "meter-calories",
        "meter-carbs",
        "meter-fat",
        "meter-protein",
        "metric-calories",
        "metric-carbs",
        "metric-fat",
        "metric-protein",
        "model-name",
        "open-camera",
        "photo-preview",
        "photo-preview-wrap",
        "quick-chips",
        "save-settings",
        "start-voice",
        "xr-status",
        "xr-summary-copy"
    ];

    ids.forEach((id) => {
        elements[id] = document.getElementById(id);
    });
}

function bindEvents() {
    elements["analyze-meal"].addEventListener("click", handleMealSubmit);
    elements["save-settings"].addEventListener("click", saveSettings);
    elements["meal-photo"].addEventListener("change", handlePhotoChange);
    elements["open-camera"].addEventListener("click", openLiveCamera);
    elements["capture-frame"].addEventListener("click", captureCameraFrame);
    elements["close-camera"].addEventListener("click", stopLiveCamera);
    elements["clear-photo"].addEventListener("click", clearPhoto);
    elements["clear-entry"].addEventListener("click", resetEntryForm);
    elements["clear-today"].addEventListener("click", clearTodayLogs);
    elements["quick-chips"].addEventListener("click", handleQuickChip);
    elements["meal-log"].addEventListener("click", handleLogActions);
    elements["enter-xr"].addEventListener("click", toggleXRSession);
}

function hydrateSettingsForm() {
    elements["api-key"].value = normalizeGeminiApiKey(state.settings.apiKey);
    elements["model-name"].value = state.settings.model;
    elements["goal-calories"].value = state.settings.goals.calories;
    elements["goal-protein"].value = state.settings.goals.protein;
    elements["goal-carbs"].value = state.settings.goals.carbs;
    elements["goal-fat"].value = state.settings.goals.fat;
}

function loadState() {
    const merged = structuredClone(DEFAULT_STATE);

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return mergeState(merged, JSON.parse(raw));
        }
    } catch (error) {
        console.warn("Could not load FoodLens XR state", error);
    }

    try {
        const legacyLogs = JSON.parse(localStorage.getItem(LEGACY_LOGS_KEY) || "[]");
        const legacySettings = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || "{}");

        if (Array.isArray(legacyLogs) && legacyLogs.length) {
            merged.logs = legacyLogs.map((log) => ({
                id: `legacy-${log.id || crypto.randomUUID()}`,
                createdAt: log.date || new Date().toISOString(),
                mealType: log.type || "snack",
                source: "legacy",
                title: log.text || "Saved meal",
                description: log.text || "",
                calories: Number(log.calories || 0),
                protein: Number(log.protein || 0),
                carbs: Number(log.carbs || 0),
                fat: Number(log.fats || log.fat || 0),
                confidence: "medium",
                summary: "Imported from the previous version of the app.",
                coachingTip: "",
                items: []
            }));
        }

        if (legacySettings && typeof legacySettings === "object") {
            merged.settings.apiKey = legacySettings.apiKey || "";
            merged.settings.goals.calories = Number(legacySettings.targetCalories) || merged.settings.goals.calories;
        }
    } catch (error) {
        console.warn("Could not migrate legacy state", error);
    }

    return merged;
}

function mergeState(base, incoming) {
    const merged = {
        ...base,
        ...incoming,
        settings: {
            ...base.settings,
            ...(incoming?.settings || {}),
            goals: {
                ...base.settings.goals,
                ...(incoming?.settings?.goals || {})
            }
        },
        logs: Array.isArray(incoming?.logs) ? incoming.logs : base.logs,
        lastAnalysis: incoming?.lastAnalysis || base.lastAnalysis
    };

    merged.settings.model = normalizeGeminiModel(merged.settings.model);
    merged.settings.apiKey = normalizeGeminiApiKey(merged.settings.apiKey);
    return merged;
}

function normalizeGeminiModel(modelName) {
    const value = String(modelName || "").trim();
    if (!value || value.startsWith("gpt-")) {
        return DEFAULT_GEMINI_MODEL;
    }

    return value;
}

function normalizeGeminiApiKey(apiKey) {
    const value = String(apiKey || "").trim();
    return value || DEFAULT_GEMINI_API_KEY;
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTodayLogs() {
    const today = todayKey();
    return state.logs
        .filter((log) => todayKey(new Date(log.createdAt)) === today)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDaySnapshot() {
    const todayLogs = getTodayLogs();
    const totals = todayLogs.reduce(
        (accumulator, log) => {
            accumulator.calories += Number(log.calories || 0);
            accumulator.protein += Number(log.protein || 0);
            accumulator.carbs += Number(log.carbs || 0);
            accumulator.fat += Number(log.fat || 0);
            return accumulator;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const goals = state.settings.goals;
    return {
        goals,
        totals,
        logs: todayLogs,
        remaining: {
            calories: goals.calories - totals.calories,
            protein: goals.protein - totals.protein,
            carbs: goals.carbs - totals.carbs,
            fat: goals.fat - totals.fat
        },
        progress: {
            calories: calculateProgress(totals.calories, goals.calories),
            protein: calculateProgress(totals.protein, goals.protein),
            carbs: calculateProgress(totals.carbs, goals.carbs),
            fat: calculateProgress(totals.fat, goals.fat)
        }
    };
}

function calculateProgress(value, goal) {
    if (!goal) {
        return 0;
    }

    return Math.max(0, Math.min((value / goal) * 100, 100));
}

function buildCoachMessage(snapshot) {
    const messages = [];
    const { remaining, totals, goals } = snapshot;

    if (totals.calories === 0) {
        return "You have a clean slate today. Capture your first meal and the app will compare it against your goal instantly.";
    }

    if (remaining.calories > 350) {
        messages.push(`${Math.round(remaining.calories)} kcal still open today.`);
    } else if (remaining.calories < -150) {
        messages.push(`${Math.abs(Math.round(remaining.calories))} kcal over target already.`);
    } else {
        messages.push("Calories are close to target.");
    }

    if (remaining.protein > 18) {
        messages.push(`Protein is behind by ${Math.round(remaining.protein)}g.`);
    } else if (remaining.protein < -10) {
        messages.push("Protein is already ahead of goal.");
    } else {
        messages.push("Protein is on pace.");
    }

    if (remaining.carbs < -20) {
        messages.push("Carbs are trending high, so keep the next meal lighter.");
    } else if (remaining.fat < -10) {
        messages.push("Fat is trending high, so favor leaner choices next.");
    } else if (remaining.protein > 20 && remaining.calories > 250) {
        messages.push("A lean protein and fiber-heavy meal would balance the day well.");
    }

    if (goals.calories && totals.calories >= goals.calories && totals.protein < goals.protein) {
        messages.push("If you eat again, prioritize protein over extra carbs or fats.");
    }

    return messages.join(" ");
}

function renderApp() {
    const snapshot = getDaySnapshot();
    const coachMessage = buildCoachMessage(snapshot);

    elements["hero-calories"].textContent = `${Math.round(snapshot.totals.calories)} kcal`;
    elements["hero-coach"].textContent = coachMessage;

    renderMetric("calories", snapshot.totals.calories, snapshot.goals.calories, "");
    renderMetric("protein", snapshot.totals.protein, snapshot.goals.protein, "g");
    renderMetric("carbs", snapshot.totals.carbs, snapshot.goals.carbs, "g");
    renderMetric("fat", snapshot.totals.fat, snapshot.goals.fat, "g");

    elements["coach-strip"].textContent = coachMessage;
    renderLatestAnalysis(snapshot);
    renderMealLog(snapshot.logs);
    elements["xr-summary-copy"].textContent = buildXRPreviewCopy(snapshot);

    if (xrDashboard) {
        xrDashboard.sync(snapshot, state.lastAnalysis);
    }
}

function renderMetric(metric, total, goal, suffix) {
    elements[`metric-${metric}`].textContent = `${Math.round(total)} / ${Math.round(goal)}${suffix}`;
    elements[`meter-${metric}`].style.width = `${calculateProgress(total, goal)}%`;
}

function renderLatestAnalysis(snapshot) {
    const latest = snapshot.logs[0];
    const card = elements["latest-analysis"];

    if (!latest) {
        card.className = "analysis-card empty-card";
        card.textContent = "No meal analysis yet.";
        return;
    }

    card.className = "analysis-card";
    const confidenceLabel = latest.confidence ? latest.confidence.toUpperCase() : "ESTIMATE";
    const itemsMarkup = (latest.items || [])
        .slice(0, 4)
        .map((item) => `<li>${escapeHtml(item.name)}${item.portion ? `, ${escapeHtml(item.portion)}` : ""}</li>`)
        .join("");

    card.innerHTML = `
        <p class="mini-heading">${escapeHtml(confidenceLabel)} confidence</p>
        <h3>${escapeHtml(latest.title)}</h3>
        <p>${escapeHtml(latest.summary || "Saved to today's log.")}</p>
        <p><strong>${Math.round(latest.calories)} kcal</strong> - ${Math.round(latest.protein)}g protein - ${Math.round(latest.carbs)}g carbs - ${Math.round(latest.fat)}g fat</p>
        ${itemsMarkup ? `<ul>${itemsMarkup}</ul>` : ""}
        ${latest.coachingTip ? `<p>${escapeHtml(latest.coachingTip)}</p>` : ""}
    `;
}

function renderMealLog(logs) {
    if (!logs.length) {
        elements["meal-log"].innerHTML = '<div class="empty-card">No meals logged today.</div>';
        return;
    }

    elements["meal-log"].innerHTML = logs
        .map((log) => {
            const timeLabel = new Date(log.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });

            return `
                <article class="timeline-item">
                    <div>
                        <h3>${escapeHtml(log.title)}</h3>
                        <p class="timeline-meta">${escapeHtml(capitalize(log.mealType))} - ${timeLabel} - ${escapeHtml(log.source)}</p>
                        ${log.summary ? `<p class="timeline-meta">${escapeHtml(log.summary)}</p>` : ""}
                        <div class="timeline-actions">
                            <button class="mini-btn" data-action="delete-log" data-log-id="${escapeHtml(log.id)}" type="button">Remove</button>
                        </div>
                    </div>
                    <div class="timeline-macros">
                        <div>${Math.round(log.calories)} kcal</div>
                        <div class="timeline-meta">${Math.round(log.protein)}P - ${Math.round(log.carbs)}C - ${Math.round(log.fat)}F</div>
                    </div>
                </article>
            `;
        })
        .join("");
}

function buildXRPreviewCopy(snapshot) {
    if (!snapshot.logs.length) {
        return "When you enter AR, a dashboard board appears in front of you. Use a single select action to move it or flip between summary, meals, and coach pages.";
    }

    return `AR will open with ${snapshot.logs.length} meal${snapshot.logs.length === 1 ? "" : "s"} for today, ${Math.round(snapshot.totals.calories)} kcal logged, and a coach panel based on your remaining goals.`;
}

function syncSettingsFromForm() {
    state.settings.apiKey = normalizeGeminiApiKey(elements["api-key"].value);
    state.settings.model = normalizeGeminiModel(elements["model-name"].value);
    state.settings.goals = {
        calories: clampPositiveNumber(elements["goal-calories"].value, DEFAULT_STATE.settings.goals.calories),
        protein: clampPositiveNumber(elements["goal-protein"].value, DEFAULT_STATE.settings.goals.protein),
        carbs: clampPositiveNumber(elements["goal-carbs"].value, DEFAULT_STATE.settings.goals.carbs),
        fat: clampPositiveNumber(elements["goal-fat"].value, DEFAULT_STATE.settings.goals.fat)
    };
}

function saveSettings() {
    syncSettingsFromForm();

    saveState();
    renderApp();
    setStatus("Settings saved locally on this device.");
}

function clampPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function initCameraCapture() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        elements["open-camera"].disabled = true;
        elements["camera-status"].textContent = "Live camera is unavailable here. Use HTTPS mobile web or upload a photo instead.";
        return;
    }

    elements["camera-status"].textContent = "Open the camera, capture a frame, then run meal analysis.";
}

async function handlePhotoChange(event) {
    const [file] = Array.from(event.target.files || []);
    if (!file) {
        clearPhoto();
        return;
    }

    try {
        selectedImage = await prepareImage(file);
        elements["photo-preview"].src = selectedImage.previewUrl;
        elements["photo-preview-wrap"].classList.remove("hidden");
        setStatus("Photo ready for meal analysis.");
    } catch (error) {
        console.error(error);
        clearPhoto();
        setStatus(error.message || "That photo could not be prepared.");
    }
}

function clearPhoto() {
    selectedImage = null;
    elements["meal-photo"].value = "";
    elements["photo-preview"].src = "";
    elements["photo-preview-wrap"].classList.add("hidden");
}

function resetEntryForm() {
    elements["meal-description"].value = "";
    elements["manual-calories"].value = "";
    elements["manual-protein"].value = "";
    elements["manual-carbs"].value = "";
    elements["manual-fat"].value = "";
    elements["meal-type"].value = "breakfast";
    clearPhoto();
    stopLiveCamera();
    setStatus("Entry form reset.");
}

function clearTodayLogs() {
    const today = todayKey();
    state.logs = state.logs.filter((log) => todayKey(new Date(log.createdAt)) !== today);
    state.lastAnalysis = null;
    saveState();
    renderApp();
    setStatus("Today's meals were cleared.");
}

function handleQuickChip(event) {
    const button = event.target.closest("[data-sample]");
    if (!button) {
        return;
    }

    const current = elements["meal-description"].value.trim();
    elements["meal-description"].value = current ? `${current}. ${button.dataset.sample}` : button.dataset.sample;
}

function handleLogActions(event) {
    const button = event.target.closest("[data-action='delete-log']");
    if (!button) {
        return;
    }

    state.logs = state.logs.filter((log) => log.id !== button.dataset.logId);
    saveState();
    renderApp();
    setStatus("Meal removed from the log.");
}

function readManualNutrition() {
    const calories = Number(elements["manual-calories"].value);
    const protein = Number(elements["manual-protein"].value);
    const carbs = Number(elements["manual-carbs"].value);
    const fat = Number(elements["manual-fat"].value);
    const hasValue = [calories, protein, carbs, fat].some((value) => Number.isFinite(value) && value > 0);

    return {
        hasValue,
        calories: Number.isFinite(calories) ? calories : 0,
        protein: Number.isFinite(protein) ? protein : 0,
        carbs: Number.isFinite(carbs) ? carbs : 0,
        fat: Number.isFinite(fat) ? fat : 0
    };
}

async function handleMealSubmit() {
    syncSettingsFromForm();
    const description = elements["meal-description"].value.trim();
    const mealType = elements["meal-type"].value;
    const manual = readManualNutrition();

    if (!description && !selectedImage && !manual.hasValue) {
        setStatus("Add a photo, a description, or manual nutrition values first.");
        return;
    }

    setBusy(true, manual.hasValue ? "Saving manual meal..." : "Analyzing your meal...");

    try {
        let analysis;

        if (manual.hasValue) {
            analysis = buildManualAnalysis(description, mealType, manual);
        } else {
            analysis = await analyzeMeal({
                apiKey: normalizeGeminiApiKey(state.settings.apiKey),
                model: state.settings.model,
                description,
                mealType,
                imageDataUrl: selectedImage?.analysisUrl || ""
            });
        }

        const log = buildLogFromAnalysis(analysis, {
            mealType,
            description,
            source: manual.hasValue ? "manual" : "ai"
        });

        state.logs.unshift(log);
        state.lastAnalysis = analysis;
        saveState();
        renderApp();
        resetEntryForm();
        setStatus(`${log.title} saved for today.`);
    } catch (error) {
        console.error(error);
        setStatus(error.message || "Meal analysis failed. Try a clearer photo or use the manual fallback.");
    } finally {
        setBusy(false);
    }
}

function buildManualAnalysis(description, mealType, manual) {
    const title = description || `${capitalize(mealType)} entry`;

    return {
        meal_title: title,
        summary: "Saved using the manual nutrition fallback.",
        items: [
            {
                name: title,
                portion: "manual entry",
                calories: manual.calories,
                protein_g: manual.protein,
                carbs_g: manual.carbs,
                fat_g: manual.fat
            }
        ],
        total_calories: manual.calories,
        total_protein_g: manual.protein,
        total_carbs_g: manual.carbs,
        total_fat_g: manual.fat,
        confidence: "high",
        assumptions: [],
        coaching_tip: "Use the AI flow later if you want a richer meal breakdown from a photo or description."
    };
}

function buildLogFromAnalysis(analysis, context) {
    return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        mealType: context.mealType,
        source: context.source,
        title: analysis.meal_title,
        description: context.description,
        calories: Number(analysis.total_calories || 0),
        protein: Number(analysis.total_protein_g || 0),
        carbs: Number(analysis.total_carbs_g || 0),
        fat: Number(analysis.total_fat_g || 0),
        confidence: analysis.confidence || "medium",
        summary: analysis.summary || "",
        coachingTip: analysis.coaching_tip || "",
        items: Array.isArray(analysis.items)
            ? analysis.items.map((item) => ({
                name: item.name,
                portion: item.portion || "",
                calories: Number(item.calories || 0),
                protein: Number(item.protein_g || 0),
                carbs: Number(item.carbs_g || 0),
                fat: Number(item.fat_g || 0)
            }))
            : []
    };
}

async function analyzeMeal({ apiKey, model, description, mealType, imageDataUrl }) {
    const inlineData = imageDataUrl ? dataUrlToInlineData(imageDataUrl) : null;
    const parts = [
        {
            text:
                "You are a nutrition estimation assistant. Infer likely food items, approximate portions, and macro totals from the provided food photo and/or meal description. Be conservative when uncertain. Keep assumptions short and plain. Return only JSON matching the provided schema."
        },
        {
            text: `Estimate the nutrition for this ${mealType}. Return a practical food log estimate, not medical advice.`
        }
    ];

    if (description) {
        parts.push({
            text: `User note: ${description}`
        });
    }

    if (inlineData) {
        parts.push({
            inline_data: inlineData
        });
    } else if (imageDataUrl) {
        console.warn("[FoodLens XR][Gemini] Image data URL was present but could not be converted into inline_data.");
    }

    logGeminiDebug("Request assembly", {
        model: model || DEFAULT_STATE.settings.model,
        mealType,
        hasDescription: Boolean(description),
        descriptionLength: description?.length || 0,
        hasImageDataUrl: Boolean(imageDataUrl),
        imageInlineMeta: inlineData ? summarizeInlineData(inlineData) : null,
        partSummary: parts.map((part) => Object.keys(part))
    });

    const requestBody = {
        contents: [
            {
                role: "user",
                parts
            }
        ],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    meal_title: { type: "string" },
                    summary: { type: "string" },
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                name: { type: "string" },
                                portion: { type: "string" },
                                calories: { type: "number" },
                                protein_g: { type: "number" },
                                carbs_g: { type: "number" },
                                fat_g: { type: "number" }
                            },
                            required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g"]
                        }
                    },
                    total_calories: { type: "number" },
                    total_protein_g: { type: "number" },
                    total_carbs_g: { type: "number" },
                    total_fat_g: { type: "number" },
                    confidence: {
                        type: "string",
                        enum: ["low", "medium", "high"]
                    },
                    assumptions: {
                        type: "array",
                        items: { type: "string" }
                    },
                    coaching_tip: { type: "string" }
                },
                required: [
                    "meal_title",
                    "summary",
                    "items",
                    "total_calories",
                    "total_protein_g",
                    "total_carbs_g",
                    "total_fat_g",
                    "confidence",
                    "assumptions",
                    "coaching_tip"
                ]
            }
        }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_STATE.settings.model)}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },
        body: JSON.stringify(requestBody)
    });

    const payload = await response.json();

    logGeminiDebug("Raw response", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        finishReason: payload?.candidates?.[0]?.finishReason || null,
        promptFeedback: payload?.promptFeedback || null,
        candidateParts: payload?.candidates?.[0]?.content?.parts || null
    });

    if (!response.ok) {
        throw new Error(payload?.error?.message || "The Gemini request failed.");
    }

    const outputText = extractGeminiResponseText(payload);
    if (!outputText) {
        throw new Error("The Gemini response did not contain structured output.");
    }

    logGeminiDebug("Structured text", outputText);

    const parsed = JSON.parse(outputText);
    logGeminiDebug("Parsed meal analysis", parsed);
    return parsed;
}

function dataUrlToInlineData(dataUrl) {
    const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
        return null;
    }

    return {
        mime_type: match[1],
        data: match[2]
    };
}

function extractGeminiResponseText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return "";
    }

    return parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
}

async function prepareImage(file) {
    const fileUrl = await fileToDataUrl(file);
    return prepareImageData(fileUrl, file.name);
}

async function prepareImageData(fileUrl, fileName = "capture.jpg") {
    const image = await loadImage(fileUrl);
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const prepared = {
        previewUrl: fileUrl,
        analysisUrl: canvas.toDataURL("image/jpeg", 0.88),
        fileName
    };

    logGeminiDebug("Prepared image", {
        fileName,
        width,
        height,
        previewUrlLength: prepared.previewUrl.length,
        analysisInlineMeta: summarizeInlineData(dataUrlToInlineData(prepared.analysisUrl))
    });

    return prepared;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the image file."));
        reader.readAsDataURL(file);
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not prepare the image preview."));
        image.src = src;
    });
}

function summarizeInlineData(inlineData) {
    if (!inlineData?.data) {
        return null;
    }

    const base64Length = inlineData.data.length;
    return {
        mimeType: inlineData.mime_type || null,
        base64Length,
        approxBytes: Math.floor((base64Length * 3) / 4)
    };
}

function logGeminiDebug(label, payload) {
    if (!GEMINI_DEBUG) {
        return;
    }

    console.log(`[FoodLens XR][Gemini] ${label}`, payload);
}

async function openLiveCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        elements["camera-status"].textContent = "This browser does not expose live camera capture.";
        return;
    }

    try {
        stopLiveCamera();
        activeCameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }
            },
            audio: false
        });

        elements["camera-stream"].srcObject = activeCameraStream;
        await elements["camera-stream"].play();
        elements["capture-frame"].disabled = false;
        elements["close-camera"].disabled = false;
        elements["camera-status"].textContent = "Camera is live. Capture a frame when the meal is in view.";
        setStatus("Camera opened.");
    } catch (error) {
        console.error(error);
        elements["camera-status"].textContent = "Camera access was blocked or is unavailable on this browser.";
        setStatus("Camera access is not available here.");
    }
}

async function captureCameraFrame() {
    const video = elements["camera-stream"];
    if (!activeCameraStream || !video.videoWidth || !video.videoHeight) {
        elements["camera-status"].textContent = "The camera stream is not ready yet.";
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    selectedImage = await prepareImageData(canvas.toDataURL("image/jpeg", 0.9), "camera-capture.jpg");
    elements["photo-preview"].src = selectedImage.previewUrl;
    elements["photo-preview-wrap"].classList.remove("hidden");
    elements["camera-status"].textContent = "Frame captured. You can analyze it now or capture again.";
    stopLiveCamera(false);
    setStatus("Camera frame captured for meal analysis.");
}

function stopLiveCamera(resetStatus = true) {
    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach((track) => track.stop());
        activeCameraStream = null;
    }

    elements["camera-stream"].srcObject = null;
    elements["capture-frame"].disabled = true;
    elements["close-camera"].disabled = true;

    if (resetStatus && elements["open-camera"].disabled === false) {
        elements["camera-status"].textContent = "Open the camera, capture a frame, then run meal analysis.";
    }
}

function initVoiceCapture() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        return;
    }

    elements["start-voice"].hidden = false;
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = "en-US";
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;

    speechRecognition.addEventListener("result", (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (!transcript) {
            return;
        }

        const current = elements["meal-description"].value.trim();
        elements["meal-description"].value = current ? `${current}. ${transcript}` : transcript;
        setStatus("Voice note added to the meal description.");
    });

    speechRecognition.addEventListener("error", () => {
        setStatus("Voice note did not complete. Try again or type the meal description.");
    });

    elements["start-voice"].addEventListener("click", () => {
        speechRecognition.start();
        setStatus("Listening for a quick meal note...");
    });
}

async function detectXRSupport() {
    if (!("xr" in navigator)) {
        elements["enter-xr"].disabled = true;
        elements["enter-xr"].textContent = "WebXR not available";
        elements["xr-status"].textContent = "This browser does not expose the WebXR API.";
        return;
    }

    if (!window.isSecureContext) {
        elements["enter-xr"].disabled = true;
        elements["enter-xr"].textContent = "HTTPS needed";
        elements["xr-status"].textContent = "WebXR requires HTTPS or localhost. Open this app from a secure origin.";
        return;
    }

    try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!supported) {
            elements["enter-xr"].disabled = true;
            elements["enter-xr"].textContent = "AR not supported";
            elements["xr-status"].textContent = "This browser exposes WebXR, but immersive AR is not available here.";
            return;
        }

        xrDashboard = new FoodLensXR(elements["enter-xr"], elements["xr-status"]);
        xrDashboard.sync(getDaySnapshot(), state.lastAnalysis);
        elements["enter-xr"].disabled = false;
        elements["enter-xr"].textContent = "Enter AR dashboard";
        elements["xr-status"].textContent = "Use a single select action to place and flip the dashboard in XR.";
    } catch (error) {
        console.error(error);
        elements["enter-xr"].disabled = true;
        elements["enter-xr"].textContent = "XR check failed";
        elements["xr-status"].textContent = "The device did not confirm immersive AR support.";
    }
}

async function toggleXRSession() {
    if (!xrDashboard) {
        return;
    }

    try {
        await xrDashboard.toggle();
    } catch (error) {
        console.error(error);
        elements["xr-status"].textContent = error.message || "Could not start the WebXR session.";
    }
}

function setBusy(isBusy, message = "") {
    elements["analyze-meal"].disabled = isBusy;
    elements["analyze-meal"].textContent = isBusy ? "Working..." : "Analyze and save";
    if (message) {
        setStatus(message);
    }
}

function setStatus(message) {
    elements["entry-status"].textContent = message;
}

function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
        return;
    }

    navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("Service worker registration failed", error);
    });
}

function capitalize(value) {
    if (!value) {
        return "";
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

class FoodLensXR {
    constructor(button, statusEl) {
        this.button = button;
        this.statusEl = statusEl;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.session = null;
        this.controllers = [];
        this.interactables = [];
        this.hovered = null;
        this.boardGroup = null;
        this.boardCanvas = null;
        this.boardContext = null;
        this.boardTexture = null;
        this.summarySnapshot = null;
        this.latestAnalysis = null;
        this.currentPage = "summary";
        this.reticle = null;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        this.viewerSpace = null;
        this.referenceSpace = null;
        this.raycaster = new THREE.Raycaster();
        this.rotationMatrix = new THREE.Matrix4();
        this.boardButtons = [];
    }

    sync(snapshot, latestAnalysis) {
        this.summarySnapshot = snapshot;
        this.latestAnalysis = latestAnalysis;
        this.drawBoard();
    }

    async toggle() {
        if (this.session) {
            await this.session.end();
            return;
        }

        await this.start();
    }

    async start() {
        this.initThree();

        const sessionInit = {
            optionalFeatures: ["local-floor", "hit-test", "hand-tracking"]
        };

        this.session = await navigator.xr.requestSession("immersive-ar", sessionInit);
        this.session.addEventListener("end", () => this.handleSessionEnd());
        this.referenceSpace = await this.session.requestReferenceSpace("local");
        this.renderer.xr.setReferenceSpaceType("local");
        await this.renderer.xr.setSession(this.session);

        this.statusEl.textContent = "AR session active. Select a button on the board to switch pages or reset placement.";
        this.button.textContent = "Exit AR dashboard";
        document.body.classList.add("xr-active");
        this.requestHitTestSource();
        this.recenterBoard();
        this.renderer.setAnimationLoop((time, frame) => this.renderFrame(frame));
    }

    initThree() {
        if (this.renderer) {
            return;
        }

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.domElement.className = "xr-canvas";

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x557766, 1.15));

        const keyLight = new THREE.DirectionalLight(0xfff0d9, 1.15);
        keyLight.position.set(1.5, 2.6, 1);
        this.scene.add(keyLight);

        this.createBoard();
        this.createReticle();
        this.createControllers();
        document.body.appendChild(this.renderer.domElement);

        window.addEventListener("resize", () => {
            if (!this.renderer) {
                return;
            }

            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createBoard() {
        this.boardCanvas = document.createElement("canvas");
        this.boardCanvas.width = 1024;
        this.boardCanvas.height = 640;
        this.boardContext = this.boardCanvas.getContext("2d");
        this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
        this.boardTexture.colorSpace = THREE.SRGBColorSpace;

        this.boardGroup = new THREE.Group();

        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(1.12, 0.7),
            new THREE.MeshBasicMaterial({
                map: this.boardTexture,
                transparent: true
            })
        );
        this.boardGroup.add(panel);

        const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.75, 0.92, 64),
            new THREE.MeshBasicMaterial({
                color: 0xf97316,
                transparent: true,
                opacity: 0.08,
                side: THREE.DoubleSide
            })
        );
        halo.position.z = -0.01;
        this.boardGroup.add(halo);

        const buttonLabels = [
            { id: "summary", label: "Summary" },
            { id: "meals", label: "Meals" },
            { id: "coach", label: "Coach" },
            { id: "reset", label: "Reset" }
        ];

        buttonLabels.forEach((button, index) => {
            const texture = this.makeButtonTexture(button.label, index === 0);
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(0.24, 0.075),
                new THREE.MeshBasicMaterial({ map: texture, transparent: true })
            );

            mesh.position.set(-0.36 + index * 0.24, -0.44, 0.02);
            mesh.userData = { ...button, texture };
            this.boardButtons.push(mesh);
            this.interactables.push(mesh);
            this.boardGroup.add(mesh);
        });

        this.scene.add(this.boardGroup);
        this.drawBoard();
    }

    createReticle() {
        this.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.05, 0.065, 32),
            new THREE.MeshBasicMaterial({ color: 0x1f7a5a, side: THREE.DoubleSide })
        );
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);
    }

    createControllers() {
        for (let index = 0; index < 2; index += 1) {
            const controller = this.renderer.xr.getController(index);
            const pointer = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(0, 0, -1)
                ]),
                new THREE.LineBasicMaterial({ color: 0xfff3e3, transparent: true, opacity: 0.55 })
            );
            pointer.scale.z = 1.25;
            controller.add(pointer);
            controller.addEventListener("select", () => this.handleSelect());
            controller.addEventListener("connected", (event) => {
                controller.userData.inputSource = event.data;
            });
            controller.addEventListener("disconnected", () => {
                controller.userData.inputSource = null;
            });
            this.controllers.push(controller);
            this.scene.add(controller);
        }
    }

    async requestHitTestSource() {
        if (!this.session || this.hitTestSourceRequested) {
            return;
        }

        try {
            this.viewerSpace = await this.session.requestReferenceSpace("viewer");
            this.hitTestSource = await this.session.requestHitTestSource({ space: this.viewerSpace });
            this.hitTestSourceRequested = true;
        } catch (error) {
            console.warn("Hit test setup failed", error);
        }
    }

    renderFrame(frame) {
        if (frame && this.hitTestSource && this.referenceSpace) {
            const hitTestResults = frame.getHitTestResults(this.hitTestSource);
            if (hitTestResults.length) {
                const pose = hitTestResults[0].getPose(this.referenceSpace);
                this.reticle.visible = true;
                this.reticle.matrix.fromArray(pose.transform.matrix);
            } else {
                this.reticle.visible = false;
            }
        }

        this.updateHoverState();
        this.renderer.render(this.scene, this.camera);
    }

    handleSelect() {
        if (this.hovered) {
            const { id } = this.hovered.userData;
            if (id === "reset") {
                this.recenterBoard();
            } else {
                this.currentPage = id;
                this.drawBoard();
                this.refreshButtonStates();
            }
            return;
        }

        if (this.reticle.visible) {
            this.boardGroup.position.setFromMatrixPosition(this.reticle.matrix);
            const cameraPosition = new THREE.Vector3();
            this.renderer.xr.getCamera(this.camera).getWorldPosition(cameraPosition);
            this.boardGroup.lookAt(cameraPosition.x, this.boardGroup.position.y, cameraPosition.z);
            return;
        }

        this.recenterBoard();
    }

    recenterBoard() {
        const xrCamera = this.renderer.xr.getCamera(this.camera);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const direction = new THREE.Vector3(0, 0, -1);

        xrCamera.getWorldPosition(position);
        xrCamera.getWorldQuaternion(quaternion);
        direction.applyQuaternion(quaternion).normalize();

        this.boardGroup.position.copy(position).add(direction.multiplyScalar(1.2));
        this.boardGroup.position.y -= 0.12;
        this.boardGroup.lookAt(position.x, this.boardGroup.position.y, position.z);
    }

    updateHoverState() {
        let hovered = null;

        for (const controller of this.controllers) {
            this.rotationMatrix.identity().extractRotation(controller.matrixWorld);
            this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
            this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.rotationMatrix);
            const intersections = this.raycaster.intersectObjects(this.interactables, false);

            if (intersections.length) {
                hovered = intersections[0].object;
                break;
            }
        }

        if (hovered !== this.hovered) {
            this.hovered = hovered;
            this.refreshButtonStates();
        }
    }

    refreshButtonStates() {
        this.boardButtons.forEach((button) => {
            const isActivePage = button.userData.id === this.currentPage;
            const isHovered = button === this.hovered;
            button.material.map = this.makeButtonTexture(button.userData.label, isActivePage || isHovered, isHovered);
            button.material.needsUpdate = true;
        });
    }

    makeButtonTexture(label, isActive, isHovered = false) {
        const canvas = document.createElement("canvas");
        canvas.width = 360;
        canvas.height = 110;
        const context = canvas.getContext("2d");

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = isActive ? "#f97316" : isHovered ? "#ffe4cf" : "#fbf5ec";
        roundRect(context, 4, 4, canvas.width - 8, canvas.height - 8, 42);
        context.fill();

        if (isHovered && !isActive) {
            context.strokeStyle = "#f97316";
            context.lineWidth = 4;
            roundRect(context, 6, 6, canvas.width - 12, canvas.height - 12, 38);
            context.stroke();
        }

        context.fillStyle = isActive ? "#fffaf6" : "#11261f";
        context.font = "700 36px Space Grotesk, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    drawBoard() {
        if (!this.boardContext || !this.summarySnapshot) {
            return;
        }

        const ctx = this.boardContext;
        const snapshot = this.summarySnapshot;
        const latest = snapshot.logs[0];

        ctx.clearRect(0, 0, this.boardCanvas.width, this.boardCanvas.height);
        ctx.fillStyle = "#11261f";
        roundRect(ctx, 16, 18, 992, 604, 34);
        ctx.fill();

        ctx.fillStyle = "rgba(249, 115, 22, 0.18)";
        roundRect(ctx, 44, 44, 280, 96, 28);
        ctx.fill();

        ctx.fillStyle = "#fffaf6";
        ctx.font = "700 56px Space Grotesk, sans-serif";
        ctx.fillText("FoodLens XR", 64, 104);

        ctx.fillStyle = "rgba(255, 250, 246, 0.68)";
        ctx.font = "500 26px Manrope, sans-serif";
        ctx.fillText("Select a tab to switch views. Select empty space to place the board on a surface.", 64, 156);

        if (this.currentPage === "summary") {
            this.drawSummaryPage(snapshot, latest);
        } else if (this.currentPage === "meals") {
            this.drawMealsPage(snapshot.logs);
        } else {
            this.drawCoachPage(snapshot, latest);
        }

        this.boardTexture.needsUpdate = true;
    }

    drawSummaryPage(snapshot, latest) {
        const ctx = this.boardContext;

        drawInfoCard(ctx, 60, 210, 260, 180, "#f6f9f4", "Today calories", `${Math.round(snapshot.totals.calories)} kcal`, `${Math.round(snapshot.remaining.calories)} kcal left`);
        drawInfoCard(ctx, 340, 210, 260, 180, "#fff7ee", "Protein", `${Math.round(snapshot.totals.protein)} g`, `${Math.round(snapshot.remaining.protein)} g to target`);
        drawInfoCard(ctx, 620, 210, 160, 180, "#eef8f3", "Meals", `${snapshot.logs.length}`, "logged today");
        drawInfoCard(ctx, 800, 210, 160, 180, "#fff7ee", "Pace", `${Math.round(snapshot.progress.calories)}%`, "of calorie goal");

        ctx.fillStyle = "#fffaf6";
        ctx.font = "700 30px Space Grotesk, sans-serif";
        ctx.fillText("Latest meal", 64, 452);

        ctx.fillStyle = "rgba(255, 250, 246, 0.72)";
        ctx.font = "500 24px Manrope, sans-serif";
        ctx.fillText(
            latest
                ? `${latest.title} - ${Math.round(latest.calories)} kcal - ${Math.round(latest.protein)}P / ${Math.round(latest.carbs)}C / ${Math.round(latest.fat)}F`
                : "No meal logged yet today.",
            64,
            494
        );

        wrapText(
            ctx,
            latest?.summary || "Use the 2D capture form to add a meal, then reopen AR to see the update here.",
            64,
            540,
            860,
            34,
            "500 24px Manrope, sans-serif",
            "rgba(255, 250, 246, 0.88)"
        );
    }

    drawMealsPage(logs) {
        const ctx = this.boardContext;

        ctx.fillStyle = "#fffaf6";
        ctx.font = "700 30px Space Grotesk, sans-serif";
        ctx.fillText("Today's meals", 64, 230);

        if (!logs.length) {
            wrapText(
                ctx,
                "No meals logged today. Capture food outside XR, then come back here to review the day in spatial mode.",
                64,
                294,
                870,
                38,
                "500 26px Manrope, sans-serif",
                "rgba(255, 250, 246, 0.82)"
            );
            return;
        }

        logs.slice(0, 5).forEach((log, index) => {
            const y = 270 + index * 68;
            ctx.fillStyle = index % 2 === 0 ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.11)";
            roundRect(ctx, 56, y - 34, 908, 54, 20);
            ctx.fill();

            ctx.fillStyle = "#fffaf6";
            ctx.font = "700 24px Manrope, sans-serif";
            ctx.fillText(`${capitalize(log.mealType)} - ${log.title}`, 78, y);

            ctx.fillStyle = "rgba(255, 250, 246, 0.78)";
            ctx.font = "500 22px Manrope, sans-serif";
            ctx.fillText(`${Math.round(log.calories)} kcal`, 774, y);
            ctx.fillText(`${Math.round(log.protein)}P ${Math.round(log.carbs)}C ${Math.round(log.fat)}F`, 850, y);
        });
    }

    drawCoachPage(snapshot, latest) {
        const ctx = this.boardContext;
        const coachMessage = buildCoachMessage(snapshot);

        ctx.fillStyle = "rgba(217, 245, 234, 0.94)";
        roundRect(ctx, 60, 220, 900, 142, 28);
        ctx.fill();

        ctx.fillStyle = "#11261f";
        ctx.font = "700 30px Space Grotesk, sans-serif";
        ctx.fillText("Coach view", 84, 268);

        wrapText(
            ctx,
            coachMessage,
            84,
            316,
            840,
            34,
            "700 24px Manrope, sans-serif",
            "#11261f"
        );

        ctx.fillStyle = "#fffaf6";
        ctx.font = "700 28px Space Grotesk, sans-serif";
        ctx.fillText("Latest meal tip", 64, 434);

        wrapText(
            ctx,
            latest?.coachingTip || "No meal-specific tip yet. Once a meal is analyzed, its note appears here.",
            64,
            486,
            872,
            34,
            "500 24px Manrope, sans-serif",
            "rgba(255, 250, 246, 0.86)"
        );
    }

    handleSessionEnd() {
        this.session = null;
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
        this.viewerSpace = null;
        this.referenceSpace = null;
        this.reticle.visible = false;
        this.hovered = null;
        this.refreshButtonStates();
        this.renderer.setAnimationLoop(null);
        this.statusEl.textContent = "AR session ended. You can re-enter at any time.";
        this.button.textContent = "Enter AR dashboard";
        document.body.classList.remove("xr-active");
    }
}

function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function drawInfoCard(context, x, y, width, height, fill, label, value, caption) {
    context.fillStyle = fill;
    roundRect(context, x, y, width, height, 28);
    context.fill();

    context.fillStyle = "#11261f";
    context.font = "600 24px Manrope, sans-serif";
    context.fillText(label, x + 24, y + 42);
    context.font = "700 40px Space Grotesk, sans-serif";
    context.fillText(value, x + 24, y + 98);
    context.font = "500 22px Manrope, sans-serif";
    context.fillStyle = "rgba(17, 38, 31, 0.72)";
    context.fillText(caption, x + 24, y + 136);
}

function wrapText(context, text, x, y, maxWidth, lineHeight, font, fillStyle) {
    const words = String(text || "").split(/\s+/);
    let line = "";

    context.font = font;
    context.fillStyle = fillStyle;

    for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        if (context.measureText(testLine).width > maxWidth) {
            context.fillText(line, x, y);
            line = word;
            y += lineHeight;
        } else {
            line = testLine;
        }
    }

    if (line) {
        context.fillText(line, x, y);
    }
}
