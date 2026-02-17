// Shared helpers + Fill & Submit automation.
// Loaded by popup.html before popup.js.

function getExtensionApi() {
    return globalThis.browser ?? globalThis.chrome;
}

async function executeInActiveTab(func, args = []) {
    const ext = getExtensionApi();

    const tabs = await new Promise((resolve, reject) => {
        ext.tabs.query({ active: true, currentWindow: true }, (result) => {
            if (ext.runtime.lastError) reject(ext.runtime.lastError);
            else resolve(result);
        });
    });

    const activeTab = tabs[0];
    if (!activeTab?.id) throw new Error("No active tab found.");

    await new Promise((resolve, reject) => {
        ext.scripting.executeScript(
            {
                target: { tabId: activeTab.id, allFrames: true }, func, args
            },
            () => {
                if (ext.runtime.lastError) reject(ext.runtime.lastError);
                else resolve();
            }
        );
    });
}

async function executeInActiveTabWithResults(func, args = []) {
    const ext = getExtensionApi();

    const tabs = await new Promise((resolve, reject) => {
        ext.tabs.query({ active: true, currentWindow: true }, (result) => {
            if (ext.runtime.lastError) reject(ext.runtime.lastError);
            else resolve(result);
        });
    });

    const activeTab = tabs[0];
    if (!activeTab?.id) throw new Error("No active tab found.");

    return await new Promise((resolve, reject) => {
        ext.scripting.executeScript(
            {
                target: { tabId: activeTab.id, allFrames: true }, func, args
            },
            (results) => {
                if (ext.runtime.lastError) reject(ext.runtime.lastError);
                else resolve(results ?? []);
            }
        );
    });
}

async function runFillAndSubmitOnActiveTab() {
    // Form state (globals) are defined in popup.js.
    // Script.js orchestrates injection.
    state.shared = readSharedFormValues();
    if (!state.perQa[activeQa]) state.perQa[activeQa] = {};
    state.perQa[activeQa] = { ...state.perQa[activeQa], ...readQaFormValues() };

    // Ensure the image is treated as shared across all QA buttons.
    // Back-compat: if earlier data put the image inside perQa entries, fall back to the first one.
    let sharedImageDataUrl = state?.shared?.imageDataUrl ?? "";
    let sharedImageFileName = state?.shared?.imageFileName ?? "";
    if (!sharedImageDataUrl || !sharedImageFileName) {
        for (let i = 1; i <= 5; i++) {
            const qa = String(i);
            const qaObj = state?.perQa?.[qa];
            if (!qaObj || typeof qaObj !== "object") continue;
            if (!sharedImageDataUrl && qaObj.imageDataUrl) sharedImageDataUrl = qaObj.imageDataUrl;
            if (!sharedImageFileName && qaObj.imageFileName) sharedImageFileName = qaObj.imageFileName;
        }
    }

    const values = {
        taskId: state.shared.taskId,
        annotatorOrReviewer: state.shared.annotatorOrReviewer,
        qaNumber: activeQa,
        imageAndPrompt: state.perQa[activeQa]?.imageAndPrompt ?? "",
        imageDataUrl: sharedImageDataUrl ?? "",
        imageFileName: sharedImageFileName ?? "",
        rewriteAnswer: state.perQa[activeQa]?.rewriteAnswer ?? "",
    };

    await executeInActiveTab(fillTaskIdThenChooseAnnotatingOrReviewingAndSubmit, [
        values.taskId,
        values.annotatorOrReviewer,
        values.qaNumber,
        values.imageAndPrompt,
        values.imageDataUrl,
        values.imageFileName,
        values.rewriteAnswer,
        5
    ]);
}

// Injected into the active tab.
async function fillTaskIdThenChooseAnnotatingOrReviewingAndSubmit(
    taskIdValue,
    annotatorOrReviewerChoice,
    qaNumberValue,
    imageAndPromptValue,
    imageDataUrl,
    imageFileName,
    rewriteAnswerValue,
    cycles
) {
    const GROUP_SELECTOR = 'div.group.w-full.pt-8';
    const groupSelector = GROUP_SELECTOR;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getGroups() {
        return Array.from(document.querySelectorAll(GROUP_SELECTOR));
    }

    function normalizeText(value) {
        return String(value ?? "").trim().replace(/\s+/g, " ");
    }

    function normalizeChoice(value) {
        const t = normalizeText(value).toLowerCase();
        if (t === "annotating") return "Annotating";
        if (t === "reviewing") return "Reviewing";
        return "";
    }

    function setNativeValue(el, value) {
        if (!el) return;
        const str = String(value ?? "");
        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : el instanceof HTMLInputElement
                ? HTMLInputElement.prototype
                : null;

        const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
        const setter = desc?.set;
        if (setter) setter.call(el, str);
        else el.value = str;
    }

    async function waitForCount(expectedCount, timeoutMs = 12000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const groups = getGroups();
            if (groups.length >= expectedCount) return groups;
            await sleep(100);
        }
        throw new Error(`Timed out waiting for ${expectedCount} groups; found ${getGroups().length}.`);
    }

    async function dataUrlToFile(dataUrl, filename) {
        const trimmed = String(dataUrl ?? "").trim();
        const match = trimmed.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) {
            throw new Error("Image data is missing or not a base64 data URL.");
        }
        const mimeType = match[1];
        const base64 = match[2];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const name = filename || "upload";
        return new File([bytes], name, { type: mimeType });
    }

    const attachFileToInput = (fileInput, file) => {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    };

    async function tryUploadImageInContainer(containerEl, file) {
        const uploadBtn =
            containerEl.querySelector('button[type="button"][aria-label="Upload assets"]') ||
            containerEl.querySelector('button[aria-label="Upload assets"]');

        const deadline = Date.now() + 4000;
        let input = containerEl.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
        while (!input && Date.now() < deadline) {
            await sleep(100);
            input = containerEl.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
        }

        if (input) {
            attachFileToInput(input, file);
            return;
        }

        // Fallback: dispatch a drop event with a DataTransfer.
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = uploadBtn || containerEl;
        const dragEvents = ["dragenter", "dragover", "drop"];
        for (const type of dragEvents) {
            target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
    }

    console.log("Filling automation...");
    void cycles;

    const baseGroups = getGroups();
    if (baseGroups.length === 0) {
        throw new Error(`No matching div found for selector: ${groupSelector}`);
    }
    const baseLen = baseGroups.length;

    // --- Script #1
    const container1 = baseGroups[baseGroups.length - 1];
    const textarea1 = container1.querySelector('textarea');
    if (!textarea1) throw new Error('No textarea found inside the last div.group.w-full.pt-8 (script #1)');
    textarea1.focus();
    setNativeValue(textarea1, taskIdValue);
    textarea1.dispatchEvent(new Event('input', { bubbles: true }));
    textarea1.dispatchEvent(new Event('change', { bubbles: true }));
    const submitBtn1 = container1.querySelector('button[type="submit"]');
    if (!submitBtn1) throw new Error('No button[type="submit"] found inside the last div.group.w-full.pt-8 (script #1)');
    submitBtn1.click();
    const groupsAfter1 = await waitForCount(baseLen + 1);

    // --- Script #2
    const container2 = groupsAfter1[groupsAfter1.length - 1];
    const choice = normalizeChoice(annotatorOrReviewerChoice);
    const typeButtons = Array.from(container2.querySelectorAll('button[type="button"]'));
    const byText = new Map(typeButtons.map((b) => [normalizeText(b.textContent), b]));
    const annotatingBtn = byText.get('Annotating');
    const reviewingBtn = byText.get('Reviewing');
    if (!annotatingBtn || !reviewingBtn) {
        throw new Error('Expected two button[type="button"] in the last group with text "Annotating" and "Reviewing" (script #2).');
    }
    if (choice === 'Annotating') annotatingBtn.click();
    else if (choice === 'Reviewing') reviewingBtn.click();
    else throw new Error('Popup field #2 must be selected: "Annotating" or "Reviewing".');
    const submitBtn2 = container2.querySelector('button[type="submit"]');
    if (!submitBtn2) throw new Error('No button[type="submit"] found inside the last div.group.w-full.pt-8 (script #2)');
    await sleep(50);
    submitBtn2.click();
    const groupsAfter2 = await waitForCount(baseLen + 2);

    // --- Script #3
    const container3 = groupsAfter2[groupsAfter2.length - 1];
    const numberInput = container3.querySelector('input[type="number"]');
    if (!numberInput) throw new Error('No input[type="number"] found inside the last div.group.w-full.pt-8 (script #3)');
    const qaNormalized = normalizeText(qaNumberValue);
    numberInput.focus();
    setNativeValue(numberInput, qaNormalized);
    numberInput.dispatchEvent(new Event('input', { bubbles: true }));
    numberInput.dispatchEvent(new Event('change', { bubbles: true }));
    const submitBtn3 = container3.querySelector('button[type="submit"]');
    if (!submitBtn3) throw new Error('No button[type="submit"] found inside the last div.group.w-full.pt-8 (script #3)');
    await sleep(50);
    submitBtn3.click();
    const groupsAfter3 = await waitForCount(baseLen + 3);

    // --- Script #4 (requires count >= baseLen+3 before running)
    if (groupsAfter3.length < baseLen + 3) {
        throw new Error(`Script #4 pre-check failed: expected at least ${baseLen + 3} groups, found ${groupsAfter3.length}.`);
    }
    const container4 = groupsAfter3[groupsAfter3.length - 1];
    const textarea4 = container4.querySelector('textarea');
    if (!textarea4) throw new Error('No textarea found inside the last div.group.w-full.pt-8 (script #4)');
    textarea4.focus();
    setNativeValue(textarea4, imageAndPromptValue);
    textarea4.dispatchEvent(new Event('input', { bubbles: true }));
    textarea4.dispatchEvent(new Event('change', { bubbles: true }));

    if (String(imageDataUrl ?? "").trim()) {
        const file = await dataUrlToFile(imageDataUrl, normalizeText(imageFileName) || "upload.png");
        await tryUploadImageInContainer(container4, file);
    }

    const submitBtn4 = container4.querySelector('button[type="submit"]');
    if (!submitBtn4) throw new Error('No button[type="submit"] found inside the last div.group.w-full.pt-8 (script #4)');
    await sleep(80);
    submitBtn4.click();
    const groupsAfter4 = await waitForCount(baseLen + 4);

    // --- Script #5 (Rewrite Answer)

    const container5 = groupsAfter4[groupsAfter4.length - 1];
    const textarea5 = container5.querySelector('textarea');
    if (!textarea5) throw new Error('No textarea found inside the last div.group.w-full.pt-8 (script #5)');
    textarea5.focus();
    setNativeValue(textarea5, rewriteAnswerValue);
    textarea5.dispatchEvent(new Event('input', { bubbles: true }));
    textarea5.dispatchEvent(new Event('change', { bubbles: true }));
    const submitBtn5 = container5.querySelector('button[type="submit"]');
    if (!submitBtn5) throw new Error('No button[type="submit"] found inside the last div.group.w-full.pt-8 (script #5)');
    await sleep(50);
    submitBtn5.click();
    await waitForCount(baseLen + 5);
}

// Wire the popup button here (moved from popup.js).
document.addEventListener("DOMContentLoaded", () => {
    const fillBtn = document.getElementById("fillSubmitBtn");
    if (!fillBtn) return;
    fillBtn.addEventListener("click", async () => {
        try {
            await runFillAndSubmitOnActiveTab();
        } catch (err) {
            console.error(err);
        }
    });
});
