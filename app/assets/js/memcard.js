// --- PS1 Memory Card Logic Module ---
// Pure data-manipulation functions with no DOM dependencies.

export const BLOCK_SIZE = 8192;
export const CARD_SIZE = 131072;
export const DIR_FRAME_OFFSET = 128;
export const SUPPORTED_FORMATS = ['.mcr', '.bin', '.gme', '.mcd', '.srm'];
export const MCS_FRAME_SIZE = 128 + BLOCK_SIZE;
const GME_HEADER_SIZE = 0xF40;

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
    if (data.length !== CARD_SIZE || !Number.isInteger(startSlot) || startSlot < 0 || startSlot >= 15) return [];
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
        if (status >= 0xA0 && status <= 0xA3) {
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

function isValidSaveChain(data, slots, deleted = false) {
    return slots.length > 0 && slots.every((slot, i) => {
        const offset = DIR_FRAME_OFFSET + slot * 128;
        const status = i === 0 ? 0x51 : i === slots.length - 1 ? 0x53 : 0x52;
        const next = data[offset + 8] | (data[offset + 9] << 8);
        return data[offset] === (deleted ? status + 0x50 : status) && next === (slots[i + 1] ?? 0xFFFF);
    });
}

// GME wraps the raw card in a DexDrive header; the other supported formats are raw.
export function readCardFile(bytes) {
    const isGme = bytes.length === CARD_SIZE + GME_HEADER_SIZE && parseString(bytes, 0, 12) === '123-456-STD';
    const offset = isGme ? GME_HEADER_SIZE : 0;
    if (bytes.length !== CARD_SIZE + offset || bytes[offset] !== 0x4D || bytes[offset + 1] !== 0x43) {
        throw new Error('Invalid memory card size or header.');
    }
    return { data: bytes.slice(offset), gmeHeader: isGme ? bytes.slice(0, offset) : null };
}

export function buildCardFile(data, extension, gmeHeader = null) {
    if (extension !== '.gme') return data;
    const bytes = new Uint8Array(GME_HEADER_SIZE + CARD_SIZE);
    if (gmeHeader) bytes.set(gmeHeader);
    bytes.set(new TextEncoder().encode('123-456-STD\0'));
    bytes.set([0, 0, 1, 0, 1], 0x10);
    for (let i = 0; i < 16; i++) {
        bytes[0x15 + i] = data[i * 128];
        bytes[0x25 + i] = data[i * 128 + 8];
    }
    bytes.set(data, GME_HEADER_SIZE);
    return bytes;
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
        data[off + 8] = 0xFF;
        data[off + 9] = 0xFF;
        updateChecksum(data, off);
    }
    for (let frame = 16; frame < 36; frame++) {
        const offset = frame * 128;
        data.fill(0xFF, offset, offset + 4);
        data[offset + 8] = data[offset + 9] = 0xFF;
        updateChecksum(data, offset);
    }
    data.set(data.slice(0, 128), 63 * 128);
    return data;
}

export function formatCardData(data) {
    for (let i = 0; i < 15; i++) {
        const entryOffset = DIR_FRAME_OFFSET + (i * 128);

        for (let k = 0; k < 128; k++) {
            data[entryOffset + k] = 0;
        }

        data[entryOffset] = 0xA0;
        data[entryOffset + 8] = data[entryOffset + 9] = 0xFF;
        updateChecksum(data, entryOffset);

        const blockStart = (i + 1) * BLOCK_SIZE;
        for (let k = 0; k < BLOCK_SIZE; k++) {
            data[blockStart + k] = 0;
        }
    }
}

export function deleteSaveFromCard(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    if (!isValidSaveChain(data, linkedSlots)) return 'Invalid save block chain.';
    for (const slot of linkedSlots) {
        const off = DIR_FRAME_OFFSET + (slot * 128);
        data[off] += 0x50;
        updateChecksum(data, off);
    }
    return null;
}

export function undeleteSaveOnCard(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    if (!isValidSaveChain(data, linkedSlots, true)) return 'Cannot recover this save: its blocks have been reused or its chain is invalid.';
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
    return null;
}

// --- MCS Export / Import ---

export function buildMcsExport(data, slotIndex) {
    const linkedSlots = getLinkedBlocks(data, slotIndex);
    const numBlocks = linkedSlots.length;

    if (!isValidSaveChain(data, linkedSlots)) return null;

    const mcsSize = 128 + numBlocks * BLOCK_SIZE;
    const mcsData = new Uint8Array(mcsSize);
    const firstEntryOffset = DIR_FRAME_OFFSET + slotIndex * 128;
    mcsData.set(data.slice(firstEntryOffset, firstEntryOffset + 128));

    for (let i = 0; i < numBlocks; i++) {
        const slot = linkedSlots[i];
        const blockStart = (slot + 1) * BLOCK_SIZE;
        mcsData.set(data.slice(blockStart, blockStart + BLOCK_SIZE), 128 + i * BLOCK_SIZE);
    }
    const gameId = parseString(data, firstEntryOffset + 12, 10);
    const filename = `${gameId || 'save'}_slot${slotIndex + 1}${numBlocks > 1 ? '_multi' : ''}.mcs`;

    return { mcsData, filename };
}

export function validateMcsSize(mcsData) {
    return mcsData.length >= MCS_FRAME_SIZE && mcsData.length <= 128 + 15 * BLOCK_SIZE && (mcsData.length - 128) % BLOCK_SIZE === 0;
}

/**
 * Import .mcs data into a card at the given slot.
 * Returns null on success, or an error message string on failure.
 */
export function importMcsToCard(data, mcsData, slotIndex) {
    if (!validateMcsSize(mcsData)) return 'Invalid MCS size: expected one 128-byte header followed by 1 to 15 complete blocks.';
    const declaredSize = new DataView(mcsData.buffer, mcsData.byteOffset + 4, 4).getUint32(0, true);
    if (declaredSize !== mcsData.length - 128) return 'Invalid MCS data: the header size does not match the save data.';
    if (data.length !== CARD_SIZE || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 15) return 'Invalid target slot or card.';
    const status = getSlotStatus(data, slotIndex);
    if (status !== 0x51 && !(status >= 0xA0 && status <= 0xA3)) return 'Cannot overwrite a linked block. Choose the first slot of the save.';
    const numBlocks = (mcsData.length - 128) / BLOCK_SIZE;

    const previousSlots = getSlotStatus(data, slotIndex) === 0x51
        ? getLinkedBlocks(data, slotIndex)
        : [];
    if (status === 0x51 && !isValidSaveChain(data, previousSlots)) return 'Invalid existing save block chain.';
    const available = [];
    for (let i = 0; i < 15; i++) {
        const slotStatus = getSlotStatus(data, i);
        if (i !== slotIndex && ((slotStatus >= 0xA0 && slotStatus <= 0xA3) || previousSlots.includes(i))) {
            available.push(i);
        }
    }
    if (available.length < numBlocks - 1) {
        return `Need ${numBlocks} free blocks, but only found ${available.length + 1} available (including target).`;
    }
    const allocatedSlots = [slotIndex, ...available.slice(0, numBlocks - 1)];
    for (const oldSlot of previousSlots.filter(slot => !allocatedSlots.includes(slot))) {
        const offset = DIR_FRAME_OFFSET + oldSlot * 128;
        data.fill(0, offset, offset + 128);
        data[offset] = 0xA0;
        data[offset + 8] = data[offset + 9] = 0xFF;
        updateChecksum(data, offset);
    }

    for (let i = 0; i < numBlocks; i++) {
        const destSlot = allocatedSlots[i];
        const entryOffset = DIR_FRAME_OFFSET + (destSlot * 128);
        const blockStart = (destSlot + 1) * BLOCK_SIZE;

        const readOffset = 128 + i * BLOCK_SIZE;
        const mcsBlock = mcsData.slice(readOffset, readOffset + BLOCK_SIZE);
        data.fill(0, entryOffset, entryOffset + 128);
        if (i === 0) {
            data.set(mcsData.slice(10, 31), entryOffset + 10);
            const size = numBlocks * BLOCK_SIZE;
            for (let k = 0; k < 4; k++) data[entryOffset + 4 + k] = (size >>> (k * 8)) & 0xFF;
        }
        data[entryOffset] = i === 0 ? 0x51 : i === numBlocks - 1 ? 0x53 : 0x52;
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
    if (!isValidSaveChain(srcData, sourceSlots)) return 'Invalid source save block chain.';
    const destTargets = findFreeSlots(destData, sourceSlots.length);

    if (!destTargets) {
        return `Not enough free blocks! Need ${sourceSlots.length} blocks.`;
    }

    const preferredStartIdx = destTargets.indexOf(destSlotIdx);
    if (preferredStartIdx !== -1) {
        [destTargets[0], destTargets[preferredStartIdx]] = [destTargets[preferredStartIdx], destTargets[0]];
    } else if (Number.isInteger(destSlotIdx) && destSlotIdx >= 0 && destSlotIdx < 15 && getSlotStatus(destData, destSlotIdx) >= 0xA0 && getSlotStatus(destData, destSlotIdx) <= 0xA3) {
        destTargets[0] = destSlotIdx;
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
