
import { Renderer } from './renderer.js';
import { Config } from './map_generator.js'; // Keep Config for defaults

const renderer = new Renderer();

// Worker setup
const worker = new Worker('js/worker.js', { type: 'module' });

const canvas = document.getElementById('mapCanvas');
const generateBtn = document.getElementById('generateBtn');
const seedInput = document.getElementById('seedInput');
const rowsInput = document.getElementById('rowsInput');
const colsInput = document.getElementById('colsInput');
const seaLevelInput = document.getElementById('seaLevelInput');
const tempInput = document.getElementById('tempInput');
const humidInput = document.getElementById('humidInput');
const viewModeInput = document.getElementById('viewMode');

const statusMsg = document.getElementById('statusMsg');

let currentMapData = null;
let currentConfig = null;

// Camera State
let camera = { x: 0, y: 0, zoom: 0.5 };
let isDragging = false;
let startPanX = 0;
let startPanY = 0;

worker.onmessage = function (e) {
    const { type, mapData, duration, message } = e.data;
    if (type === 'success') {
        currentMapData = mapData;
        console.log(`Generation took ${Math.round(duration)}ms (Worker)`);
        setStatus(`Generated in ${Math.round(duration)}ms`);
        render();
        generateBtn.disabled = false;
    } else if (type === 'error') {
        console.error("Worker error:", message);
        setStatus("Error: " + message);
        generateBtn.disabled = false;
    }
};

const exportPngBtn = document.getElementById('exportPngBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');

async function init() {
    setStatus("Loading assets...");
    const success = await renderer.loadAssets();
    if (success) {
        setStatus("Ready");
        generateBtn.addEventListener('click', generateMap);

        // Parameter listeners (regenerate on change)
        [seaLevelInput, tempInput, humidInput, rowsInput, colsInput, seedInput].forEach(el => {
            el.addEventListener('change', generateMap);
        });

        // View mode listener (just re-render)
        viewModeInput.addEventListener('change', render);

        // Export listeners
        exportPngBtn.addEventListener('click', exportPng);
        exportJsonBtn.addEventListener('click', exportJson);

        // Initial generation
        generateMap();

        // Resize listener
        window.addEventListener('resize', () => {
            render();
        });

        setupInteraction();
    } else {
        setStatus("Error loading assets. Check console.");
        generateBtn.disabled = true;
    }
}

function exportPng() {
    if (!currentMapData || !currentConfig) return;

    // Create offscreen canvas
    const offCanvas = document.createElement('canvas');
    // Default camera centers the map
    renderer.render(offCanvas, currentMapData, currentConfig, { x: 0, y: 0, zoom: 1 }, viewModeInput.value);

    const link = document.createElement('a');
    link.download = `map_seed${currentConfig.seed}.png`;
    link.href = offCanvas.toDataURL();
    link.click();
}

function exportJson() {
    if (!currentMapData) return;

    // Create clean object to export
    const data = {
        config: currentConfig,
        // We might want to export the map structure, not the raw arrays if they are huge?
        // But users requested JSON export usually to save/load.
        // The raw arrays are efficient.
        // converting typed arrays to regular arrays for JSON stringify
        map: {
            ...currentMapData,
            tilemap: Array.from(currentMapData.tilemap),
            dy: Array.from(currentMapData.dy),
            elev: Array.from(currentMapData.elev),
            temp: Array.from(currentMapData.temp),
            humid: Array.from(currentMapData.humid)
        }
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `map_seed${currentConfig.seed}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
}

function setupInteraction() {
    canvas.addEventListener('mousedown', e => {
        if (isEditMode) {
            isPainting = true;
            paint(e);
        } else {
            isDragging = true;
            startPanX = e.clientX;
            startPanY = e.clientY;
            canvas.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', e => {
        if (isEditMode) {
            if (isPainting) paint(e);
            // Highlight hex under cursor? (TODO later)
        } else if (isDragging) {
            const dx = e.clientX - startPanX;
            const dy = e.clientY - startPanY;
            camera.x += dx / camera.zoom;
            camera.y += dy / camera.zoom;
            startPanX = e.clientX;
            startPanY = e.clientY;
            render();
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        isPainting = false;
        if (!isEditMode) canvas.style.cursor = 'default';
    });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomSpeed = 0.1;
        const delta = -Math.sign(e.deltaY) * zoomSpeed;

        const newZoom = Math.max(0.1, Math.min(5.0, camera.zoom + delta));

        // Simple zoom to center for now.
        // To zoom to mouse: need to adjust camera.x/y based on mouse position
        // offset from center.
        // Let's stick to center zoom for simplicity unless requested.
        camera.zoom = newZoom;

        render();
    }, { passive: false });
}

function paint(e) {
    if (!currentMapData || !currentConfig) return;

    // Get mouse pos relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hex = renderer.getHexFromScreen(mx, my, camera, canvas, currentConfig, currentMapData);

    if (hex) {
        applyBrush(hex.r, hex.c);
        render();
    }
}

function applyBrush(r, c) {
    const type = brushTypeSelect.value;
    const size = parseInt(brushSizeInput.value);
    const { rows, cols } = currentConfig;

    const setTile = (rr, cc) => {
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
            currentMapData.tilemap[rr * cols + cc] = type;
            // Also update "land" status in dy?
            // If painting water, maybe set dy to 0?
            // If painting land, maybe set dy to 1? (simplified)
            // For now just tilemap to show visual change.
            // But if we switch to elevation view, it won't match.
            // That's acceptable for MVP brush.
        }
    };

    setTile(r, c);

    if (size > 0) {
        // Neighbors
        const getNeighbors = (r, c) => {
            const deltas = (r & 1) === 0 ?
                [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]] :
                [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
            return deltas.map(([dr, dc]) => [r + dr, c + dc]);
        };

        let q = [[r, c]];
        let visited = new Set([`${r},${c}`]);
        let dist = new Map();
        dist.set(`${r},${c}`, 0);

        let head = 0;
        while (head < q.length) {
            const [cr, cc] = q[head++];
            if (dist.get(`${cr},${cc}`) >= size) continue;

            for (const [nr, nc] of getNeighbors(cr, cc)) {
                if (!visited.has(`${nr},${nc}`)) {
                    visited.add(`${nr},${nc}`);
                    dist.set(`${nr},${nc}`, dist.get(`${cr},${cc}`) + 1);
                    setTile(nr, nc);
                    q.push([nr, nc]);
                }
            }
        }
    }
}

function setStatus(msg) {
    statusMsg.textContent = msg;
}

function generateMap() {
    if (generateBtn.disabled) return;

    setStatus("Generating...");
    generateBtn.disabled = true;

    const seed = parseInt(seedInput.value) || 5;
    const rows = parseInt(rowsInput.value) || 200;
    const cols = parseInt(colsInput.value) || 300;

    // New Params
    const seaLevel = parseFloat(seaLevelInput.value);
    const tempOffset = parseFloat(tempInput.value);
    const humidOffset = parseFloat(humidInput.value);

    const cfg = { ...Config };
    cfg.seed = seed;
    cfg.rows = rows;
    cfg.cols = cols;

    if (!isNaN(seaLevel)) cfg.sea_level = seaLevel;
    if (!isNaN(tempOffset)) cfg.temp_offset = tempOffset;
    if (!isNaN(humidOffset)) cfg.humid_offset = humidOffset;

    currentConfig = cfg;

    worker.postMessage({
        type: 'generate',
        config: cfg
    });
}

function render() {
    if (!currentMapData || !currentConfig) return;
    const mode = viewModeInput.value;
    renderer.render(canvas, currentMapData, currentConfig, camera, mode);
}

init();
