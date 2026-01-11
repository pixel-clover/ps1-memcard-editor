
export class Renderer {
    constructor() {
        this.tiles = {}; // type -> list of Image objects
        this.tileManifest = [];
    }

    async loadAssets() {
        try {
            const response = await fetch('tiles/tiles.json');
            const files = await response.json();
            await this._loadImages(files);
            return true;
        } catch (e) {
            console.error("Failed to load assets:", e);
            return false;
        }
    }

    async _loadImages(files) {
        const promises = files.map(filename => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = `tiles/hex_1/${filename}`;
                img.onload = () => resolve({ filename, img });
                img.onerror = reject;
            });
        });

        const results = await Promise.all(promises);

        // Organize by type
        // filename: type_variant_tile.png
        const regex = /^([a-z_]+)_(\d+)_tile\.(png|webp|bmp)$/i;

        results.forEach(({ filename, img }) => {
            const match = filename.match(regex);
            if (match) {
                const type = match[1].toLowerCase();
                if (!this.tiles[type]) {
                    this.tiles[type] = [];
                }
                // Insert in order if possible, though simply pushing is usually fine as long as we sort later or rely on index
                // The filename has the variant index. Let's start with simple push.
                // Actually map.py sorts them: items.sort(key=lambda x: x[0].lower())
                // which implies sorting by filename.
                this.tiles[type].push({ filename, img });
            }
        });

        // Sort by filename to ensure deterministic variant selection
        for (const type in this.tiles) {
            this.tiles[type].sort((a, b) => a.filename.localeCompare(b.filename));
            // Flatten to just images for easier usage
            this.tiles[type] = this.tiles[type].map(item => item.img);
        }
    }

    /**
     * Renders the map to the canvas
     * @param {HTMLCanvasElement} canvas 
     * @param {Object} mapData { rows, cols, tilemap, dy, seed, elev, temp, humid }
     * @param {Object} cfg Config object with layout params
     * @param {Object} camera { x, y, zoom }
     * @param {String} renderMode 'terrain', 'elev', 'temp', 'humid'
     */
    render(canvas, mapData, cfg, camera = { x: 0, y: 0, zoom: 1 }, renderMode = 'terrain') {
        if (!mapData) return;

        const ctx = canvas.getContext('2d');
        const { rows, cols, tilemap, dy, seed, elev, temp, humid } = mapData;

        // Ensure canvas fills the container
        const container = canvas.parentElement;
        if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        // Apply camera
        ctx.translate(canvas.width / 2, canvas.height / 2); // Center pivot
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-canvas.width / 2 + camera.x, -canvas.height / 2 + camera.y);

        // Optimization: Cull tiles outside viewport? 
        // For MVP, render all. 60k tiles might be pushing it at 60fps on low-end
        // but let's try simple full redraw first.
        // Actually, for zoom we need high quality interpolation if possible
        ctx.imageSmoothingEnabled = camera.zoom < 1.0;

        // Calculate map dimensions (centering the map itself)
        const maxUp = cfg.height_px + 28;
        const outW = cfg.row_off_x + (cols - 1) * cfg.step_x + cfg.tile_w;
        const outH = (rows - 1) * cfg.row_step_y + cfg.tile_h + maxUp;

        // Center the map content relative to world origin (0,0)
        // If we want (0,0) to be the top-left of the map, we don't translate here.
        // But let's center the map content so zooming focuses on center by default.
        const mapOffsetX = -outW / 2;
        const mapOffsetY = -outH / 2;

        // Pre-calculate hex path for non-sprite rendering
        const hexPath = new Path2D();
        const r6 = cfg.tile_w / 2; // Approximate radius
        // Actually tile_w is width (flat to flat?), let's use a simple hex shape
        // width=26, height=32. 
        // Points: (0, 8), (13, 0), (26, 8), (26, 24), (13, 32), (0, 24)
        hexPath.moveTo(0, 8);
        hexPath.lineTo(13, 0);
        hexPath.lineTo(26, 8);
        hexPath.lineTo(26, 24);
        hexPath.lineTo(13, 32);
        hexPath.lineTo(0, 24);
        hexPath.closePath();

        for (let r = 0; r < rows; r++) {
            const baseX = (r % 2 === 1) ? cfg.row_off_x : 0;
            const baseY = r * cfg.row_step_y + maxUp;

            // Simple culling
            // Calculate world position
            // x = mapOffsetX + baseX + c * step_x
            // y = mapOffsetY + baseY + dy
            // If we knew camera bounds we could skip loop. 
            // optimization TODO for later if slow.

            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;

                // Position
                const x = mapOffsetX + baseX + c * cfg.step_x;
                // For debug modes, ignore height offset or flatten it? 
                // Let's keep height offset for shape but maybe color flat?
                // Visualizing data on flat map is often easier. Let's start flat for data modes.
                const y = mapOffsetY + baseY + (renderMode === 'terrain' ? dy[idx] : 0);

                if (renderMode === 'terrain') {
                    const tileType = tilemap[idx];
                    const img = this._pickVariant(tileType, seed, r, c);
                    if (img) {
                        ctx.drawImage(img, x, y);
                    }
                } else {
                    // Data visualization
                    let color = '#000';
                    if (renderMode === 'elev' && elev) {
                        const v = Math.floor(elev[idx] * 255);
                        color = `rgb(${v},${v},${v})`;
                    } else if (renderMode === 'temp' && temp) {
                        // Blue (0) -> Red (1)
                        const t = temp[idx];
                        const rVal = Math.floor(t * 255);
                        const bVal = Math.floor((1 - t) * 255);
                        color = `rgb(${rVal}, 0, ${bVal})`;
                    } else if (renderMode === 'humid' && humid) {
                        // Yellow (0) -> Blue/Green (1)
                        const h = humid[idx];
                        const rVal = Math.floor((1 - h) * 255);
                        const gVal = Math.floor(Math.min(1, h * 1.5) * 255); // emphasize green
                        const bVal = Math.floor((h * 0.5) * 255);
                        color = `rgb(${rVal}, ${gVal}, ${bVal})`;
                    }

                    ctx.fillStyle = color;
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.fill(hexPath);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    // ... render method ...

    /**
     * Converts screen coordinates to map hex coordinates (row, col)
     * @param {Number} screenX Mouse X relative to canvas
     * @param {Number} screenY Mouse Y relative to canvas
     * @param {Object} camera {x, y, zoom}
     * @param {HTMLCanvasElement} canvas
     * @param {Object} cfg Config 
     * @param {Object} mapData {rows, cols}
     * @returns {Object|null} {r, c} or null if out of bounds
     */
    getHexFromScreen(screenX, screenY, camera, canvas, cfg, mapData) {
        if (!mapData) return null;

        // 1. Inverse Camera Transform
        // Screen -> World
        // ctx.translate(W/2, H/2) -> scale(Z) -> translate(-W/2+CX, -H/2+CY)

        const w = canvas.width;
        const h = canvas.height;

        let wx = (screenX - w / 2) / camera.zoom - (-w / 2 + camera.x);
        let wy = (screenY - h / 2) / camera.zoom - (-h / 2 + camera.y);

        // 2. Map Offset (centering)
        const maxUp = cfg.height_px + 28; // This was used in render for top padding
        const outW = cfg.row_off_x + (mapData.cols - 1) * cfg.step_x + cfg.tile_w;
        const outH = (mapData.rows - 1) * cfg.row_step_y + cfg.tile_h + maxUp;

        const mapOffsetX = -outW / 2;
        const mapOffsetY = -outH / 2;

        // Local Map Coordinates
        const mapX = wx - mapOffsetX;
        const mapY = wy - mapOffsetY;

        // 3. Approximate Hex
        // In the render loop: 
        // y = r * row_step_y + maxUp (+ heightOffset)
        // x = (r%2==1 ? off : 0) + c * step_x

        // Ignoring height offset for picking (picking on "sea level" plane is standard for 2D map editors unless we do raycasting)
        // Approximate Row
        let approxR = Math.round((mapY - maxUp) / cfg.row_step_y);

        // Check neighbors to find closest center
        let bestDistSq = Infinity;
        let bestRC = null;

        const searchRadius = 2; // Look at nearby rows

        for (let r = approxR - searchRadius; r <= approxR + searchRadius; r++) {
            if (r < 0 || r >= mapData.rows) continue;

            const baseX = (r % 2 === 1) ? cfg.row_off_x : 0;
            const baseY = r * cfg.row_step_y + maxUp;

            // Approximate Col
            let approxC = Math.round((mapX - baseX) / cfg.step_x);

            for (let c = approxC - searchRadius; c <= approxC + searchRadius; c++) {
                if (c < 0 || c >= mapData.cols) continue;

                const cx = baseX + c * cfg.step_x + cfg.tile_w / 2;
                const cy = baseY + cfg.tile_h / 2; // center of tile (approx) using bounding box center
                // Note: render draws at x,y (top-left of sprite). 
                // Sprite center is x + tile_w/2, y + tile_h/2.
                // Actually tile_h is 32, tile_w 26? 
                // Let's us tile center.

                const distSq = (mapX - cx) ** 2 + (mapY - cy) ** 2;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestRC = { r, c };
                }
            }
        }

        // Validate distance (click must be somewhat close)
        // Half-width squared approx 13*13 = 169. Let's say 400.
        if (bestDistSq < 600) {
            return bestRC;
        }
        return null;
    }

    _pickVariant(type, seed, r, c) {
        let arr = this.tiles[type];
        if (!arr || arr.length === 0) {
            arr = this.tiles['grass']; // Fallback
        }
        if (!arr || arr.length === 0) return null;

        // Python: hash01 based selection
        // h = hashlib.blake2b(f"{seed}|{t}|{r}|{c}".encode("utf-8"), digest_size=8).digest()
        // return arr[int.from_bytes(h, "little") % len(arr)]

        // JS Approximation of a stable hash for this tile
        // We can't easily match blake2b exactly without a heavy library, 
        // asking the user to accept a simple murmur or custom hash for visual consistency

        const idx = Math.abs(this._hash(seed, type, r, c)) % arr.length;
        return arr[idx];
    }

    // Simple hash function to replace blake2b
    _hash(seed, type, r, c) {
        let str = `${seed}|${type}|${r}|${c}`;
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h;
    }
}
