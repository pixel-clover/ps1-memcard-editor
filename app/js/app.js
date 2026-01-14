// --- Constants ---
const BLOCK_SIZE = 8192;
const CARD_SIZE = 131072;
const DIR_FRAME_OFFSET = 128;

// --- State ---
const cards = [
    { data: null, name: "card1.mcr" },
    { data: null, name: "card2.mcr" }
];
let animationFrame = 0;

// --- Initialization ---
setInterval(() => {
    animationFrame = (animationFrame + 1) % 3;
    renderAllIcons();
}, 250);

// Global D&D
const dropOverlay = document.getElementById('dropOverlay');
document.body.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('active'); });
document.body.addEventListener('dragleave', e => { if (e.target === dropOverlay) dropOverlay.classList.remove('active'); });
document.body.addEventListener('drop', handleGlobalDrop);

// Internal D&D State
let draggedSlot = null; // { cardIndex, slotIndex }

function toggleTheme() {
    const body = document.body;
    const current = body.getAttribute('data-theme');
    const newTheme = current === 'light' ? '' : 'light';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('ps1-theme', newTheme);
}

// Restore theme from localStorage
(function restoreTheme() {
    const saved = localStorage.getItem('ps1-theme');
    if (saved) document.body.setAttribute('data-theme', saved);
})();

// --- File Operations ---
async function loadFile(input, cardIndex) {
    if (input.files.length > 0) await processFile(input.files[0], cardIndex);
}

async function handleGlobalDrop(e) {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    if (e.dataTransfer.files.length > 0) {
        await processFile(e.dataTransfer.files[0], 0);
        if (e.dataTransfer.files.length > 1) await processFile(e.dataTransfer.files[1], 1);
    }
}

async function processFile(file, cardIndex) {
    const buf = await file.arrayBuffer();
    if (buf.byteLength < CARD_SIZE) { alert("File too small to be a memory card."); return; }

    cards[cardIndex].data = new Uint8Array(buf.slice(0, CARD_SIZE));
    cards[cardIndex].name = file.name;

    document.getElementById(`status-${cardIndex}`).innerText = file.name;
    document.getElementById(`dl-${cardIndex}`).disabled = false;
    renderSlots(cardIndex);
}

function createNewCard(cardIndex) {
    if (cards[cardIndex].data && !confirm("Discard this card?")) return;

    const data = new Uint8Array(CARD_SIZE);
    data[0] = 77; data[1] = 67; data[127] = 0x0E;
    for (let i = 0; i < 15; i++) {
        const off = DIR_FRAME_OFFSET + (i * 128);
        data[off] = 0xA0; // Free
        data[off + 4] = 0; data[off + 5] = 0;
        updateChecksum(data, off);
    }

    cards[cardIndex].data = data;
    cards[cardIndex].name = `new_card_${cardIndex + 1}.mcr`;
    document.getElementById(`status-${cardIndex}`).innerText = "Created New Card";
    document.getElementById(`dl-${cardIndex}`).disabled = false;
    renderSlots(cardIndex);
}

function downloadCard(cardIndex) {
    const c = cards[cardIndex];
    if (!c.data) return;
    const blob = new Blob([c.data], { type: "application/octet-stream" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = c.name;
    a.click();
}

// --- Copy Logic ---
function copySave(srcCardIdx, srcSlotIdx, destCardIdx, destSlotIdx) {
    if (srcCardIdx === destCardIdx && srcSlotIdx === destSlotIdx) return;
    if (!cards[srcCardIdx].data || !cards[destCardIdx].data) return;

    const srcData = cards[srcCardIdx].data;
    const destData = cards[destCardIdx].data;

    // Source Offsets
    const srcBlockIdx = srcSlotIdx + 1;
    const srcBlockStart = srcBlockIdx * BLOCK_SIZE;
    const srcEntryOffset = DIR_FRAME_OFFSET + (srcSlotIdx * 128);

    // Dest Offsets
    const destBlockIdx = destSlotIdx + 1;
    const destBlockStart = destBlockIdx * BLOCK_SIZE;
    const destEntryOffset = DIR_FRAME_OFFSET + (destSlotIdx * 128);

    // Copy 8KB Block
    destData.set(srcData.slice(srcBlockStart, srcBlockStart + BLOCK_SIZE), destBlockStart);

    // Copy Directory Entry (Status, ID, Name)
    // We copy the first 128 bytes of the directory entry
    for (let k = 0; k < 128; k++) destData[destEntryOffset + k] = srcData[srcEntryOffset + k];

    // Recalculate Checksum
    updateChecksum(destData, destEntryOffset);

    renderSlots(destCardIdx);
}

// --- Drag & Drop Save Logic ---
function handleDragStart(e, cardIdx, slotIdx) {
    draggedSlot = { cardIndex: cardIdx, slotIndex: slotIdx };
    e.dataTransfer.effectAllowed = "copy";
}

function handleSlotDrop(e, destCardIdx, destSlotIdx) {
    e.preventDefault();
    if (!draggedSlot) return;

    copySave(draggedSlot.cardIndex, draggedSlot.slotIndex, destCardIdx, destSlotIdx);
    draggedSlot = null;
}

// --- Rendering ---
function renderSlots(cardIndex) {
    const container = document.getElementById(`grid-${cardIndex}`);
    container.innerHTML = '';
    const data = cards[cardIndex].data;
    if (!data) return;

    for (let i = 0; i < 15; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (i * 128);
        const status = data[entryOffset];
        const card = document.createElement('div');
        card.className = 'slot-card';
        card.dataset.card = cardIndex;
        card.dataset.slot = i;

        // Drop Targets
        card.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; card.style.borderColor = "var(--success)"; });
        card.addEventListener('dragleave', e => { card.style.borderColor = "var(--border)"; });
        card.addEventListener('drop', e => {
            card.style.borderColor = "var(--border)";
            handleSlotDrop(e, cardIndex, i);
        });

        if (status === 0x51) { // Active
            card.draggable = true;
            card.addEventListener('dragstart', e => handleDragStart(e, cardIndex, i));

            const blockIdx = i + 1;
            const gameId = parseString(data, entryOffset + 12, 10);
            const title = parseShiftJIS(data, (blockIdx * BLOCK_SIZE) + 4, 64);

            // Get save size from directory entry (bytes 4-7)
            const sizeBytes = data[entryOffset + 4] | (data[entryOffset + 5] << 8) |
                (data[entryOffset + 6] << 16) | (data[entryOffset + 7] << 24);
            const sizeKB = Math.round(sizeBytes / 1024);
            const blocksUsed = Math.ceil(sizeBytes / BLOCK_SIZE) || 1;

            // Create tooltip text
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
                <button class="action-btn" onclick="exportSave(${cardIndex}, ${i})" title="Export .mcs">📤</button>
                <button class="action-btn" onclick="triggerImport(${cardIndex}, ${i})" title="Import .mcs (overwrite)">📥</button>
                <button class="psx-btn" onclick="deleteSave(${cardIndex}, ${i})" title="Delete">
                    <img src="images/psx/a.png" alt="Delete">
                </button>
            </div>
        `;
        } else if (status === 0xA0) { // Empty
            card.classList.add('empty');
            // Check if slot has recoverable data
            const hasData = slotHasData(data, i);
            card.innerHTML = `
            <div style="width:48px;height:48px;background:rgba(0,0,0,0.1);border-radius:4px;"></div>
            <div class="slot-info">
                <div class="slot-id">Slot ${i + 1}</div>
                <div class="game-title" style="opacity:0.5">Empty</div>
            </div>
            <div class="slot-actions">
                ${hasData ? `<button class="recover-btn" onclick="undeleteSave(${cardIndex}, ${i})" title="Recover deleted save">↩ Recover</button>` : ''}
                <button class="action-btn" onclick="triggerImport(${cardIndex}, ${i})" title="Import .mcs">📥</button>
            </div>
        `;
        } else { // Linked
            card.classList.add('empty');
            card.innerHTML = `<div class="slot-info">Linked</div>`;
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

    // Boundary check to prevent reading past array bounds
    if (blockStart + 0x80 + 128 > data.length) {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 16, 16);
        return;
    }

    const animMode = data[blockStart + 0x02];
    const paletteOffset = blockStart + 0x60;

    let frameOffset = 0x80;
    if (animMode > 0x11) {
        const maxFrames = (animMode & 0x0F) || 1; // Prevent division by zero
        const currentFrame = animationFrame % maxFrames;
        frameOffset = 0x80 + (currentFrame * 128);

        // Check if frame would exceed bounds
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
        imgData.data.set(c1, idx1); imgData.data.set(c2, idx2);
    }
    ctx.putImageData(imgData, 0, 0);
}

function deleteSave(cardIndex, slotIndex) {
    if (!confirm("Delete save?")) return;
    const data = cards[cardIndex].data;
    const off = DIR_FRAME_OFFSET + (slotIndex * 128);
    data[off] = 0xA0; // Free
    for (let k = 0; k < 64; k++) data[((slotIndex + 1) * BLOCK_SIZE) + 4 + k] = 0;
    updateChecksum(data, off);
    renderSlots(cardIndex);
}

function updateChecksum(data, offset) {
    let x = 0;
    for (let k = 0; k < 127; k++) x ^= data[offset + k];
    data[offset + 127] = x;
}

function parseString(data, o, len) {
    let s = ""; for (let k = 0; k < len; k++) { if (data[o + k] === 0) break; s += String.fromCharCode(data[o + k]); }
    return s;
}

function parseShiftJIS(data, offset, length) {
    let sub = data.slice(offset, offset + length);
    let end = sub.indexOf(0);
    if (end >= 0) sub = sub.slice(0, end);
    return new TextDecoder('shift-jis').decode(sub);
}

// --- Phase 1: New Features ---

// Check if an empty slot has recoverable data
function slotHasData(data, slotIndex) {
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;
    // Check if there's any non-zero data in the first 128 bytes of the block
    for (let i = 0; i < 128; i++) {
        if (data[blockStart + i] !== 0) return true;
    }
    return false;
}

// Export a single save as .mcs file
function exportSave(cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) return;

    const entryOffset = DIR_FRAME_OFFSET + (slotIndex * 128);
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;
    const gameId = parseString(data, entryOffset + 12, 10);

    // .mcs format: 128-byte header (copy of directory entry) + 8192-byte data block
    const mcsData = new Uint8Array(128 + BLOCK_SIZE);

    // Copy directory entry as header
    for (let i = 0; i < 128; i++) {
        mcsData[i] = data[entryOffset + i];
    }

    // Copy data block
    mcsData.set(data.slice(blockStart, blockStart + BLOCK_SIZE), 128);

    const blob = new Blob([mcsData], { type: "application/octet-stream" });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${gameId || 'save'}_slot${slotIndex + 1}.mcs`;
    a.click();
}


// Undelete a save (restore deleted slot)
function undeleteSave(cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) return;

    const entryOffset = DIR_FRAME_OFFSET + (slotIndex * 128);

    // Set status back to Active (0x51)
    data[entryOffset] = 0x51;
    updateChecksum(data, entryOffset);
    renderSlots(cardIndex);
}

// Import state
let importTarget = { cardIndex: 0, slotIndex: 0 };

function triggerImport(cardIndex, slotIndex) {
    importTarget = { cardIndex, slotIndex };
    document.getElementById('importInput').click();
}

async function handleImport(input) {
    if (!input.files.length) return;

    const file = input.files[0];
    const buf = await file.arrayBuffer();
    const mcsData = new Uint8Array(buf);

    // Validate .mcs file size (128-byte header + 8KB data)
    if (mcsData.length < 128 + BLOCK_SIZE) {
        alert('Invalid .mcs file: too small');
        input.value = '';
        return;
    }

    const { cardIndex, slotIndex } = importTarget;
    const data = cards[cardIndex].data;
    if (!data) {
        alert('No card loaded');
        input.value = '';
        return;
    }

    const entryOffset = DIR_FRAME_OFFSET + (slotIndex * 128);
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;

    // Copy header to directory entry
    for (let i = 0; i < 128; i++) {
        data[entryOffset + i] = mcsData[i];
    }

    // Copy data block
    data.set(mcsData.slice(128, 128 + BLOCK_SIZE), blockStart);

    // Recalculate checksum
    updateChecksum(data, entryOffset);

    input.value = '';
    renderSlots(cardIndex);
}


// --- Advanced Features ---

// Format card (wipe all saves)
function formatCard(cardIndex) {
    if (!cards[cardIndex].data) {
        alert('No card loaded');
        return;
    }

    if (!confirm('⚠️ FORMAT CARD?\n\nThis will DELETE ALL SAVES on this memory card.\nThis action cannot be undone!')) {
        return;
    }

    const data = cards[cardIndex].data;

    // Reinitialize all 15 directory entries as free
    for (let i = 0; i < 15; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (i * 128);

        // Clear directory entry
        for (let k = 0; k < 128; k++) {
            data[entryOffset + k] = 0;
        }

        // Set status to Free
        data[entryOffset] = 0xA0;

        // Update checksum
        updateChecksum(data, entryOffset);

        // Optionally clear data block too
        const blockStart = (i + 1) * BLOCK_SIZE;
        for (let k = 0; k < BLOCK_SIZE; k++) {
            data[blockStart + k] = 0;
        }
    }

    renderSlots(cardIndex);
}

// Keyboard shortcuts
let selectedSlot = null; // { cardIndex, slotIndex }

document.addEventListener('keydown', e => {
    // Don't trigger shortcuts when typing in search
    if (e.target.tagName === 'INPUT') return;

    // Delete key - delete selected slot
    if (e.key === 'Delete' && selectedSlot) {
        deleteSave(selectedSlot.cardIndex, selectedSlot.slotIndex);
        selectedSlot = null;
    }
});

// Click to select slot
document.addEventListener('click', e => {
    const slotCard = e.target.closest('.slot-card');
    if (slotCard && !slotCard.classList.contains('empty')) {
        // Deselect previous
        document.querySelectorAll('.slot-card.selected').forEach(s => s.classList.remove('selected'));
        slotCard.classList.add('selected');
        selectedSlot = {
            cardIndex: parseInt(slotCard.dataset.card),
            slotIndex: parseInt(slotCard.dataset.slot)
        };
    }
});
