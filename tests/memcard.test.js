import { describe, it, expect, beforeEach } from 'vitest';
import {
    BLOCK_SIZE, CARD_SIZE, DIR_FRAME_OFFSET, SUPPORTED_FORMATS, MCS_FRAME_SIZE,
    escapeHtml, getFileExtension, changeFileExtension,
    updateChecksum, verifyChecksum, parseString, parseShiftJIS,
    getLinkedBlocks, findFreeSlots, slotHasData, countUsedBlocks, getSlotStatus,
    createBlankCard, formatCardData, deleteSaveFromCard, undeleteSaveOnCard,
    buildMcsExport, validateMcsSize, importMcsToCard, copySaveData, readCardFile, buildCardFile
} from '../app/assets/js/memcard.js';

function makeMcsData(blocks = 1) {
    const data = new Uint8Array(128 + blocks * BLOCK_SIZE);
    new DataView(data.buffer).setUint32(4, blocks * BLOCK_SIZE, true);
    return data;
}

// --- Test Helpers ---

/** Create a blank card and write a single-block save into a given slot. */
function writeFakeSave(data, slotIndex, gameId = 'SLUS00001') {
    const entryOffset = DIR_FRAME_OFFSET + (slotIndex * 128);

    // Status: active head
    data[entryOffset] = 0x51;

    // Size: 1 block = 8192 bytes
    data[entryOffset + 4] = BLOCK_SIZE & 0xFF;
    data[entryOffset + 5] = (BLOCK_SIZE >> 8) & 0xFF;
    data[entryOffset + 6] = 0;
    data[entryOffset + 7] = 0;

    // Link: end of chain
    data[entryOffset + 8] = 0xFF;
    data[entryOffset + 9] = 0xFF;

    // Game ID at offset 12
    for (let k = 0; k < gameId.length; k++) {
        data[entryOffset + 12 + k] = gameId.charCodeAt(k);
    }

    updateChecksum(data, entryOffset);

    // Write some recognizable data into the data block
    const blockStart = (slotIndex + 1) * BLOCK_SIZE;
    data[blockStart] = 0x53; // 'S'
    data[blockStart + 1] = 0x43; // 'C'
    // Write title starting at offset 4 of data block
    const title = 'TestGame';
    for (let k = 0; k < title.length; k++) {
        data[blockStart + 4 + k] = title.charCodeAt(k);
    }
}

/** Create a multi-block save spanning the given slots (linked chain). */
function writeMultiBlockSave(data, slots, gameId = 'SLUS00002') {
    for (let i = 0; i < slots.length; i++) {
        const slotIndex = slots[i];
        const entryOffset = DIR_FRAME_OFFSET + (slotIndex * 128);

        // Status
        if (i === 0) data[entryOffset] = 0x51;        // head
        else if (i < slots.length - 1) data[entryOffset] = 0x52; // middle
        else data[entryOffset] = 0x53;                 // last

        // Size (only meaningful on the head block)
        const totalSize = slots.length * BLOCK_SIZE;
        data[entryOffset + 4] = totalSize & 0xFF;
        data[entryOffset + 5] = (totalSize >> 8) & 0xFF;
        data[entryOffset + 6] = (totalSize >> 16) & 0xFF;
        data[entryOffset + 7] = (totalSize >> 24) & 0xFF;

        // Link pointer
        if (i < slots.length - 1) {
            const nextSlot = slots[i + 1];
            data[entryOffset + 8] = nextSlot & 0xFF;
            data[entryOffset + 9] = (nextSlot >> 8) & 0xFF;
        } else {
            data[entryOffset + 8] = 0xFF;
            data[entryOffset + 9] = 0xFF;
        }

        // Game ID
        for (let k = 0; k < gameId.length; k++) {
            data[entryOffset + 12 + k] = gameId.charCodeAt(k);
        }

        updateChecksum(data, entryOffset);

        // Write recognizable data into each block
        const blockStart = (slotIndex + 1) * BLOCK_SIZE;
        data[blockStart] = 0x42 + i; // different marker per block
        data[blockStart + 4] = 0x54; // 'T'
    }
}


// ===================================================================
// Tests
// ===================================================================

describe('Constants', () => {
    it('has correct PS1 memory card constants', () => {
        expect(BLOCK_SIZE).toBe(8192);
        expect(CARD_SIZE).toBe(131072); // 128 KB
        expect(DIR_FRAME_OFFSET).toBe(128);
        expect(MCS_FRAME_SIZE).toBe(128 + 8192);
    });

    it('supports all expected file formats', () => {
        expect(SUPPORTED_FORMATS).toEqual(['.mcr', '.bin', '.gme', '.mcd', '.srm']);
    });
});

// -------------------------------------------------------------------
describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('escapes ampersands', () => {
        expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('returns plain text unchanged', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('escapes multiple special characters in sequence', () => {
        expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });
});

// -------------------------------------------------------------------
describe('getFileExtension', () => {
    it('extracts known extensions', () => {
        expect(getFileExtension('card.mcr')).toBe('.mcr');
        expect(getFileExtension('save.bin')).toBe('.bin');
        expect(getFileExtension('my_file.srm')).toBe('.srm');
    });

    it('lowercases the extension', () => {
        expect(getFileExtension('Card.MCR')).toBe('.mcr');
        expect(getFileExtension('SAVE.BIN')).toBe('.bin');
    });

    it('handles files with no extension', () => {
        expect(getFileExtension('noext')).toBe('');
    });

    it('handles files with multiple dots', () => {
        expect(getFileExtension('my.save.card.mcr')).toBe('.mcr');
    });
});

// -------------------------------------------------------------------
describe('changeFileExtension', () => {
    it('changes extension', () => {
        expect(changeFileExtension('card.mcr', '.srm')).toBe('card.srm');
    });

    it('adds extension to extensionless file', () => {
        expect(changeFileExtension('card', '.bin')).toBe('card.bin');
    });

    it('handles multiple dots', () => {
        expect(changeFileExtension('my.save.mcr', '.gme')).toBe('my.save.gme');
    });
});

// -------------------------------------------------------------------
describe('updateChecksum / verifyChecksum', () => {
    it('computes XOR checksum of 127 bytes and stores at byte 127', () => {
        const data = new Uint8Array(256);
        data[0] = 0x51;
        data[4] = 0x20;
        data[5] = 0x00;
        updateChecksum(data, 0);

        expect(verifyChecksum(data, 0)).toBe(true);
    });

    it('detects corrupted data', () => {
        const data = new Uint8Array(256);
        data[0] = 0x51;
        updateChecksum(data, 0);

        // Corrupt a byte
        data[10] = 0xFF;
        expect(verifyChecksum(data, 0)).toBe(false);
    });

    it('works at non-zero offsets', () => {
        const data = new Uint8Array(512);
        const offset = 128;
        data[offset] = 0xA0;
        data[offset + 4] = 0x12;
        updateChecksum(data, offset);

        expect(verifyChecksum(data, offset)).toBe(true);
    });
});

// -------------------------------------------------------------------
describe('parseString', () => {
    it('reads ASCII string from byte array', () => {
        const data = new Uint8Array(20);
        const str = 'SLUS00001';
        for (let i = 0; i < str.length; i++) data[i] = str.charCodeAt(i);
        expect(parseString(data, 0, 10)).toBe('SLUS00001');
    });

    it('stops at null terminator', () => {
        const data = new Uint8Array(20);
        data[0] = 65; data[1] = 66; data[2] = 0; data[3] = 67;
        expect(parseString(data, 0, 10)).toBe('AB');
    });

    it('handles empty string (all zeros)', () => {
        const data = new Uint8Array(10);
        expect(parseString(data, 0, 10)).toBe('');
    });
});

// -------------------------------------------------------------------
describe('parseShiftJIS', () => {
    it('decodes ASCII-range text', () => {
        const data = new Uint8Array(10);
        const str = 'Hello';
        for (let i = 0; i < str.length; i++) data[i] = str.charCodeAt(i);
        expect(parseShiftJIS(data, 0, 10)).toBe('Hello');
    });

    it('stops at null terminator', () => {
        const data = new Uint8Array(10);
        data[0] = 72; data[1] = 105; data[2] = 0; data[3] = 88;
        expect(parseShiftJIS(data, 0, 10)).toBe('Hi');
    });
});

// -------------------------------------------------------------------
describe('createBlankCard', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('has correct size', () => {
        expect(data.length).toBe(CARD_SIZE);
    });

    it('has MC header magic bytes', () => {
        expect(data[0]).toBe(0x4D); // 'M'
        expect(data[1]).toBe(0x43); // 'C'
    });

    it('has correct header checksum byte', () => {
        expect(data[127]).toBe(0x0E);
    });

    it('has all 15 directory entries marked as Free (0xA0)', () => {
        for (let i = 0; i < 15; i++) {
            const off = DIR_FRAME_OFFSET + (i * 128);
            expect(data[off]).toBe(0xA0);
        }
    });

    it('has valid checksums on all directory entries', () => {
        for (let i = 0; i < 15; i++) {
            const off = DIR_FRAME_OFFSET + (i * 128);
            expect(verifyChecksum(data, off)).toBe(true);
        }
    });

    it('reports 0 used blocks', () => {
        expect(countUsedBlocks(data)).toBe(0);
    });

    it('reports 15 free slots', () => {
        const free = findFreeSlots(data, 15);
        expect(free).toHaveLength(15);
    });
});

// -------------------------------------------------------------------
describe('getLinkedBlocks', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('returns single slot for a single-block save', () => {
        writeFakeSave(data, 3);
        const blocks = getLinkedBlocks(data, 3);
        expect(blocks).toEqual([3]);
    });

    it('follows a 3-block linked chain', () => {
        writeMultiBlockSave(data, [1, 5, 9]);
        const blocks = getLinkedBlocks(data, 1);
        expect(blocks).toEqual([1, 5, 9]);
    });

    it('handles end-of-chain marker 0xFFFF', () => {
        writeFakeSave(data, 0);
        const blocks = getLinkedBlocks(data, 0);
        expect(blocks).toEqual([0]);
    });

    it('breaks on circular link to prevent infinite loop', () => {
        writeMultiBlockSave(data, [2, 4]);
        // Create circular link: slot 4 points back to slot 2
        const off = DIR_FRAME_OFFSET + (4 * 128);
        data[off + 8] = 2;
        data[off + 9] = 0;
        updateChecksum(data, off);

        const blocks = getLinkedBlocks(data, 2);
        expect(blocks).toEqual([2, 4]); // stops, doesn't loop
    });

    it('breaks on invalid link value (>= 15)', () => {
        writeFakeSave(data, 7);
        // Overwrite link to invalid value
        const off = DIR_FRAME_OFFSET + (7 * 128);
        data[off + 8] = 20;
        data[off + 9] = 0;
        updateChecksum(data, off);

        const blocks = getLinkedBlocks(data, 7);
        expect(blocks).toEqual([7]);
    });
});

// -------------------------------------------------------------------
describe('findFreeSlots', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('finds all 15 free slots on a blank card', () => {
        const free = findFreeSlots(data, 15);
        expect(free).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it('returns null when not enough free slots', () => {
        // Fill all 15 slots
        for (let i = 0; i < 15; i++) writeFakeSave(data, i, `GAME${i}`);
        expect(findFreeSlots(data, 1)).toBe(null);
    });

    it('excludes occupied slots', () => {
        writeFakeSave(data, 0);
        writeFakeSave(data, 5);
        writeFakeSave(data, 14);
        const free = findFreeSlots(data, 12);
        expect(free).not.toContain(0);
        expect(free).not.toContain(5);
        expect(free).not.toContain(14);
        expect(free).toHaveLength(12);
    });

    it('returns exactly the requested count', () => {
        const free = findFreeSlots(data, 3);
        expect(free).toHaveLength(3);
    });
});

// -------------------------------------------------------------------
describe('slotHasData', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('returns false for a truly empty slot', () => {
        expect(slotHasData(data, 0)).toBe(false);
    });

    it('returns true when data block contains non-zero bytes', () => {
        const blockStart = (3 + 1) * BLOCK_SIZE;
        data[blockStart + 10] = 0x42;
        expect(slotHasData(data, 3)).toBe(true);
    });
});

// -------------------------------------------------------------------
describe('countUsedBlocks', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('returns 0 for a blank card', () => {
        expect(countUsedBlocks(data)).toBe(0);
    });

    it('counts single-block saves', () => {
        writeFakeSave(data, 0);
        writeFakeSave(data, 5);
        expect(countUsedBlocks(data)).toBe(2);
    });

    it('counts all blocks in multi-block saves', () => {
        writeMultiBlockSave(data, [0, 1, 2]);
        expect(countUsedBlocks(data)).toBe(3);
    });
});

// -------------------------------------------------------------------
describe('deleteSaveFromCard', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('marks a single-block save as free', () => {
        writeFakeSave(data, 4);
        expect(getSlotStatus(data, 4)).toBe(0x51);

        deleteSaveFromCard(data, 4);
        expect(getSlotStatus(data, 4)).toBe(0xA1);
        expect(verifyChecksum(data, DIR_FRAME_OFFSET + (4 * 128))).toBe(true);
    });

    it('marks all blocks of a multi-block save as free', () => {
        writeMultiBlockSave(data, [2, 6, 10]);
        expect(getSlotStatus(data, 2)).toBe(0x51);
        expect(getSlotStatus(data, 6)).toBe(0x52);
        expect(getSlotStatus(data, 10)).toBe(0x53);

        deleteSaveFromCard(data, 2);
        expect(getSlotStatus(data, 2)).toBe(0xA1);
        expect(getSlotStatus(data, 6)).toBe(0xA2);
        expect(getSlotStatus(data, 10)).toBe(0xA3);
    });

    it('preserves data blocks for recovery', () => {
        writeFakeSave(data, 1);
        const blockStart = (1 + 1) * BLOCK_SIZE;
        data[blockStart] = 0x42;

        deleteSaveFromCard(data, 1);
        expect(data[blockStart]).toBe(0x42); // data still present
        expect(slotHasData(data, 1)).toBe(true);
    });

    it('updates block count after deletion', () => {
        writeMultiBlockSave(data, [0, 1, 2]);
        expect(countUsedBlocks(data)).toBe(3);

        deleteSaveFromCard(data, 0);
        expect(countUsedBlocks(data)).toBe(0);
    });

    it('frees blocks so they can be allocated', () => {
        writeMultiBlockSave(data, [0, 1, 2]);
        deleteSaveFromCard(data, 0);

        const free = findFreeSlots(data, 15);
        expect(free).toContain(0);
        expect(free).toContain(1);
        expect(free).toContain(2);
    });
});

// -------------------------------------------------------------------
describe('undeleteSaveOnCard', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('restores a single-block save to active', () => {
        writeFakeSave(data, 7);
        deleteSaveFromCard(data, 7);
        expect(getSlotStatus(data, 7)).toBe(0xA1);

        undeleteSaveOnCard(data, 7);
        expect(getSlotStatus(data, 7)).toBe(0x51);
        expect(verifyChecksum(data, DIR_FRAME_OFFSET + (7 * 128))).toBe(true);
    });

    it('restores a multi-block save with correct status bytes', () => {
        writeMultiBlockSave(data, [3, 8, 12]);
        deleteSaveFromCard(data, 3);

        undeleteSaveOnCard(data, 3);
        expect(getSlotStatus(data, 3)).toBe(0x51);  // head
        expect(getSlotStatus(data, 8)).toBe(0x52);   // middle
        expect(getSlotStatus(data, 12)).toBe(0x53);  // last
    });

    it('restores a 2-block save (no middle block)', () => {
        writeMultiBlockSave(data, [5, 11]);
        deleteSaveFromCard(data, 5);

        undeleteSaveOnCard(data, 5);
        expect(getSlotStatus(data, 5)).toBe(0x51);  // head
        expect(getSlotStatus(data, 11)).toBe(0x53);  // last (no middle)
    });

    it('preserves link chain integrity after round-trip', () => {
        writeMultiBlockSave(data, [1, 4, 9]);
        deleteSaveFromCard(data, 1);
        undeleteSaveOnCard(data, 1);

        const blocks = getLinkedBlocks(data, 1);
        expect(blocks).toEqual([1, 4, 9]);
    });

    it('restores block count', () => {
        writeMultiBlockSave(data, [0, 1, 2]);
        deleteSaveFromCard(data, 0);
        expect(countUsedBlocks(data)).toBe(0);

        undeleteSaveOnCard(data, 0);
        expect(countUsedBlocks(data)).toBe(3);
    });
});

// -------------------------------------------------------------------
describe('formatCardData', () => {
    it('clears all saves and data', () => {
        const data = createBlankCard();
        writeFakeSave(data, 0);
        writeFakeSave(data, 5);
        writeMultiBlockSave(data, [10, 11, 12]);

        formatCardData(data);

        expect(countUsedBlocks(data)).toBe(0);
        for (let i = 0; i < 15; i++) {
            expect(getSlotStatus(data, i)).toBe(0xA0);
            expect(slotHasData(data, i)).toBe(false);
            expect(verifyChecksum(data, DIR_FRAME_OFFSET + (i * 128))).toBe(true);
        }
    });
});

// -------------------------------------------------------------------
describe('MCS export / import round-trip', () => {
    let data;

    beforeEach(() => {
        data = createBlankCard();
    });

    it('exports a single-block save correctly', () => {
        writeFakeSave(data, 2, 'SLUS99999');
        const result = buildMcsExport(data, 2);

        expect(result).not.toBeNull();
        expect(result.filename).toBe('SLUS99999_slot3.mcs');
        expect(result.mcsData.length).toBe(MCS_FRAME_SIZE);
    });

    it('exports a multi-block save with _multi suffix', () => {
        writeMultiBlockSave(data, [0, 3, 7], 'SLPS12345');
        const result = buildMcsExport(data, 0);

        expect(result).not.toBeNull();
        expect(result.filename).toBe('SLPS12345_slot1_multi.mcs');
        expect(result.mcsData.length).toBe(128 + 3 * BLOCK_SIZE);
    });

    it('validates correct MCS file size', () => {
        const valid = makeMcsData();
        expect(validateMcsSize(valid)).toBe(true);

        const multi = makeMcsData(3);
        expect(validateMcsSize(multi)).toBe(true);
    });

    it('rejects invalid MCS file size', () => {
        const bad = new Uint8Array(1000);
        expect(validateMcsSize(bad)).toBe(false);

        const empty = new Uint8Array(0);
        expect(validateMcsSize(empty)).toBe(false);
    });

    it('round-trips a single-block save through export/import', () => {
        writeFakeSave(data, 5, 'SLUS00123');

        // Capture original data block
        const origBlockStart = (5 + 1) * BLOCK_SIZE;
        const origBlock = data.slice(origBlockStart, origBlockStart + BLOCK_SIZE);

        // Export
        const exported = buildMcsExport(data, 5);

        // Import into a different slot on a fresh card
        const destCard = createBlankCard();
        const error = importMcsToCard(destCard, exported.mcsData, 10);
        expect(error).toBeNull();

        // Verify imported data
        expect(getSlotStatus(destCard, 10)).toBe(0x51);
        const importedBlock = destCard.slice((10 + 1) * BLOCK_SIZE, (10 + 1) * BLOCK_SIZE + BLOCK_SIZE);
        expect(importedBlock).toEqual(origBlock);
    });

    it('round-trips a multi-block save through export/import', () => {
        writeMultiBlockSave(data, [1, 4, 9], 'SLPS00001');

        // Export
        const exported = buildMcsExport(data, 1);

        // Import into fresh card at slot 0
        const destCard = createBlankCard();
        const error = importMcsToCard(destCard, exported.mcsData, 0);
        expect(error).toBeNull();

        // Verify the imported save forms a valid chain
        const chain = getLinkedBlocks(destCard, 0);
        expect(chain).toHaveLength(3);

        // Verify chain terminates properly
        const lastSlot = chain[chain.length - 1];
        const lastEntry = DIR_FRAME_OFFSET + (lastSlot * 128);
        expect(destCard[lastEntry + 8]).toBe(0xFF);
        expect(destCard[lastEntry + 9]).toBe(0xFF);
    });

    it('imports a multi-block save when only the required slots are free', () => {
        for (let i = 0; i < 12; i++) writeFakeSave(data, i, `GAME${i}`);
        const mcsData = makeMcsData(3);
        expect(importMcsToCard(data, mcsData, 12)).toBeNull();
        expect(getLinkedBlocks(data, 12)).toEqual([12, 13, 14]);
    });

    it('releases the previous linked blocks when overwriting a save', () => {
        writeMultiBlockSave(data, [2, 3, 4]);
        const mcsData = makeMcsData();
        mcsData[0] = 0x51;
        expect(importMcsToCard(data, mcsData, 2)).toBeNull();
        expect(getSlotStatus(data, 2)).toBe(0x51);
        expect(getSlotStatus(data, 3)).toBe(0xA0);
        expect(getSlotStatus(data, 4)).toBe(0xA0);
    });

    it('returns error when not enough free slots for import', () => {
        // Fill 14 slots, leaving only 1 free
        for (let i = 0; i < 14; i++) writeFakeSave(data, i, `GAME${i}`);

        // Try to import a 3-block save
        const mcsData = makeMcsData(3);
        // Write minimal valid headers
        mcsData[0] = 0x51;
        const error = importMcsToCard(data, mcsData, 14);
        expect(error).toContain('free blocks');
    });
});

// -------------------------------------------------------------------
describe('copySaveData', () => {
    let srcCard, destCard;

    beforeEach(() => {
        srcCard = createBlankCard();
        destCard = createBlankCard();
    });

    it('copies a single-block save between cards', () => {
        writeFakeSave(srcCard, 3, 'SLUS00001');

        const error = copySaveData(srcCard, 3, destCard, 0);
        expect(error).toBeNull();
        expect(getSlotStatus(destCard, 0)).toBe(0x51);
        expect(verifyChecksum(destCard, DIR_FRAME_OFFSET + (0 * 128))).toBe(true);
    });

    it('copies data block contents correctly', () => {
        writeFakeSave(srcCard, 0, 'SLUS00001');
        const srcBlockStart = (0 + 1) * BLOCK_SIZE;
        srcCard[srcBlockStart + 100] = 0xAB;

        copySaveData(srcCard, 0, destCard, 0);

        // findFreeSlots allocates from the first available slot (slot 0)
        const destBlockStart = (0 + 1) * BLOCK_SIZE;
        expect(destCard[destBlockStart + 100]).toBe(0xAB);
    });

    it('copies a multi-block save and re-links pointers', () => {
        writeMultiBlockSave(srcCard, [0, 1, 2], 'SLPS00001');

        const error = copySaveData(srcCard, 0, destCard, 0);
        expect(error).toBeNull();

        const chain = getLinkedBlocks(destCard, 0);
        expect(chain).toHaveLength(3);

        // Verify all checksums valid
        for (const slot of chain) {
            expect(verifyChecksum(destCard, DIR_FRAME_OFFSET + (slot * 128))).toBe(true);
        }
    });

    it('places save at preferred drop target when possible', () => {
        writeFakeSave(srcCard, 0, 'SLUS00001');

        // Fill slots 0-6 so the first free slot is 7
        for (let i = 0; i < 7; i++) writeFakeSave(destCard, i, `FILL${i}`);

        // Now slot 7 is the first available and also the drop target
        copySaveData(srcCard, 0, destCard, 7);
        expect(getSlotStatus(destCard, 7)).toBe(0x51);
    });

    it('returns error when destination card is full', () => {
        writeFakeSave(srcCard, 0, 'SLUS00001');

        // Fill all 15 slots on dest
        for (let i = 0; i < 15; i++) writeFakeSave(destCard, i, `DEST${i}`);

        const error = copySaveData(srcCard, 0, destCard, 0);
        expect(error).toContain('Not enough free blocks');
    });

    it('can copy within the same card', () => {
        writeFakeSave(srcCard, 0, 'SLUS00001');

        const error = copySaveData(srcCard, 0, srcCard, 1);
        expect(error).toBeNull();

        // Source stays active, copy goes to first free slot (slot 1)
        expect(getSlotStatus(srcCard, 0)).toBe(0x51);
        expect(getSlotStatus(srcCard, 1)).toBe(0x51);
    });
});

// -------------------------------------------------------------------
describe('getSlotStatus', () => {
    it('reads the status byte for each slot', () => {
        const data = createBlankCard();
        expect(getSlotStatus(data, 0)).toBe(0xA0);

        writeFakeSave(data, 3);
        expect(getSlotStatus(data, 3)).toBe(0x51);
    });
});

// -------------------------------------------------------------------
describe('Integration: delete + re-allocate + recover', () => {
    it('deleted blocks can be re-used by new saves', () => {
        const data = createBlankCard();

        // Fill all 15 slots with single-block saves
        for (let i = 0; i < 15; i++) writeFakeSave(data, i, `GAME${i}`);
        expect(findFreeSlots(data, 1)).toBe(null);

        // Delete save in slot 5
        deleteSaveFromCard(data, 5);
        expect(findFreeSlots(data, 1)).toEqual([5]);

        // Write a new save into the freed slot
        writeFakeSave(data, 5, 'NEWGAME');
        expect(getSlotStatus(data, 5)).toBe(0x51);
        expect(countUsedBlocks(data)).toBe(15);
    });

    it('multi-block delete + undelete is idempotent for block count', () => {
        const data = createBlankCard();
        writeMultiBlockSave(data, [0, 1, 2, 3]);
        expect(countUsedBlocks(data)).toBe(4);

        deleteSaveFromCard(data, 0);
        expect(countUsedBlocks(data)).toBe(0);

        undeleteSaveOnCard(data, 0);
        expect(countUsedBlocks(data)).toBe(4);
        expect(getLinkedBlocks(data, 0)).toEqual([0, 1, 2, 3]);
    });
});

// -------------------------------------------------------------------
describe('Edge cases', () => {
    it('buildMcsExport returns null for empty slot', () => {
        const data = createBlankCard();
        const result = buildMcsExport(data, 0);
        expect(result).toBeNull();
    });

    it('handles maximum 15-block save chain', () => {
        const data = createBlankCard();
        const allSlots = Array.from({ length: 15 }, (_, i) => i);
        writeMultiBlockSave(data, allSlots, 'MEGASAVE');

        const chain = getLinkedBlocks(data, 0);
        expect(chain).toHaveLength(15);
        expect(countUsedBlocks(data)).toBe(15);

        // Delete all
        deleteSaveFromCard(data, 0);
        expect(countUsedBlocks(data)).toBe(0);
        expect(findFreeSlots(data, 15)).toHaveLength(15);

        // Undelete all
        undeleteSaveOnCard(data, 0);
        expect(countUsedBlocks(data)).toBe(15);
    });

    it('copySaveData preserves source card data (non-destructive)', () => {
        const srcCard = createBlankCard();
        writeFakeSave(srcCard, 3, 'SLUS00001');

        const srcSnapshot = new Uint8Array(srcCard);
        const destCard = createBlankCard();

        copySaveData(srcCard, 3, destCard, 0);

        // Source card should be unchanged
        expect(srcCard).toEqual(srcSnapshot);
    });
});

describe('Data-loss regressions', () => {
    it('rejects an MCS truncated by a whole block before overwriting a save', () => {
        const source = createBlankCard();
        writeMultiBlockSave(source, [0, 1]);
        const truncated = buildMcsExport(source, 0).mcsData.slice(0, MCS_FRAME_SIZE);
        const target = createBlankCard();
        writeFakeSave(target, 5);
        const snapshot = target.slice();
        expect(importMcsToCard(target, truncated, 5)).toBeTypeOf('string');
        expect(target).toEqual(snapshot);
    });

    it('writes MCS with one header and consecutive data blocks, and reconstructs directory entries', () => {
        const source = createBlankCard();
        writeMultiBlockSave(source, [8, 2, 14]);
        const { mcsData } = buildMcsExport(source, 8);
        expect(mcsData.length).toBe(128 + 3 * BLOCK_SIZE);
        for (const [i, slot] of [8, 2, 14].entries()) {
            expect(mcsData.slice(128 + i * BLOCK_SIZE, 128 + (i + 1) * BLOCK_SIZE))
                .toEqual(source.slice((slot + 1) * BLOCK_SIZE, (slot + 2) * BLOCK_SIZE));
        }
        // Source allocation state and links must not be reused on the destination.
        mcsData[0] = 0xA1;
        mcsData[8] = 14;
        const target = createBlankCard();
        expect(importMcsToCard(target, mcsData, 10)).toBeNull();
        expect(getLinkedBlocks(target, 10)).toEqual([10, 0, 1]);
        expect([10, 0, 1].map(slot => getSlotStatus(target, slot))).toEqual([0x51, 0x52, 0x53]);
        expect(target.slice(DIR_FRAME_OFFSET + 10 * 128 + 10, DIR_FRAME_OFFSET + 10 * 128 + 31)).toEqual(mcsData.slice(10, 31));
        expect(target.slice(128 + 4, 128 + 8)).toEqual(new Uint8Array(4));
    });

    it('frees every unused old block even when allocation chooses earlier free slots', () => {
        const data = createBlankCard();
        writeMultiBlockSave(data, [10, 11, 12]);
        expect(importMcsToCard(data, makeMcsData(2), 10)).toBeNull();
        expect(getLinkedBlocks(data, 10)).toEqual([10, 0]);
        expect(countUsedBlocks(data)).toBe(2);
        for (const slot of [11, 12]) {
            expect(getSlotStatus(data, slot)).toBe(0xA0);
            expect(getLinkedBlocks(data, slot)).toEqual([slot]);
            expect(verifyChecksum(data, DIR_FRAME_OFFSET + slot * 128)).toBe(true);
        }
    });

    it('reuses overwritten blocks on a full card and leaves unrelated saves intact', () => {
        const data = createBlankCard();
        for (let i = 0; i < 15; i++) writeFakeSave(data, i);
        writeMultiBlockSave(data, [10, 11, 12]);
        const otherSave = data.slice(BLOCK_SIZE, 2 * BLOCK_SIZE);
        expect(importMcsToCard(data, makeMcsData(3), 10)).toBeNull();
        expect(getLinkedBlocks(data, 10)).toEqual([10, 11, 12]);
        expect(data.slice(BLOCK_SIZE, 2 * BLOCK_SIZE)).toEqual(otherSave);
    });

    it('rejects malformed imports and linked-block targets before any writes', () => {
        const data = createBlankCard();
        writeMultiBlockSave(data, [2, 3, 4]);
        const snapshot = data.slice();
        for (const bytes of [new Uint8Array(0), new Uint8Array(1000), new Uint8Array(MCS_FRAME_SIZE + 1), new Uint8Array(128 + 16 * BLOCK_SIZE)]) {
            expect(importMcsToCard(data, bytes, 2)).toBeTypeOf('string');
        }
        for (const slot of [3, -1, 15, 1.5, NaN]) {
            expect(importMcsToCard(data, makeMcsData(), slot)).toBeTypeOf('string');
        }
        expect(data).toEqual(snapshot);
    });

    it('leaves an existing save intact when its replacement will not fit', () => {
        const data = createBlankCard();
        for (let i = 0; i < 15; i++) writeFakeSave(data, i);
        const snapshot = data.slice();
        expect(importMcsToCard(data, makeMcsData(2), 5)).toContain('free blocks');
        expect(data).toEqual(snapshot);
    });

    it('refuses recovery when a deleted block has been reused by another save', () => {
        const data = createBlankCard();
        writeMultiBlockSave(data, [2, 5, 8]);
        deleteSaveFromCard(data, 2);
        writeFakeSave(data, 5, 'NEWGAME');
        const snapshot = data.slice();
        expect(undeleteSaveOnCard(data, 2)).toContain('Cannot recover');
        expect(undeleteSaveOnCard(data, 8)).toContain('Cannot recover');
        expect(data).toEqual(snapshot);
    });

    it('copies into the requested free slot even when earlier slots are available', () => {
        const source = createBlankCard();
        const target = createBlankCard();
        writeMultiBlockSave(source, [2, 3]);
        expect(copySaveData(source, 2, target, 14)).toBeNull();
        expect(getLinkedBlocks(target, 14)).toEqual([14, 1]);
        expect(getSlotStatus(target, 0)).toBe(0xA0);
    });

    it('refuses to delete, copy, or export a corrupted chain', () => {
        const data = createBlankCard();
        writeMultiBlockSave(data, [2, 5, 8]);
        const offset = DIR_FRAME_OFFSET + 5 * 128;
        data[offset + 8] = 2; // cycle
        const snapshot = data.slice();
        expect(deleteSaveFromCard(data, 2)).toBeTypeOf('string');
        expect(copySaveData(data, 2, createBlankCard(), 0)).toBeTypeOf('string');
        expect(buildMcsExport(data, 2)).toBeNull();
        expect(data).toEqual(snapshot);
    });

    it('initializes unused links and the broken-sector list correctly', () => {
        const data = createBlankCard();
        for (let i = 0; i < 15; i++) expect(getLinkedBlocks(data, i)).toEqual([i]);
        for (let frame = 16; frame < 36; frame++) {
            expect(data.slice(frame * 128, frame * 128 + 4)).toEqual(new Uint8Array([255, 255, 255, 255]));
            expect(verifyChecksum(data, frame * 128)).toBe(true);
        }
        expect(data.slice(63 * 128, 64 * 128)).toEqual(data.slice(0, 128));
        formatCardData(data);
        for (let i = 0; i < 15; i++) expect(getLinkedBlocks(data, i)).toEqual([i]);
    });
});

describe('Card file formats', () => {
    it('reads and writes all raw formats without changing card bytes', () => {
        const data = createBlankCard();
        writeFakeSave(data, 14);
        for (const extension of SUPPORTED_FORMATS.filter(ext => ext !== '.gme')) {
            expect(readCardFile(buildCardFile(data, extension)).data).toEqual(data);
        }
        expect(readCardFile(data).gmeHeader).toBeNull();
    });

    it('writes the GME wrapper and preserves descriptions when saving an edited card', () => {
        const data = createBlankCard();
        writeFakeSave(data, 14);
        const bytes = buildCardFile(data, '.gme');
        expect(bytes.length).toBe(0xF40 + CARD_SIZE);
        expect(parseString(bytes, 0, 12)).toBe('123-456-STD');
        expect(bytes.slice(0x10, 0x15)).toEqual(new Uint8Array([0, 0, 1, 0, 1]));
        bytes[0x40] = 65;
        const loaded = readCardFile(bytes);
        expect(loaded.data).toEqual(data);
        deleteSaveFromCard(loaded.data, 14);
        const output = buildCardFile(loaded.data, '.gme', loaded.gmeHeader);
        expect(output[0x40]).toBe(65);
        expect(output[0x15 + 15]).toBe(0xA1);
        expect(output.slice(0xF40)).toEqual(loaded.data);
    });

    it('rejects truncated cards, oversized files, and invalid raw or GME signatures', () => {
        const data = createBlankCard();
        const badGme = buildCardFile(data, '.gme');
        badGme[0] = 0;
        for (const bytes of [data.slice(0, -1), new Uint8Array(CARD_SIZE), new Uint8Array(CARD_SIZE + 1), badGme]) {
            expect(() => readCardFile(bytes)).toThrow('Invalid memory card');
        }
    });
});
