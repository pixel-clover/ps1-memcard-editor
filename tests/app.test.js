import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_SIZE, CARD_SIZE, createBlankCard, readCardFile } from '../app/assets/js/memcard.js';

function makeMcsData(blocks = 1) {
    const data = new Uint8Array(128 + blocks * BLOCK_SIZE);
    new DataView(data.buffer).setUint32(4, blocks * BLOCK_SIZE, true);
    return data;
}

// Minimal DOM for exercising the app's real event handlers without a browser dependency.
let nodes, document, downloads, tick;
function element() {
    const node = { className: '', style: {}, dataset: {}, listeners: {}, children: [], attributes: {}, value: '' };
    node.classList = {
        contains: name => node.className.split(' ').includes(name),
        toggle(name, force) {
            const classes = new Set(node.className.split(' ').filter(Boolean));
            const active = force ?? !classes.has(name);
            if (active) classes.add(name); else classes.delete(name);
            node.className = [...classes].join(' ');
        },
        add: name => node.classList.toggle(name, true),
        remove: name => node.classList.toggle(name, false),
    };
    Object.defineProperty(node, 'innerHTML', {
        get: () => node.html,
        set: html => { node.html = html; node.children = []; },
    });
    node.addEventListener = (type, fn) => (node.listeners[type] ??= []).push(fn);
    node.appendChild = child => node.children.push(child);
    node.insertBefore = child => node.children.push(child);
    node.setAttribute = (name, value) => { node.attributes[name] = value; };
    node.getAttribute = name => node.attributes[name];
    node.closest = selector => selector === '.slot-card' && node.classList.contains('slot-card') ? node : null;
    node.click = vi.fn();
    nodes.push(node);
    return node;
}

async function emit(target, type, event) {
    for (const listener of target.listeners[type] ?? []) await listener(event);
}

function file(name, data) {
    return { name, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function drop(data) {
    return { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { files: data, getData: () => '' } };
}

async function cardBytes() {
    window.downloadCard(0);
    return new Uint8Array(await downloads.at(-1).arrayBuffer());
}

beforeEach(async () => {
    vi.resetModules();
    nodes = [];
    downloads = [];
    const ids = new Map();
    document = element();
    document.body = element();
    document.getElementById = id => {
        if (!ids.has(id)) {
            const node = element();
            node.parentNode = element();
            if (id.endsWith('Modal')) node.classList.add('modal-overlay');
            ids.set(id, node);
        }
        return ids.get(id);
    };
    document.createElement = () => element();
    document.querySelectorAll = selector => selector === '.modal-overlay.active'
        ? nodes.filter(n => n.classList.contains('modal-overlay') && n.classList.contains('active'))
        : selector === '.slot-card.selected' ? nodes.filter(n => n.classList.contains('selected')) : [];
    document.querySelector = selector => document.querySelectorAll(selector)[0] ?? null;
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('setInterval', fn => { tick = fn; return 1; });
    vi.stubGlobal('URL', { createObjectURL: blob => { downloads.push(blob); return 'blob:test'; }, revokeObjectURL: vi.fn() });
    await import('../app/assets/js/app.js');
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Browser event regressions', () => {
    it('loads both dropped cards after the browser clears the drag data store', async () => {
        const first = createBlankCard();
        const second = createBlankCard();
        second[CARD_SIZE - 1] = 42;
        const event = drop([file('first.mcr', first), file('second.mcr', second)]);
        const pending = emit(document.body, 'drop', event);
        event.dataTransfer.files = [];
        await pending;
        expect(document.getElementById('status-1').innerText).toBe('second.mcr');
        window.downloadCard(1);
        expect(new Uint8Array(await downloads.at(-1).arrayBuffer())).toEqual(second);
    });

    it('does not let an older read replace a more recently loaded card', async () => {
        let finishRead;
        const oldFile = { name: 'old.mcr', arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) };
        const pending = window.loadFile({ files: [oldFile], value: 'old.mcr' }, 0);
        const latest = createBlankCard();
        latest[CARD_SIZE - 1] = 99;
        await window.loadFile({ files: [file('latest.mcr', latest)], value: 'latest.mcr' }, 0);
        finishRead(createBlankCard().buffer);
        await pending;
        expect(document.getElementById('status-0').innerText).toBe('latest.mcr');
        expect(await cardBytes()).toEqual(latest);
    });

    it('does not replace a newly created card when an older read finishes', async () => {
        let finishRead;
        const pending = window.loadFile({ files: [{ name: 'old.mcr', arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) }], value: 'old.mcr' }, 0);
        await window.createNewCard(0);
        const oldCard = createBlankCard();
        oldCard[CARD_SIZE - 1] = 99;
        finishRead(oldCard.buffer);
        await pending;
        expect(document.getElementById('status-0').innerText).toBe('Created New Card');
        expect(await cardBytes()).toEqual(createBlankCard());
    });

    it('imports a slot drop without sending it to the global card loader', async () => {
        await window.createNewCard(0);
        const bytes = makeMcsData();
        bytes[128] = 0x53;
        bytes[129] = 0x43;
        const event = drop([file('save.mcs', bytes)]);
        const slot = document.getElementById('grid-0').children[14];
        await emit(slot, 'drop', event);
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(document.getElementById('alertModal').classList.contains('active')).toBe(false);
        const card = await cardBytes();
        expect(card[128 + 14 * 128]).toBe(0x51);
        expect(card[15 * BLOCK_SIZE]).toBe(0x53);
    });

    it('rejects a malformed slot drop without mutating the card', async () => {
        await window.createNewCard(0);
        const slot = document.getElementById('grid-0').children[0];
        const pending = emit(slot, 'drop', drop([file('bad.mcs', new Uint8Array(1000))]));
        await vi.waitFor(() => expect(document.getElementById('alertModal').classList.contains('active')).toBe(true));
        window.closeAlert(true);
        await pending;
        expect(await cardBytes()).toEqual(createBlankCard());
    });

    it('settles an escaped confirmation and lets a later operation continue', async () => {
        await window.createNewCard(0);
        const pending = window.createNewCard(0);
        await emit(document, 'keydown', { key: 'Escape', target: document.body });
        await pending;
        const next = window.createNewCard(0);
        window.closeAlert(true);
        await next;
        expect(document.getElementById('alertModal').classList.contains('active')).toBe(false);
    });

    it('clears selected slots after replacing the card', async () => {
        await window.createNewCard(0);
        const bytes = makeMcsData();
        await emit(document.getElementById('grid-0').children[0], 'drop', drop([file('save.mcs', bytes)]));
        const slot = document.getElementById('grid-0').children[0];
        await emit(document, 'click', { target: slot });
        const replacement = window.createNewCard(0);
        window.closeAlert(true);
        await replacement;
        await emit(document, 'keydown', { key: 'Delete', target: document.body });
        expect(document.getElementById('alertModal').classList.contains('active')).toBe(false);
    });

    it('renders recovery only on a deleted save head', async () => {
        const bytes = createBlankCard();
        bytes[128] = 0xA1;
        bytes[256] = 0xA2;
        bytes[384] = 0xA3;
        await window.loadFile({ files: [file('card.mcr', bytes)], value: 'card.mcr' }, 0);
        const slots = document.getElementById('grid-0').children;
        expect(slots[0].innerHTML).toContain('RECOVER');
        for (const slot of slots.slice(1)) expect(slot.innerHTML).not.toContain('RECOVER');
    });

    it('loads GME bytes and saves a real GME wrapper', async () => {
        const bytes = new Uint8Array(0xF40 + CARD_SIZE);
        bytes.set(new TextEncoder().encode('123-456-STD'));
        bytes.set(createBlankCard(), 0xF40);
        bytes[0x40] = 65;
        await window.loadFile({ files: [file('card.gme', bytes)], value: 'card.gme' }, 0);
        const output = await cardBytes();
        expect(output.length).toBe(bytes.length);
        expect(output[0x40]).toBe(65);
        expect(readCardFile(output).data).toEqual(createBlankCard());
    });

    it('does not activate the global overlay for an internal save drag', async () => {
        await window.createNewCard(0);
        await emit(document.getElementById('grid-0').children[0], 'drop', drop([file('save.mcs', makeMcsData())]));
        const slot = document.getElementById('grid-0').children[0];
        await emit(slot, 'dragstart', { dataTransfer: { setData: vi.fn() } });
        await emit(document.body, 'dragover', { preventDefault: vi.fn(), target: document.body, dataTransfer: { types: ['text/plain'] } });
        expect(document.getElementById('dropOverlay').classList.contains('active')).toBe(false);
        await emit(document.body, 'dragend', {});
        await emit(document.body, 'dragover', { preventDefault: vi.fn(), target: document.body, dataTransfer: { types: ['Files'] } });
        expect(document.getElementById('dropOverlay').classList.contains('active')).toBe(true);
        await emit(document.body, 'dragover', { preventDefault: vi.fn(), target: slot, dataTransfer: { types: ['Files'] } });
        expect(document.getElementById('dropOverlay').classList.contains('active')).toBe(false);
        tick();
    });

    it('keeps the app usable when localStorage is blocked', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('Storage blocked'); },
            setItem: () => { throw new Error('Storage blocked'); },
        });
        vi.resetModules();
        await import('../app/assets/js/app.js');
        expect(() => window.toggleTheme()).not.toThrow();
        await window.createNewCard(0);
        expect(await cardBytes()).toEqual(createBlankCard());
    });

    it('reports a save read failure and resets the import picker', async () => {
        await window.createNewCard(0);
        const input = { files: [{ arrayBuffer: async () => { throw new Error('Cannot read file'); } }], value: 'save.mcs' };
        const pending = window.handleImport(input);
        await vi.waitFor(() => expect(document.getElementById('alertMessage').innerText).toBe('Cannot read file'));
        window.closeAlert(true);
        await pending;
        expect(input.value).toBe('');
        expect(await cardBytes()).toEqual(createBlankCard());
    });

    it('alternates two-frame icons without repeating the first frame at every third tick', async () => {
        const bytes = createBlankCard();
        bytes[128] = 0x51;
        bytes[BLOCK_SIZE + 2] = 0x12;
        bytes[BLOCK_SIZE + 0x62] = 31; // palette index 1: red
        bytes[BLOCK_SIZE + 0x64] = 0xE0; // palette index 2: green
        bytes[BLOCK_SIZE + 0x65] = 3;
        bytes.fill(0x11, BLOCK_SIZE + 0x80, BLOCK_SIZE + 0x100);
        bytes.fill(0x22, BLOCK_SIZE + 0x100, BLOCK_SIZE + 0x180);
        const colors = [];
        const context = {
            createImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }),
            putImageData: image => colors.push(Array.from(image.data.slice(0, 3))),
        };
        const canvas = { closest: () => ({ dataset: { slot: '0' } }), getContext: () => context };
        const query = document.querySelectorAll;
        document.querySelectorAll = selector => selector === '#grid-0 .slot-card canvas' ? [canvas] : query(selector);
        await window.loadFile({ files: [file('card.mcr', bytes)], value: 'card.mcr' }, 0);
        for (let i = 0; i < 6; i++) tick();
        expect(colors).toEqual([[248, 0, 0], [0, 248, 0], [248, 0, 0], [0, 248, 0], [248, 0, 0], [0, 248, 0], [248, 0, 0]]);
    });
});
