// --- Constants ---
const BLOCK_SIZE = 8192;
const CARD_SIZE = 131072;
const DIR_FRAME_OFFSET = 128;

// --- State ---
const cards = [
    {data: null, name: "card1.mcr"},
    {data: null, name: "card2.mcr"}
];
let animationFrame = 0;

// --- Initialization ---
setInterval(() => {
    animationFrame = (animationFrame + 1) % 3;
    renderAllIcons();
}, 250);

// Global D&D
const dropOverlay = document.getElementById('dropOverlay');
document.body.addEventListener('dragover', e => {
    e.preventDefault();
    dropOverlay.classList.add('active');
});
document.body.addEventListener('dragleave', e => {
    if (e.target === dropOverlay) dropOverlay.classList.remove('active');
});
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

// --- Audio System ---
const SoundManager = {
    sounds: {},
    init() {
        // Preload sounds - USER must provide these files in app/assets/audio/
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

// Initialize Audio on first interaction to bypass browser policies
document.body.addEventListener('click', () => {
    if (!SoundManager.hasInit) {
        SoundManager.init();
        SoundManager.hasInit = true;
    }
}, {once: true});


// --- Custom Modal Logic ---
let alertCallback = null;

function showCustomAlert(msg, title = "ALERT") {
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

// Close on Escape key
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
});

// --- File Operations ---
async function loadFile(input, cardIndex) {
    if (input.files.length > 0) await processFile(input.files[0], cardIndex);
}

async function handleGlobalDrop(e) {
    e.preventDefault();
    dropOverlay.classList.remove('active');

    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];

        // Check if user dropped an MCS file globally (common mistake)
        if (file.name.toLowerCase().endsWith('.mcs')) {
            await showCustomAlert("To import a single save (.mcs), drop it directly onto a SLOT, not the background.", "IMPORT ERROR");
            return;
        }

        await processFile(file, 0);
        if (e.dataTransfer.files.length > 1) await processFile(e.dataTransfer.files[1], 1);
    }
}

async function processFile(file, cardIndex) {
    const buf = await file.arrayBuffer();
    if (buf.byteLength < CARD_SIZE) {
        await showCustomAlert("File too small to be a memory card.", "LOAD ERROR");
        return;
    }

    cards[cardIndex].data = new Uint8Array(buf.slice(0, CARD_SIZE));
    cards[cardIndex].name = file.name;
    SoundManager.play('boot');

    document.getElementById(`status-${cardIndex}`).innerText = file.name;
    document.getElementById(`dl-${cardIndex}`).disabled = false;
    renderSlots(cardIndex);
}

async function createNewCard(cardIndex) {
    if (cards[cardIndex].data) {
        const confirmDiscard = await showCustomConfirm("Discard current card data and create a new empty card?", "CREATE NEW CARD");
        if (!confirmDiscard) return;
    }

    const data = new Uint8Array(CARD_SIZE);
    data[0] = 77;
    data[1] = 67;
    data[127] = 0x0E;
    for (let i = 0; i < 15; i++) {
        const off = DIR_FRAME_OFFSET + (i * 128);
        data[off] = 0xA0; // Free
        data[off + 4] = 0;
        data[off + 5] = 0;
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
    const blob = new Blob([c.data], {type: "application/octet-stream"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = c.name;
    a.click();
}

// --- Copy Logic ---
// --- Copy Logic ---

// Helper: Get all slots associated with a save (start -> linked -> linked...)
function getLinkedBlocks(cardIndex, startSlot) {
    const data = cards[cardIndex].data;
    const slots = [startSlot];
    let currentSlot = startSlot;

    // Safety limit to prevent infinite loops in corrupted cards
    let safety = 0;
    while (safety++ < 15) {
        const entryOffset = DIR_FRAME_OFFSET + (currentSlot * 128);
        const linkVal = data[entryOffset + 8] | (data[entryOffset + 9] << 8);

        // Check for End of Link (0xFFFF) or invalid link
        if (linkVal === 0xFFFF) break;

        // In a valid PS1 card, the link points to the NEXT slot index (0-14).
        // If it's outside this range, it's invalid or end of chain.
        // Note: Some docs say 0xFFFF is end, but actual hardware behavior can vary.
        // We assume valid slot index implies a link.
        if (linkVal >= 15) break;

        // Circular link check
        if (slots.includes(linkVal)) break;

        slots.push(linkVal);
        currentSlot = linkVal;
    }
    return slots;
}

// Helper: Find N free slots on a card
function findFreeSlots(cardIndex, count) {
    const data = cards[cardIndex].data;
    const freeSlots = [];

    for (let i = 0; i < 15; i++) {
        const status = data[DIR_FRAME_OFFSET + (i * 128)];
        if (status === 0xA0) { // Free
            freeSlots.push(i);
        }
    }

    if (freeSlots.length < count) return null;
    return freeSlots.slice(0, count);
}

function copySave(srcCardIdx, srcSlotIdx, destCardIdx, destSlotIdx) {
    if (srcCardIdx === destCardIdx && srcSlotIdx === destSlotIdx) return;
    if (!cards[srcCardIdx].data || !cards[destCardIdx].data) return;

    const sourceSlots = getLinkedBlocks(srcCardIdx, srcSlotIdx);
    const destTargets = findFreeSlots(destCardIdx, sourceSlots.length);

    if (!destTargets) {
        showCustomAlert(`Not enough free blocks! Need ${sourceSlots.length} blocks.`, "COPY ERROR");
        return;
    }

    // If the user dropped onto a specific empty slot, try to use that as the start
    // provided it is in our freeSlots list.
    const preferredStartIdx = destTargets.indexOf(destSlotIdx);
    if (preferredStartIdx !== -1) {
        // Rotate array so destSlotIdx is first
        // actually, we just need to assign source[0] to destSlotIdx.
        // Let's just swap the preferred slot to the front of the allocation list
        [destTargets[0], destTargets[preferredStartIdx]] = [destTargets[preferredStartIdx], destTargets[0]];
    }

    const srcData = cards[srcCardIdx].data;
    const destData = cards[destCardIdx].data;

    // Copy Loop
    for (let i = 0; i < sourceSlots.length; i++) {
        const srcSlot = sourceSlots[i];
        const destSlot = destTargets[i];

        // 1. Copy Block Data (8KB)
        const srcBlockStart = (srcSlot + 1) * BLOCK_SIZE;
        const destBlockStart = (destSlot + 1) * BLOCK_SIZE;
        destData.set(srcData.slice(srcBlockStart, srcBlockStart + BLOCK_SIZE), destBlockStart);

        // 2. Copy Directory Entry (128 bytes)
        const srcEntryOffset = DIR_FRAME_OFFSET + (srcSlot * 128);
        const destEntryOffset = DIR_FRAME_OFFSET + (destSlot * 128);
        for (let k = 0; k < 128; k++) destData[destEntryOffset + k] = srcData[srcEntryOffset + k];

        // 3. Update Link Pointers
        if (i < sourceSlots.length - 1) {
            // Point to the next allocated slot
            const nextDestSlot = destTargets[i + 1];
            destData[destEntryOffset + 8] = nextDestSlot & 0xFF;
            destData[destEntryOffset + 9] = (nextDestSlot >> 8) & 0xFF;
        } else {
            // End of chain
            destData[destEntryOffset + 8] = 0xFF;
            destData[destEntryOffset + 9] = 0xFF;
        }

        // 4. Update Checksum
        updateChecksum(destData, destEntryOffset);
    }

    renderSlots(destCardIdx);
}

// --- Drag & Drop Save Logic ---
function handleDragStart(e, cardIdx, slotIdx) {
    draggedSlot = {cardIndex: cardIdx, slotIndex: slotIdx};
    e.dataTransfer.effectAllowed = "copy";
}

async function handleSlotDrop(e, destCardIdx, destSlotIdx) {
    e.preventDefault();

    // Check for External File Drop (Import .mcs)
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (!file.name.toLowerCase().endsWith('.mcs')) {
            await showCustomAlert("Only .mcs files can be imported into slots.", "IMPORT ERROR");
            return;
        }

        const buf = await file.arrayBuffer();
        const mcsData = new Uint8Array(buf);
        await importMcsData(mcsData, destCardIdx, destSlotIdx);
        return;
    }

    // Handle Internal Save Move
    if (!draggedSlot) return;

    copySave(draggedSlot.cardIndex, draggedSlot.slotIndex, destCardIdx, destSlotIdx);
    draggedSlot = null;
    SoundManager.play('save');
}

// --- Rendering ---
function renderSlots(cardIndex) {
    const container = document.getElementById(`grid-${cardIndex}`);
    container.innerHTML = '';
    const data = cards[cardIndex].data;
    if (!data) return;

    // Count used blocks for block counter
    let usedBlocks = 0;
    for (let i = 0; i < 15; i++) {
        const status = data[DIR_FRAME_OFFSET + (i * 128)];
        if (status === 0x51 || status === 0x52 || status === 0x53) usedBlocks++;
    }

    // Update block counter display
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

        // Drop Targets
        card.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            card.style.borderColor = "var(--success)";
        });
        card.addEventListener('dragleave', e => {
            card.style.borderColor = "var(--border)";
        });
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
        } else if (status === 0xA0) { // Empty
            card.classList.add('empty');
            // Check if slot has recoverable data
            const hasData = slotHasData(data, i);
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
        imgData.data.set(c1, idx1);
        imgData.data.set(c2, idx2);
    }
    ctx.putImageData(imgData, 0, 0);
}

async function deleteSave(cardIndex, slotIndex) {
    const confirmDelete = await showCustomConfirm("Permanently Delete Save?", "DELETE SAVE");
    if (!confirmDelete) return;

    const data = cards[cardIndex].data;
    const off = DIR_FRAME_OFFSET + (slotIndex * 128);

    // FIX: Only mark directory entry as Free (0xA0). DO NOT wipe data block.
    // This allows "Undelete" to work correctly.
    data[off] = 0xA0; // Free

    // Update checksum for the modified directory entry
    updateChecksum(data, off);

    SoundManager.play('delete');
    renderSlots(cardIndex);
}

function updateChecksum(data, offset) {
    let x = 0;
    for (let k = 0; k < 127; k++) x ^= data[offset + k];
    data[offset + 127] = x;
}

function parseString(data, o, len) {
    let s = "";
    for (let k = 0; k < len; k++) {
        if (data[o + k] === 0) break;
        s += String.fromCharCode(data[o + k]);
    }
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

    const blob = new Blob([mcsData], {type: "application/octet-stream"});
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

    SoundManager.play('save'); // Play save sound for recovery
    renderSlots(cardIndex);
}

// Import state
let importTarget = {cardIndex: 0, slotIndex: 0};

function triggerImport(cardIndex, slotIndex) {
    importTarget = {cardIndex, slotIndex};
    document.getElementById('importInput').click();
}

async function handleImport(input) {
    if (!input.files.length) return;

    const file = input.files[0];
    const buf = await file.arrayBuffer();
    const mcsData = new Uint8Array(buf);

    // Validate .mcs file size (128-byte header + 8KB data)
    if (mcsData.length < 128 + BLOCK_SIZE) {
        await showCustomAlert('Invalid .mcs file: too small', "IMPORT ERROR");
        input.value = '';
        return;
    }

    const {cardIndex, slotIndex} = importTarget;
    // Direct call support for drag & drop import
    await importMcsData(mcsData, cardIndex, slotIndex);
    input.value = '';
}

// Refactored Import Logic to be shared
async function importMcsData(mcsData, cardIndex, slotIndex) {
    const data = cards[cardIndex].data;
    if (!data) {
        await showCustomAlert('No card loaded', "ERROR");
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

    SoundManager.play('save'); // Play success sound
    renderSlots(cardIndex);
}


// --- Advanced Features ---

// Format card (wipe all saves)
async function formatCard(cardIndex) {
    if (!cards[cardIndex].data) {
        await showCustomAlert('No card loaded', "ERROR");
        return;
    }

    const confirmFormat = await showCustomConfirm(
        'FORMAT CARD?\n\nThis will DELETE ALL SAVES on this memory card.\nThis action cannot be undone!',
        'DANGER ZONE'
    );

    if (!confirmFormat) return;

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

    SoundManager.play('delete'); // Play big delete sound
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
