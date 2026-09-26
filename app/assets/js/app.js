import {
    BLOCK_SIZE, DIR_FRAME_OFFSET, SUPPORTED_FORMATS,
    escapeHtml, getFileExtension, changeFileExtension,
    parseString, parseShiftJIS, countUsedBlocks,
    createBlankCard, formatCardData, deleteSaveFromCard, undeleteSaveOnCard,
    buildMcsExport, importMcsToCard, copySaveData, readCardFile, buildCardFile
} from './memcard.js';

// --- State ---
const cards = [
    { data: null, name: "card1.mcr", loadRequest: 0 },
    { data: null, name: "card2.mcr", loadRequest: 0 }
];
let animationFrame = 0;

// --- Initialization ---
setInterval(() => {
    animationFrame = (animationFrame + 1) % 6;
    renderAllIcons();
}, 250);

// Global D&D
const dropOverlay = document.getElementById('dropOverlay');
document.body.addEventListener('dragover', e => {
    e.preventDefault();
    dropOverlay.classList.toggle('active', !draggedSlot && Array.from(e.dataTransfer.types).includes('Files') && !e.target.closest('.slot-card'));
});
document.body.addEventListener('dragleave', e => {
    if (!e.relatedTarget) dropOverlay.classList.remove('active');
});
document.body.addEventListener('drop', handleGlobalDrop);
document.body.addEventListener('dragend', () => {
    draggedSlot = null;
    dropOverlay.classList.remove('active');
});

// Internal D&D State
let draggedSlot = null; // { cardIndex, slotIndex }

function toggleTheme() {
    SoundManager.play('click');
    const body = document.body;
    const current = body.getAttribute('data-theme');
    const newTheme = current === 'light' ? '' : 'light';
    body.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('ps1-theme', newTheme); } catch (e) { console.warn('Theme persistence unavailable:', e); }
}

// Restore theme from localStorage
(function restoreTheme() {
    try {
        const saved = localStorage.getItem('ps1-theme');
        if (saved) document.body.setAttribute('data-theme', saved);
    } catch (e) { console.warn('Theme persistence unavailable:', e); }
})();

// --- Audio System ---
const SoundManager = {
    sounds: {},
    init() {
        const audioFiles = ['boot', 'hover', 'click', 'save', 'delete', 'error'];
        audioFiles.forEach(name => {
            this.sounds[name] = new Audio(`assets/audio/${name}.wav`);
            this.sounds[name].volume = 0.4;
        });
    },
    play(name) {
        if (this.sounds[name]) {
            this.sounds[name].currentTime = 0;
            this.sounds[name].play().catch(e => console.warn('Audio play failed:', e));
        }
    }
};

document.body.addEventListener('click', () => {
    if (!SoundManager.hasInit) {
        SoundManager.init();
        SoundManager.hasInit = true;
    }
}, { once: true });


// --- Custom Modal Logic ---
let alertCallback = null;

function showCustomAlert(msg, title = "ALERT") {
    if (alertCallback) closeAlert(false);
    SoundManager.play('error');
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = msg;
    document.getElementById('alertOkBtn').style.display = 'inline-block';
    document.getElementById('alertCancelBtn').style.display = 'none';
    document.getElementById('alertModal').classList.add('active');
    return new Promise(resolve => {
        alertCallback = resolve;
    });
}

function showCustomConfirm(msg, title = "CONFIRM") {
    if (alertCallback) closeAlert(false);
    SoundManager.play('click');
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = msg;
    document.getElementById('alertOkBtn').style.display = 'inline-block';
    document.getElementById('alertCancelBtn').style.display = 'inline-block';
    document.getElementById('alertModal').classList.add('active');
    return new Promise(resolve => {
        alertCallback = resolve;
    });
}

function closeAlert(result) {
    SoundManager.play('click');
    document.getElementById('alertModal').classList.remove('active');
    if (alertCallback) {
        alertCallback(result);
        alertCallback = null;
    }
}

// --- Help Modal Logic ---
function toggleHelp() {
    SoundManager.play('click');
    const modal = document.getElementById('helpModal');
    modal.classList.toggle('active');
}

function handleModalClick(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.remove('active');
        SoundManager.play('click');
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeAlert(false);
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
});

// --- File Operations ---
async function loadFile(input, cardIndex) {
    if (input.files.length > 0) await processFile(input.files[0], cardIndex);
    input.value = '';
}

async function handleGlobalDrop(e) {
    e.preventDefault();
    dropOverlay.classList.remove('active');

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
        const file = files[0];

        if (file.name.toLowerCase().endsWith('.mcs')) {
            await showCustomAlert("To import a single save (.mcs), drop it directly onto a SLOT, not the background.", "IMPORT ERROR");
            return;
        }

        await Promise.all(files.slice(0, 2).map((file, cardIndex) => processFile(file, cardIndex)));
    }
}

async function processFile(file, cardIndex) {
    const card = cards[cardIndex];
    const request = ++card.loadRequest;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (request !== card.loadRequest) return;
        Object.assign(card, readCardFile(bytes));
    } catch (error) {
        if (request !== card.loadRequest) return;
        await showCustomAlert(error.message, 'LOAD ERROR');
        return;
    }
    cards[cardIndex].name = file.name;
    SoundManager.play('boot');

    document.getElementById(`status-${cardIndex}`).innerText = file.name;
    document.getElementById(`dl-${cardIndex}`).disabled = false;
    syncFormatDropdown(cardIndex, file.name);
    renderSlots(cardIndex);
}

async function createNewCard(cardIndex) {
    if (cards[cardIndex].data) {
        const confirmDiscard = await showCustomConfirm("Discard current card data and create a new empty card?", "CREATE NEW CARD");
        if (!confirmDiscard) return;
    }

    cards[cardIndex].loadRequest++;
    cards[cardIndex].data = createBlankCard();
    cards[cardIndex].gmeHeader = null;
    cards[cardIndex].name = `new_card_${cardIndex + 1}.mcr`;
    SoundManager.play('save');
    document.getElementById(`status-${cardIndex}`).innerText = "Created New Card";
    document.getElementById(`dl-${cardIndex}`).disabled = false;
    syncFormatDropdown(cardIndex, cards[cardIndex].name);
    renderSlots(cardIndex);
}

function downloadCard(cardIndex) {
    const c = cards[cardIndex];
    if (!c.data) return;
    const blob = new Blob([buildCardFile(c.data, getFileExtension(c.name), c.gmeHeader)], { type: "application/octet-stream" });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = c.name;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Format Selection ---

function changeFormat(cardIndex) {
    const select = document.getElementById(`format-${cardIndex}`);
    cards[cardIndex].name = changeFileExtension(cards[cardIndex].name, select.value);
    document.getElementById(`status-${cardIndex}`).innerText = cards[cardIndex].name;
}

function syncFormatDropdown(cardIndex, filename) {
    const ext = getFileExtension(filename);
    const select = document.getElementById(`format-${cardIndex}`);
    select.value = SUPPORTED_FORMATS.includes(ext) ? ext : '.mcr';
}

// --- Copy Logic ---

function copySave(srcCardIdx, srcSlotIdx, destCardIdx, destSlotIdx) {
    if (srcCardIdx === destCardIdx && srcSlotIdx === destSlotIdx) return;
    if (!cards[srcCardIdx]?.data || !cards[destCardIdx]?.data) return;

    const error = copySaveData(cards[srcCardIdx].data, srcSlotIdx, cards[destCardIdx].data, destSlotIdx);
    if (error) {
        showCustomAlert(error, "COPY ERROR");
        return;
    }

    renderSlots(destCardIdx);
    SoundManager.play('save');
}

// --- Drag & Drop Save Logic ---
function handleDragStart(e, cardIdx, slotIdx) {
    draggedSlot = { cardIndex: cardIdx, slotIndex: slotIdx };
    e.dataTransfer.setData('text/plain', JSON.stringify(draggedSlot));
    e.dataTransfer.effectAllowed = "copy";
}

async function handleSlotDrop(e, destCardIdx, destSlotIdx) {
    e.preventDefault();
    e.stopPropagation();
    dropOverlay.classList.remove('active');

    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (!file.name.toLowerCase().endsWith('.mcs')) {
            await showCustomAlert("Only .mcs files can be imported into slots.", "IMPORT ERROR");
            return;
        }

        await doImportMcs(file, destCardIdx, destSlotIdx);
        return;
    }

    let src = draggedSlot;

    if (!src) {
        try {
            const data = e.dataTransfer.getData('text/plain');
            if (data) src = JSON.parse(data);
        } catch (err) { console.warn('D&D parse error', err); }
    }

    if (!src || !Number.isInteger(src.cardIndex) || src.cardIndex < 0 || src.cardIndex >= cards.length || !Number.isInteger(src.slotIndex) || src.slotIndex < 0 || src.slotIndex >= 15) return;

    copySave(src.cardIndex, src.slotIndex, destCardIdx, destSlotIdx);
    draggedSlot = null;
}

// --- Rendering ---
function renderSlots(cardIndex) {
    if (selectedSlot?.cardIndex === cardIndex) selectedSlot = null;
    const container = document.getElementById(`grid-${cardIndex}`);
    container.innerHTML = '';
    const data = cards[cardIndex].data;
    if (!data) return;

    const usedBlocks = countUsedBlocks(data);

    let counterEl = document.getElementById(`block-counter-${cardIndex}`);
    if (!counterEl) {
        counterEl = document.createElement('div');
        counterEl.id = `block-counter-${cardIndex}`;
        counterEl.className = 'block-counter';
        container.parentNode.insertBefore(counterEl, container);
    }
    counterEl.textContent = `${usedBlocks}/15 BLOCKS USED`;
    counterEl.style.color = usedBlocks >= 13 ? 'var(--danger)' : usedBlocks >= 10 ? 'var(--accent)' : 'var(--success)';

    for (let i = 0; i < 15; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (i * 128);
        const status = data[entryOffset];
        const card = document.createElement('div');
        card.className = 'slot-card';
        card.dataset.card = cardIndex;
        card.dataset.slot = i;

        card.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            card.style.borderColor = "var(--success)";
        });
        card.addEventListener('dragleave', () => {
            card.style.borderColor = "var(--border)";
        });
        card.addEventListener('drop', e => {
            card.style.borderColor = "var(--border)";
            return handleSlotDrop(e, cardIndex, i);
        });

        if (status === 0x51) { // Active
            card.draggable = true;
            card.addEventListener('dragstart', e => handleDragStart(e, cardIndex, i));

            const blockIdx = i + 1;
            const gameId = escapeHtml(parseString(data, entryOffset + 12, 10));
            const title = escapeHtml(parseShiftJIS(data, (blockIdx * BLOCK_SIZE) + 4, 64));

            const sizeBytes = data[entryOffset + 4] | (data[entryOffset + 5] << 8) |
                (data[entryOffset + 6] << 16) | (data[entryOffset + 7] << 24);
            const sizeKB = Math.round(sizeBytes / 1024);
            const blocksUsed = Math.ceil(sizeBytes / BLOCK_SIZE) || 1;

            const tooltipText = `Slot: ${i + 1}\nGame: ${title}\nID: ${gameId}\nSize: ${sizeKB} KB (${blocksUsed} block${blocksUsed > 1 ? 's' : ''})`;

            card.title = tooltipText;
            card.innerHTML = `
            <canvas class="icon-canvas" width="16" height="16"></canvas>
            <div class="slot-info">
                <div class="slot-id">Slot ${i + 1}</div>
                <div class="game-title">${title}</div>
                <div class="game-code">${gameId}</div>
            </div>
            <div class="slot-actions">
                <button class="psx-btn" onclick="exportSave(${cardIndex}, ${i})" title="Export .mcs">
                    <img src="assets/images/psx/b.png" alt="Export">
                </button>
                <button class="psx-btn" onclick="triggerImport(${cardIndex}, ${i})" title="Import .mcs (overwrite)">
                    <img src="assets/images/psx/y.png" alt="Import">
                </button>
                <button class="psx-btn" onclick="deleteSave(${cardIndex}, ${i})" title="Delete">
                    <img src="assets/images/psx/a.png" alt="Delete">
                </button>
            </div>
        `;
        } else if (status >= 0xA0 && status <= 0xA3) { // Empty or deleted
            card.classList.add('empty');
            const hasData = status === 0xA1;
            card.innerHTML = `
            <div style="width:48px;height:48px;background:rgba(0,0,0,0.3);border-radius:4px;border:2px solid var(--border);"></div>
            <div class="slot-info">
                <div class="slot-id">Slot ${i + 1}</div>
                <div class="game-title" style="opacity:0.5">Empty</div>
            </div>
            <div class="slot-actions">
                ${hasData ? `<button class="recover-btn" onclick="undeleteSave(${cardIndex}, ${i})" title="Recover deleted save">RECOVER</button>` : ''}
                <button class="psx-btn" onclick="triggerImport(${cardIndex}, ${i})" title="Import .mcs">
                    <img src="assets/images/psx/y.png" alt="Import">
                </button>
            </div>
        `;
        } else { // Linked
            card.classList.add('empty');
            card.innerHTML = `<div class="slot-info"><div class="slot-id">Slot ${i + 1}</div><div class="game-title" style="opacity:0.5">Linked</div></div>`;
        }
        container.appendChild(card);
    }
    renderIconsForCard(cardIndex);
}

function renderIconsForCard(cardIndex) {
    if (!cards[cardIndex].data) return;
    document.querySelectorAll(`#grid-${cardIndex} .slot-card canvas`).forEach(canvas => {
        const slotIdx = parseInt(canvas.closest('.slot-card').dataset.slot);
        drawIcon(cards[cardIndex].data, slotIdx, canvas);
    });
}

function renderAllIcons() {
    if (cards[0].data) renderIconsForCard(0);
    if (cards[1].data) renderIconsForCard(1);
}

function drawIcon(data, slotIndex, canvas) {
    const ctx = canvas.getContext('2d');
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;

    if (blockStart + 0x80 + 128 > data.length) {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 16, 16);
        return;
    }

    const animMode = data[blockStart + 0x02];
    const paletteOffset = blockStart + 0x60;

    let frameOffset = 0x80;
    if (animMode > 0x11) {
        const maxFrames = (animMode & 0x0F) || 1;
        const currentFrame = animationFrame % maxFrames;
        frameOffset = 0x80 + (currentFrame * 128);

        if (blockStart + frameOffset + 128 > data.length) {
            frameOffset = 0x80;
        }
    }

    const palette = [];
    for (let p = 0; p < 16; p++) {
        const val = data[paletteOffset + p * 2] | (data[paletteOffset + p * 2 + 1] << 8);
        const r = (val & 0x1F) << 3, g = ((val >> 5) & 0x1F) << 3, b = ((val >> 10) & 0x1F) << 3;
        palette.push([r, g, b, (val === 0 ? 0 : 255)]);
    }

    const imgData = ctx.createImageData(16, 16);
    for (let i = 0; i < 128; i++) {
        const byte = data[blockStart + frameOffset + i];
        const px1 = byte & 0x0F, px2 = (byte >> 4) & 0x0F;
        const c1 = palette[px1], c2 = palette[px2];
        const idx1 = i * 8, idx2 = i * 8 + 4;
        imgData.data.set(c1, idx1);
        imgData.data.set(c2, idx2);
    }
    ctx.putImageData(imgData, 0, 0);
}

// --- Save Operations ---

async function deleteSave(cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) return;
    const confirmDelete = await showCustomConfirm("Delete Save?", "DELETE SAVE");
    if (!confirmDelete) return;
    if (cards[cardIndex].data !== data) return;
    const error = deleteSaveFromCard(data, slotIndex);
    if (error) {
        await showCustomAlert(error, 'DELETE ERROR');
        return;
    }
    SoundManager.play('delete');
    renderSlots(cardIndex);
}

function undeleteSave(cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) return;

    const error = undeleteSaveOnCard(data, slotIndex);
    if (error) {
        showCustomAlert(error, 'RECOVERY ERROR');
        return;
    }
    SoundManager.play('save');
    renderSlots(cardIndex);
}

function exportSave(cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) return;

    const result = buildMcsExport(data, slotIndex);
    if (!result) return;

    const blob = new Blob([result.mcsData], { type: "application/octet-stream" });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Import ---

let importTarget = { cardIndex: 0, slotIndex: 0 };

function triggerImport(cardIndex, slotIndex) {
    importTarget = { cardIndex, slotIndex };
    document.getElementById('importInput').click();
}

async function handleImport(input) {
    if (!input.files.length) return;
    const { cardIndex, slotIndex } = importTarget;
    const file = input.files[0];
    await doImportMcs(file, cardIndex, slotIndex);
    input.value = '';
}

async function doImportMcs(file, cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) {
        await showCustomAlert('No card loaded', "ERROR");
        return;
    }

    let mcsData;
    try {
        mcsData = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
        await showCustomAlert(error.message, 'IMPORT ERROR');
        return;
    }
    if (cards[cardIndex].data !== data) {
        await showCustomAlert('The target card changed while reading the save. Please import again.', 'IMPORT ERROR');
        return;
    }
    const error = importMcsToCard(data, mcsData, slotIndex);
    if (error) {
        await showCustomAlert(error, "IMPORT ERROR");
        return;
    }

    SoundManager.play('save');
    renderSlots(cardIndex);
}

// --- Format Card ---

async function formatCard(cardIndex) {
    const data = cards[cardIndex].data;
    if (!data) {
        await showCustomAlert('No card loaded', "ERROR");
        return;
    }

    const confirmFormat = await showCustomConfirm(
        'FORMAT CARD?\n\nThis will DELETE ALL SAVES on this memory card.\nThis action cannot be undone!',
        'DANGER ZONE'
    );

    if (!confirmFormat) return;
    if (cards[cardIndex].data !== data) return;
    formatCardData(data);
    SoundManager.play('delete');
    renderSlots(cardIndex);
}

// --- Keyboard Shortcuts ---

let selectedSlot = null;

document.addEventListener('keydown', e => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || document.querySelector('.modal-overlay.active')) return;

    if (e.key === 'Delete' && selectedSlot) {
        deleteSave(selectedSlot.cardIndex, selectedSlot.slotIndex);
        selectedSlot = null;
    }
});

document.addEventListener('click', e => {
    const slotCard = e.target.closest('.slot-card');
    if (slotCard && !slotCard.classList.contains('empty')) {
        document.querySelectorAll('.slot-card.selected').forEach(s => s.classList.remove('selected'));
        slotCard.classList.add('selected');
        selectedSlot = {
            cardIndex: parseInt(slotCard.dataset.card),
            slotIndex: parseInt(slotCard.dataset.slot)
        };
    }
});

// --- Expose globals for inline onclick handlers ---
window.toggleTheme = toggleTheme;
window.toggleHelp = toggleHelp;
window.handleModalClick = handleModalClick;
window.closeAlert = closeAlert;
window.createNewCard = createNewCard;
window.loadFile = loadFile;
window.downloadCard = downloadCard;
window.changeFormat = changeFormat;
window.formatCard = formatCard;
window.exportSave = exportSave;
window.triggerImport = triggerImport;
window.handleImport = handleImport;
window.deleteSave = deleteSave;
window.undeleteSave = undeleteSave;
window.SoundManager = SoundManager;
