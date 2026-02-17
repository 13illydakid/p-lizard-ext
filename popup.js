// ================================
// Extension + Storage Helpers
// ================================

const STORAGE_KEY = "taskFormData";

function getStorageArea() {
    const storage = globalThis.browser?.storage ?? globalThis.chrome?.storage;
    if (!storage?.local) {
        throw new Error("Extension storage API not available.");
    }
    return storage.local;
}

function storageGet(storageArea, key) {
    return new Promise((resolve, reject) => {
        storageArea.get(key, (result) => {
            const ext = getExtensionApi();
            if (ext?.runtime?.lastError) reject(ext.runtime.lastError);
            else resolve(result);
        });
    });
}

function storageSet(storageArea, items) {
    return new Promise((resolve, reject) => {
        storageArea.set(items, () => {
            const ext = getExtensionApi();
            if (ext?.runtime?.lastError) reject(ext.runtime.lastError);
            else resolve();
        });
    });
}

function storageRemove(storageArea, key) {
    return new Promise((resolve, reject) => {
        storageArea.remove(key, () => {
            const ext = getExtensionApi();
            if (ext?.runtime?.lastError) reject(ext.runtime.lastError);
            else resolve();
        });
    });
}

// ================================
// FORM STATE
// ================================

let selectedImageDataUrl = "";
let selectedImageFileName = "";

let activeQa = "1";

let state = {
    shared: {
        taskId: "",
        annotatorOrReviewer: "",
        imageDataUrl: "",
        imageFileName: "",
        lastQa: "1",
    },
    perQa: {
        "1": { imageAndPrompt: "", rewriteAnswer: "" },
        "2": { imageAndPrompt: "", rewriteAnswer: "" },
        "3": { imageAndPrompt: "", rewriteAnswer: "" },
        "4": { imageAndPrompt: "", rewriteAnswer: "" },
        "5": { imageAndPrompt: "", rewriteAnswer: "" },
    }
};

function setImageStatus(text) {
    const status = document.getElementById("imageStatus");
    if (status) status.textContent = text;

    const deleteBtn = document.getElementById("deleteImageBtn");
    if (deleteBtn) {
        const hasImage = Boolean(selectedImageFileName);
        deleteBtn.style.display = hasImage ? "inline-flex" : "none";
    }
}

function readSharedFormValues() {
    return {
        taskId: document.getElementById("taskId")?.value ?? "",
        annotatorOrReviewer: getAnnotatorOrReviewerChoice(),
        imageDataUrl: selectedImageDataUrl,
        imageFileName: selectedImageFileName,
        lastQa: activeQa,
    };
}

function readQaFormValues() {
    return {
        imageAndPrompt: document.getElementById("imageAndPrompt")?.value ?? "",
        rewriteAnswer: document.getElementById("rewriteAnswer")?.value ?? "",
    };
}

function isValidQa(qa) {
    return qa === "1" || qa === "2" || qa === "3" || qa === "4" || qa === "5";
}

function setActiveQa(nextQa) {
    const qa = String(nextQa);
    if (!isValidQa(qa)) return;
    activeQa = qa;

    for (let i = 1; i <= 5; i++) {
        const btn = document.getElementById(`qaBtn${i}`);
        if (!btn) continue;
        btn.setAttribute("aria-pressed", String(i) === activeQa ? "true" : "false");
    }
}

function getAnnotatorOrReviewerChoice() {
    const annotatingBtn = document.getElementById("choiceAnnotating");
    const reviewingBtn = document.getElementById("choiceReviewing");

    const annotatingPressed = annotatingBtn?.getAttribute("aria-pressed") === "true";
    const reviewingPressed = reviewingBtn?.getAttribute("aria-pressed") === "true";

    if (annotatingPressed && !reviewingPressed) return "Annotating";
    if (reviewingPressed && !annotatingPressed) return "Reviewing";
    return "";
}

function setAnnotatorOrReviewerChoice(choice) {
    const annotatingBtn = document.getElementById("choiceAnnotating");
    const reviewingBtn = document.getElementById("choiceReviewing");

    const isAnnotating = choice === "Annotating";
    const isReviewing = choice === "Reviewing";

    if (annotatingBtn) annotatingBtn.setAttribute("aria-pressed", isAnnotating ? "true" : "false");
    if (reviewingBtn) reviewingBtn.setAttribute("aria-pressed", isReviewing ? "true" : "false");
}

function writeSharedFormValues(shared) {
    const safe = shared && typeof shared === "object" ? shared : {};

    const taskIdEl = document.getElementById("taskId");
    if (taskIdEl) taskIdEl.value = safe.taskId ?? "";

    setAnnotatorOrReviewerChoice(safe.annotatorOrReviewer ?? "");

    selectedImageDataUrl = safe.imageDataUrl ?? "";
    selectedImageFileName = safe.imageFileName ?? "";

    if (selectedImageFileName) setImageStatus(selectedImageFileName);
    else setImageStatus("No image selected");
}

function writeQaFormValues(qaValues) {
    const safe = qaValues && typeof qaValues === "object" ? qaValues : {};

    const promptEl = document.getElementById("imageAndPrompt");
    if (promptEl) promptEl.value = safe.imageAndPrompt ?? "";

    const rewriteEl = document.getElementById("rewriteAnswer");
    if (rewriteEl) rewriteEl.value = safe.rewriteAnswer ?? "";

    const imageInput = document.getElementById("imageFile");
    if (imageInput) imageInput.value = "";
}

let saveTimer = null;

function resetInMemoryState() {
    activeQa = "1";
    selectedImageDataUrl = "";
    selectedImageFileName = "";

    state = {
        shared: {
            taskId: "",
            annotatorOrReviewer: "",
            imageDataUrl: "",
            imageFileName: "",
            lastQa: "1",
        },
        perQa: {
            "1": { imageAndPrompt: "", rewriteAnswer: "" },
            "2": { imageAndPrompt: "", rewriteAnswer: "" },
            "3": { imageAndPrompt: "", rewriteAnswer: "" },
            "4": { imageAndPrompt: "", rewriteAnswer: "" },
            "5": { imageAndPrompt: "", rewriteAnswer: "" },
        }
    };
}

async function clearAllPopupData() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    resetInMemoryState();

    const storageArea = getStorageArea();
    await storageRemove(storageArea, STORAGE_KEY);

    setActiveQa("1");
    writeSharedFormValues(state.shared);
    writeQaFormValues(state.perQa[activeQa]);

    const imageInput = document.getElementById("imageFile");
    if (imageInput) imageInput.value = "";
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(async () => {
        const storageArea = getStorageArea();
        state.shared = readSharedFormValues();
        state.shared.lastQa = activeQa;
        if (!state.perQa[activeQa]) state.perQa[activeQa] = {};
        state.perQa[activeQa] = { ...state.perQa[activeQa], ...readQaFormValues() };

        const payload = state;

        try {
            await storageSet(storageArea, { [STORAGE_KEY]: payload });
        } catch (err) {
            const message = String(err?.message ?? err);
            console.warn("Storage set failed:", message);

            const sharedPayload = payload?.shared;
            if (sharedPayload?.imageDataUrl) {
                sharedPayload.imageDataUrl = "";
                sharedPayload.imageFileName = "";
                selectedImageDataUrl = "";
                selectedImageFileName = "";
                setImageStatus("Image too large to persist; cleared");

                try {
                    await storageSet(storageArea, { [STORAGE_KEY]: payload });
                } catch (err2) {
                    console.warn("Storage retry failed:", String(err2?.message ?? err2));
                }
            }
        }
    }, 150);
}

async function load() {
    const storageArea = getStorageArea();
    const result = await storageGet(storageArea, STORAGE_KEY);
    const stored = result?.[STORAGE_KEY];

    // Default is QA 1, but we'll restore lastQa if available.
    activeQa = "1";

    if (stored && typeof stored === "object") {
        const looksLikeOldSchema =
            ("taskId" in stored) ||
            ("annotatorOrReviewer" in stored) ||
            ("imageAndPrompt" in stored) ||
            ("rewriteAnswer" in stored);

        if (looksLikeOldSchema && !stored.perQa) {
            const migrated = {
                shared: {
                    taskId: stored.taskId ?? "",
                    annotatorOrReviewer: stored.annotatorOrReviewer ?? "",
                    imageDataUrl: stored.imageDataUrl ?? "",
                    imageFileName: stored.imageFileName ?? "",
                    lastQa: "1",
                },
                perQa: {
                    "1": {
                        imageAndPrompt: stored.imageAndPrompt ?? "",
                        rewriteAnswer: stored.rewriteAnswer ?? "",
                    },
                    "2": { imageAndPrompt: "", rewriteAnswer: "" },
                    "3": { imageAndPrompt: "", rewriteAnswer: "" },
                    "4": { imageAndPrompt: "", rewriteAnswer: "" },
                    "5": { imageAndPrompt: "", rewriteAnswer: "" },
                }
            };
            state = migrated;
            await storageSet(storageArea, { [STORAGE_KEY]: migrated });
        } else {
            const nextShared = stored.shared && typeof stored.shared === "object" ? stored.shared : {};
            const nextPerQaRaw = stored.perQa && typeof stored.perQa === "object" ? stored.perQa : {};

            let sharedImageDataUrl = nextShared.imageDataUrl ?? "";
            let sharedImageFileName = nextShared.imageFileName ?? "";

            for (let i = 1; i <= 5; i++) {
                const qa = String(i);
                const qaRaw = nextPerQaRaw?.[qa];
                if (!qaRaw || typeof qaRaw !== "object") continue;

                if (!sharedImageDataUrl && qaRaw.imageDataUrl) sharedImageDataUrl = qaRaw.imageDataUrl;
                if (!sharedImageFileName && qaRaw.imageFileName) sharedImageFileName = qaRaw.imageFileName;
            }

            const cleanedPerQa = {};
            for (let i = 1; i <= 5; i++) {
                const qa = String(i);
                const qaRaw = nextPerQaRaw?.[qa];
                cleanedPerQa[qa] = {
                    imageAndPrompt: (qaRaw && typeof qaRaw === "object" ? qaRaw.imageAndPrompt : "") ?? "",
                    rewriteAnswer: (qaRaw && typeof qaRaw === "object" ? qaRaw.rewriteAnswer : "") ?? "",
                };
            }

            const normalized = {
                shared: {
                    taskId: nextShared.taskId ?? state.shared.taskId,
                    annotatorOrReviewer: nextShared.annotatorOrReviewer ?? state.shared.annotatorOrReviewer,
                    imageDataUrl: sharedImageDataUrl,
                    imageFileName: sharedImageFileName,
                    lastQa: isValidQa(String(nextShared.lastQa ?? "")) ? String(nextShared.lastQa) : "1",
                },
                perQa: cleanedPerQa,
            };

            state = normalized;

            // Persist normalization so we don't carry image per-QA.
            await storageSet(storageArea, { [STORAGE_KEY]: normalized });
        }
    }

    // Restore last selected QA if present.
    const restoredQa = isValidQa(String(state?.shared?.lastQa ?? "")) ? String(state.shared.lastQa) : "1";
    setActiveQa(restoredQa);

    writeSharedFormValues(state.shared);
    writeQaFormValues(state.perQa[activeQa]);
}

async function onSetTaskIdButtonClick() {
    const results = await executeInActiveTabWithResults(() => {
        const el = document.querySelector("p.project-item-name");
        const text = el?.textContent?.trim() ?? "";
        return text;
    });

    const taskText = results
        .map(r => r?.result)
        .find(r => typeof r === "string" && r.trim().length > 0)?.trim() ?? "";

    if (!taskText) {
        console.warn("Set Task ID: no text found for selector p.project-item-name");
        return;
    }

    const taskIdEl = document.getElementById("taskId");
    if (!taskIdEl) return;

    taskIdEl.value = taskText;
    scheduleSave();
}

async function onGetForActiveQaButtonClick(currentQa) {
    // ONLY for the currently active QA button number.
    const index = Number(currentQa) - 1;
    if (!Number.isFinite(index) || index < 0) {
        console.warn("Get: invalid QA index", currentQa);
        return;
    }

    const results = await executeInActiveTabWithResults((idx) => {
        const promptEls = Array.from(document.querySelectorAll('[id^="rewrite_question_"]'));
        const answerEls = Array.from(document.querySelectorAll('[id^="rewrite_answer_"]'));

        const promptEl = promptEls[idx] ?? document.querySelector("#rewrite_question_1");
        const answerEl = answerEls[idx] ?? document.querySelector("#rewrite_answer_1");

        const prompt = (promptEl && "value" in promptEl ? promptEl.value : promptEl?.textContent) ?? "";
        const answer = (answerEl && "value" in answerEl ? answerEl.value : answerEl?.textContent) ?? "";

        return {
            prompt: String(prompt).trim(),
            answer: String(answer).trim(),
        };
    }, [index]);

    const first = results
        .map(r => r?.result)
        .find(r => r && typeof r === "object" && (r.prompt || r.answer)) ?? null;

    if (!first) {
        console.warn("Get: no prompt/answer found on page");
        return;
    }

    const promptEl = document.getElementById("imageAndPrompt");
    const answerEl = document.getElementById("rewriteAnswer");
    if (!promptEl || !answerEl) return;

    promptEl.value = first.prompt ?? "";
    answerEl.value = first.answer ?? "";
    scheduleSave();
}

// ================================
// POPUP INIT
// ================================

document.addEventListener("DOMContentLoaded", async () => {
    await load();

    function attachPressedClass(el) {
        if (!el) return;
        const pressOn = () => el.classList.add("is-pressed");
        const pressOff = () => el.classList.remove("is-pressed");

        el.addEventListener("pointerdown", pressOn);
        el.addEventListener("pointerup", pressOff);
        el.addEventListener("pointercancel", pressOff);
        el.addEventListener("pointerleave", pressOff);
        el.addEventListener("blur", pressOff);

        el.addEventListener("keydown", (e) => {
            if (e.key === " " || e.key === "Enter") pressOn();
        });
        el.addEventListener("keyup", (e) => {
            if (e.key === " " || e.key === "Enter") pressOff();
        });
    }

    // Ensure pressed visual feedback only applies to the button being pressed.
    document.querySelectorAll(".field-actions .clear-btn").forEach(attachPressedClass);
    attachPressedClass(document.getElementById("getBtnQa"));
    attachPressedClass(document.getElementById("refreshBtn"));
    attachPressedClass(document.getElementById("fillSubmitBtn"));

    async function copyTextToClipboard(text) {
        const str = String(text ?? "");
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(str);
                return;
            }
        } catch {
            // fall back
        }

        const tmp = document.createElement("textarea");
        tmp.value = str;
        tmp.setAttribute("readonly", "");
        tmp.style.position = "fixed";
        tmp.style.opacity = "0";
        tmp.style.pointerEvents = "none";
        document.body.appendChild(tmp);
        tmp.select();
        try {
            document.execCommand("copy");
        } finally {
            tmp.remove();
        }
    }

    ["taskId", "imageAndPrompt", "rewriteAnswer"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("input", scheduleSave);
        el.addEventListener("change", scheduleSave);
    });

    for (let i = 1; i <= 5; i++) {
        const btn = document.getElementById(`qaBtn${i}`);
        if (!btn) continue;
        btn.addEventListener("click", () => {
            const nextQa = String(i);
            if (nextQa === activeQa) return;

            // Snapshot current QA fields into memory first
            state.shared = readSharedFormValues();
            state.perQa[activeQa] = { ...state.perQa[activeQa], ...readQaFormValues() };

            setActiveQa(nextQa);
            writeQaFormValues(state.perQa[activeQa]);

            // Image is shared across all QA buttons; keep status consistent.
            setImageStatus(selectedImageFileName || "No image selected");

            scheduleSave();
        });
    }

    const annotatingBtn = document.getElementById("choiceAnnotating");
    if (annotatingBtn) {
        annotatingBtn.addEventListener("click", () => {
            const current = getAnnotatorOrReviewerChoice();
            setAnnotatorOrReviewerChoice(current === "Annotating" ? "" : "Annotating");
            scheduleSave();
        });
    }

    const reviewingBtn = document.getElementById("choiceReviewing");
    if (reviewingBtn) {
        reviewingBtn.addEventListener("click", () => {
            const current = getAnnotatorOrReviewerChoice();
            setAnnotatorOrReviewerChoice(current === "Reviewing" ? "" : "Reviewing");
            scheduleSave();
        });
    }

    const imageInput = document.getElementById("imageFile");
    if (imageInput) {
        imageInput.addEventListener("change", async () => {
            const file = imageInput.files?.[0];
            if (!file) {
                selectedImageDataUrl = "";
                selectedImageFileName = "";
                setImageStatus("No image selected");

                state.shared = readSharedFormValues();
                scheduleSave();
                return;
            }

            selectedImageFileName = file.name;
            setImageStatus(`Reading: ${file.name}`);

            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result ?? ""));
                reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
                reader.readAsDataURL(file);
            });

            selectedImageDataUrl = dataUrl;
            setImageStatus(selectedImageFileName);

            state.shared = readSharedFormValues();
            scheduleSave();
        });
    }

    const setTaskIdBtn = document.getElementById("setTaskIdBtn");
    if (setTaskIdBtn) {
        setTaskIdBtn.addEventListener("click", async () => {
            try {
                await onSetTaskIdButtonClick();
            } catch (err) {
                console.error(err);
            }
        });
    }

    const copyTaskIdBtn = document.getElementById("copyTaskIdBtn");
    if (copyTaskIdBtn) {
        copyTaskIdBtn.addEventListener("click", async () => {
            try {
                const el = document.getElementById("taskId");
                await copyTextToClipboard(el?.value ?? "");
            } catch (err) {
                console.error(err);
            }
        });
    }

    const getBtnQa = document.getElementById("getBtnQa");
    if (getBtnQa) {
        getBtnQa.addEventListener("click", async () => {
            try {
                await onGetForActiveQaButtonClick(activeQa);
            } catch (err) {
                console.error(err);
            }
        });
    }

    const deleteImageBtn = document.getElementById("deleteImageBtn");
    if (deleteImageBtn) {
        deleteImageBtn.addEventListener("click", () => {
            selectedImageDataUrl = "";
            selectedImageFileName = "";
            setImageStatus("No image selected");

            const imageInput = document.getElementById("imageFile");
            if (imageInput) imageInput.value = "";

            state.shared = readSharedFormValues();
            scheduleSave();
        });
    }

    const clearImageAndPromptBtn = document.getElementById("clearImageAndPromptBtn");
    if (clearImageAndPromptBtn) {
        clearImageAndPromptBtn.addEventListener("click", () => {
            const promptEl = document.getElementById("imageAndPrompt");
            if (promptEl) promptEl.value = "";

            if (!state.perQa[activeQa]) state.perQa[activeQa] = { imageAndPrompt: "", rewriteAnswer: "" };
            state.perQa[activeQa].imageAndPrompt = "";

            scheduleSave();
        });
    }

    const copyImageAndPromptBtn = document.getElementById("copyImageAndPromptBtn");
    if (copyImageAndPromptBtn) {
        copyImageAndPromptBtn.addEventListener("click", async () => {
            try {
                const el = document.getElementById("imageAndPrompt");
                await copyTextToClipboard(el?.value ?? "");
            } catch (err) {
                console.error(err);
            }
        });
    }

    const clearRewriteAnswerBtn = document.getElementById("clearRewriteAnswerBtn");
    if (clearRewriteAnswerBtn) {
        clearRewriteAnswerBtn.addEventListener("click", () => {
            const rewriteEl = document.getElementById("rewriteAnswer");
            if (rewriteEl) rewriteEl.value = "";

            if (!state.perQa[activeQa]) state.perQa[activeQa] = { imageAndPrompt: "", rewriteAnswer: "" };
            state.perQa[activeQa].rewriteAnswer = "";

            scheduleSave();
        });
    }

    const copyRewriteAnswerBtn = document.getElementById("copyRewriteAnswerBtn");
    if (copyRewriteAnswerBtn) {
        copyRewriteAnswerBtn.addEventListener("click", async () => {
            try {
                const el = document.getElementById("rewriteAnswer");
                await copyTextToClipboard(el?.value ?? "");
            } catch (err) {
                console.error(err);
            }
        });
    }

    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            try {
                await clearAllPopupData();
            } catch (err) {
                console.error(err);
            }
        });
    }
});
