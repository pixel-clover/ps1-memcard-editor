// --- PS1 Memory Card Logic Module ---
// Pure data-manipulation functions with no DOM dependencies.

export const BLOCK_SIZE = 8192;
export const CARD_SIZE = 131072;
export const DIR_FRAME_OFFSET = 128;
export const SUPPORTED_FORMATS = ['.mcr', '.bin', '.gme', '.mcd', '.srm'];
export const MCS_FRAME_SIZE = 128 + BLOCK_SIZE;

// --- Utility ---

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function getFileExtension(filename) {
    const dot = filename.lastIndexOf('.');
    return dot !== -1 ? filename.substring(dot).toLowerCase() : '';
}

export function changeFileExtension(filename, newExt) {
    const dot = filename.lastIndexOf('.');
    const baseName = dot !== -1 ? filename.substring(0, dot) : filename;
    return baseName + newExt;
}

// --- Binary Parsing ---

export function updateChecksum(data, offset) {
    let x = 0;
    for (let k = 0; k < 127; k++) x ^= data[offset + k];
    data[offset + 127] = x;
}

export function verifyChecksum(data, offset) {
    let x = 0;
    for (let k = 0; k < 127; k++) x ^= data[offset + k];
    return data[offset + 127] === x;
}

export function parseString(data, o, len) {
    let s = "";
    for (let k = 0; k < len; k++) {
        if (data[o + k] === 0) break;
        s += String.fromCharCode(data[o + k]);
    }
    return s;
}

export function parseShiftJIS(data, offset, length) {
    let sub = data.slice(offset, offset + length);
    let end = sub.indexOf(0);
    if (end >= 0) sub = sub.slice(0, end);
    return new TextDecoder('shift-jis').decode(sub);
}

// --- Card Structure ---

export function getLinkedBlocks(data, startSlot) {
    const slots = [startSlot];
    let currentSlot = startSlot;

    let safety = 0;
    while (safety++ < 15) {
        const entryOffset = DIR_FRAME_OFFSET + (currentSlot * 128);
        const linkVal = data[entryOffset + 8] | (data[entryOffset + 9] << 8);

        if (linkVal === 0xFFFF) break;
        if (linkVal >= 15) break;
        if (slots.includes(linkVal)) break;

        slots.push(linkVal);
        currentSlot = linkVal;
    }
    return slots;
}

export function findFreeSlots(data, count) {
    const freeSlots = [];

    for (let i = 0; i < 15; i++) {
        const status = data[DIR_FRAME_OFFSET + (i * 128)];
        if (status === 0xA0) {
            freeSlots.push(i);
        }
    }

    if (freeSlots.length < count) return null;
    return freeSlots.slice(0, count);
}

export function slotHasData(data, slotIndex) {
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;
    for (let i = 0; i < 128; i++) {
        if (data[blockStart + i] !== 0) return true;
    }
    return false;
}

export function countUsedBlocks(data) {
    let used = 0;
    for (let i = 0; i < 15; i++) {
        const status = data[DIR_FRAME_OFFSET + (i * 128)];
        if (status === 0x51 || status === 0x52 || status === 0x53) used++;
    }
    return used;
}

export function getSlotStatus(data, slotIndex) {
    return data[DIR_FRAME_OFFSET + (slotIndex * 128)];
}

// --- Card Operations ---

export function createBlankCard() {
    const data = new Uint8Array(CARD_SIZE);
    data[0] = 0x4D; // 'M'
    data[1] = 0x43; // 'C'
    data[127] = 0x0E;
    for (let i = 0; i < 15; i++) {
        const off = DIR_FRAME_OFFSET + (i * 128);
        data[off] = 0xA0;
        data[off + 4] = 0;
        data[off + 5] = 0;
        updateChecksum(data, off);
    }
    return data;
}

export function formatCardData(data) {
    for (let i = 0; i < 15; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (i * 128);

        for (let k = 0; k < 128; k++) {
            data[entryOffset + k] = 0;
        }

        data[entryOffset] = 0xA0;
        updateChecksum(data, entryOffset);

        const blockStart = (i + 1) * BLOCK_SIZE;
        for (let k = 0; k < BLOCK_SIZE; k++) {
            data[blockStart + k] = 0;
        }
    }
}

export function deleteSaveFromCard(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    for (const slot of linkedSlots) {
        const off = DIR_FRAME_OFFSET + (slot * 128);
        data[off] = 0xA0;
        updateChecksum(data, off);
    }
}

export function undeleteSaveOnCard(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    for (let i = 0; i < linkedSlots.length; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (linkedSlots[i] * 128);
        if (i === 0) {
            data[entryOffset] = 0x51;
        } else if (i < linkedSlots.length - 1) {
            data[entryOffset] = 0x52;
        } else {
            data[entryOffset] = 0x53;
        }
        updateChecksum(data, entryOffset);
    }
}

// --- MCS Export / Import ---

export function buildMcsExport(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    const numBlocks = linkedSlots.length;

    if (numBlocks === 0) return null;

    const mcsSize = numBlocks * MCS_FRAME_SIZE;
    const mcsData = new Uint8Array(mcsSize);

    let writeOffset = 0;

    for (let i = 0; i < numBlocks; i++) {
        const slot = linkedSlots[i];
        const entryOffset = DIR_FRAME_OFFSET + (slot * 128);
        const blockStart = (slot + 1) * BLOCK_SIZE;

        for (let k = 0; k < 128; k++) {
            mcsData[writeOffset + k] = data[entryOffset + k];
        }

        mcsData.set(data.slice(blockStart, blockStart + BLOCK_SIZE), writeOffset + 128);
        writeOffset += MCS_FRAME_SIZE;
    }

    const firstEntryOffset = DIR_FRAME_OFFSET + (linkedSlots[0] * 128);
    const gameId = parseString(data, firstEntryOffset + 12, 10);
    const filename = `${gameId || 'save'}_slot${slotIndex + 1}${numBlocks > 1 ? '_multi' : ''}.mcs`;

    return { mcsData, filename };
}

export function validateMcsSize(mcsData) {
    return mcsData.length > 0 && mcsData.length % MCS_FRAME_SIZE === 0;
}

/**
 * Import .mcs data into a card at the given slot.
 * Returns null on success, or an error message string on failure.
 */
export function importMcsToCard(data, mcsData, slotIndex) {
    const numBlocks = mcsData.length / MCS_FRAME_SIZE;
    if (numBlocks === 0) return 'Empty MCS data';

    let needed = numBlocks - 1;
    let allocatedSlots = [slotIndex];

    if (needed > 0) {
        const others = findFreeSlots(data, 15);
        const existingFree = others ? others.filter(s => s !== slotIndex) : [];

        if (existingFree.length < needed) {
            return `Need ${numBlocks} free blocks, but only found ${existingFree.length + 1} available (including target).`;
        }

        allocatedSlots = allocatedSlots.concat(existingFree.slice(0, needed));
    }

    let readOffset = 0;

    for (let i = 0; i < numBlocks; i++) {
        const destSlot = allocatedSlots[i];
        const entryOffset = DIR_FRAME_OFFSET + (destSlot * 128);
        const blockStart = (destSlot + 1) * BLOCK_SIZE;

        const mcsHeader = mcsData.slice(readOffset, readOffset + 128);
        const mcsBlock = mcsData.slice(readOffset + 128, readOffset + 128 + BLOCK_SIZE);

        for (let k = 0; k < 128; k++) data[entryOffset + k] = mcsHeader[k];
        data.set(mcsBlock, blockStart);

        if (i < numBlocks - 1) {
            const nextSlot = allocatedSlots[i + 1];
            data[entryOffset + 8] = nextSlot & 0xFF;
            data[entryOffset + 9] = (nextSlot >> 8) & 0xFF;
        } else {
            data[entryOffset + 8] = 0xFF;
            data[entryOffset + 9] = 0xFF;
        }

        updateChecksum(data, entryOffset);
        readOffset += MCS_FRAME_SIZE;
    }

    return null;
}

// --- Copy Save ---

/**
 * Copy a save from one card to another (or within the same card).
 * Returns null on success, or an error message string on failure.
 */
export function copySaveData(srcData, srcSlotIdx, destData, destSlotIdx) {
    const sourceSlots = getLinkedBlocks(srcData, srcSlotIdx);
    const destTargets = findFreeSlots(destData, sourceSlots.length);

    if (!destTargets) {
        return `Not enough free blocks! Need ${sourceSlots.length} blocks.`;
    }

    const preferredStartIdx = destTargets.indexOf(destSlotIdx);
    if (preferredStartIdx !== -1) {
        [destTargets[0], destTargets[preferredStartIdx]] = [destTargets[preferredStartIdx], destTargets[0]];
    }

    for (let i = 0; i < sourceSlots.length; i++) {
        const srcSlot = sourceSlots[i];
        const destSlot = destTargets[i];

        const srcBlockStart = (srcSlot + 1) * BLOCK_SIZE;
        const destBlockStart = (destSlot + 1) * BLOCK_SIZE;
        destData.set(srcData.slice(srcBlockStart, srcBlockStart + BLOCK_SIZE), destBlockStart);

        const srcEntryOffset = DIR_FRAME_OFFSET + (srcSlot * 128);
        const destEntryOffset = DIR_FRAME_OFFSET + (destSlot * 128);
        for (let k = 0; k < 128; k++) destData[destEntryOffset + k] = srcData[srcEntryOffset + k];

        if (i < sourceSlots.length - 1) {
            const nextDestSlot = destTargets[i + 1];
            destData[destEntryOffset + 8] = nextDestSlot & 0xFF;
            destData[destEntryOffset + 9] = (nextDestSlot >> 8) & 0xFF;
        } else {
            destData[destEntryOffset + 8] = 0xFF;
            destData[destEntryOffset + 9] = 0xFF;
        }

        updateChecksum(destData, destEntryOffset);
    }

    return null;
}
