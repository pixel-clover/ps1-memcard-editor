
// Default Configuration matching map.py
export const Config = {
    seed: 5,
    rows: 200,
    cols: 300,

    // Hex draw layout
    tile_w: 26,
    tile_h: 32,
    step_x: 23,
    row_off_x: 12,
    row_step_y: 17,

    // Vertical displacement
    height_px: 60,
    height_gamma: 1.10,
    height_smooth_passes: 1,
    height_max_neighbor_delta: 2,

    // Landmass
    sea_level: 0.44,
    continental_scale: 25,
    continental_octaves: 3,
    continental_smooth_passes: 2,

    // Terrain features
    peaks_scale: 6,
    peaks_octaves: 5,
    erosion_scale: 8,
    erosion_octaves: 4,

    // Ridge mountains
    ridge_scale_long: 30,
    ridge_scale_short: 9,
    ridge_octaves: 4,
    ridge_strength: 0.55,

    // Mountains shaping
    mountain_level: 0.73,
    ridge_mountain_thresh: 0.75,
    peak_mountain_thresh: 0.86,
    mountain_ridge_keep_base: 0.18,
    mountain_ridge_keep_gain: 0.70,
    mountain_peak_keep_prob: 0.28,
    mountain_thin_passes: 5,
    mountain_thin_remove_ge: 3,
    mountain_thin_junction_ridge: 0.84,
    mountain_speck_prune_passes: 2,

    // Hills
    hill_level: 0.63,
    hill_near_mountain_dist: 1,
    hill_extra_prob: 0.40,

    // Climate
    humid_scale: 8,
    humid_octaves: 5,
    temp_scale: 9,
    temp_octaves: 5,

    // Domain warp
    warp_scale: 8,
    warp_octaves: 3,
    warp_amp: 4,

    persistence: 0.52,
    lacunarity: 2.0,
    peaks_strength: 0.72,
    erosion_strength: 0.55,

    // Water depth transitions
    shallow_band: 1,
    deep_band: 3,
    water_break_scale: 3,
    water_break_octaves: 6,
    water_break_amp: 5.0,
    water_break_smooth: 1,
    deep_core_extra: 2,
    deep_connect_relax: 1,
    deep_edge_lo: -0.35,
    deep_edge_hi: 0.35,

    // Biomes
    hot_temp: 0.64,
    cold_temp: 0.36,
    snow_temp: 0.27,

    wet_humid: 0.66,
    forest_humid: 0.44,
    jungle_humid: 0.65,

    dry_humid: 0.34,
    very_dry_humid: 0.22,

    // Jungle boost
    jungle_temp_min: 0.46,
    jungle_seed_scale: 5,
    jungle_seed_octaves: 3,
    jungle_seed_smooth: 1,
    jungle_seed_thresh: 0.32,
    jungle_extra_humid_pad: 0.04,

    // Lakes
    lake_noise_scale: 20,
    lake_octaves: 2,
    lake_strength: 0.35,
    lake_level_boost: 0.05,
    lake_min_coast_dist: 16,
    lake_thresh: 1.40,
    lake_range_bias: 0.55,
    lake_max_mtn_dist: 10,

    // Rivers
    river_count: 6,
    river_source_elev: 0.74,
    river_min_coast_dist: 8,
    river_valley_thresh: 0.74,
    river_max_len: 220,
    river_prune_passes: 6,
    river_ridge_source_thresh: 0.64,
    river_source_max_mtn_dist: 10,

    // Desert and wheat
    desert_scale: 24,
    desert_octaves: 2,
    desert_hot_boost: 0.10,
    desert_smooth_passes: 3,

    wheat_scale: 12,
    wheat_octaves: 2,
    wheat_smooth_passes: 1,
    wheat_thresh: 0.54,

    wheat_convert_prob: 0.22,
    wheat_convert_scale: 9,
    wheat_convert_octaves: 2,
    wheat_convert_smooth: 1,
    wheat_convert_min_temp: 0.34,
    wheat_convert_max_temp: 0.78,
    wheat_convert_min_humid: 0.30,
    wheat_convert_max_humid: 0.62,

    grass_humid_min: 0.36,

    // Equator bias
    equator_fields_strength: 0.14,
    equator_desert_strength: 0.10,
    equator_forest_suppress: 0.06,

    // Beaches
    beach_scale: 14,
    beach_octaves: 2,
    beach_smooth_passes: 1,
    beach_base_p1: 0.50,
    beach_base_p2: 0.18,
    beach_humid_cut: 0.62,
    beach_temp_min: 0.30,

    // Clustering
    cluster_passes: 2,
    cluster_min_same: 4,
    cluster_change_prob: 0.65,
    cluster_protect: ["deep_water", "water", "shallow_water", "mountains", "snow"],
    cluster_only: [
        "grass", "forest", "jungle", "wheat", "swamp", "swamp_pads", "swamp_reeds",
        "dirt", "clay", "sand", "dunes", "taiga",
    ],

    // Dunes
    dunes_in_sand_min_depth: 2,
    dunes_in_sand_prob_base: 0.70,
    dunes_in_sand_noise_scale: 10,
    dunes_in_sand_noise_octaves: 2,
    dunes_in_sand_noise_smooth: 1
};

class Random {
    constructor(seed) {
        this.state = seed | 0;
    }

    // Mulberry32
    next() {
        var t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    randGrid(h, w) {
        const arr = new Float32Array(h * w);
        for (let i = 0; i < h * w; i++) {
            arr[i] = this.next();
        }
        return arr;
    }
}

class Noise {
    static valueNoise2d(shape, rng, scaleOrSy, sx = null) {
        const [h, w] = shape;
        const sy = Math.max(1, Math.floor(scaleOrSy));
        const sx_val = sx === null ? sy : Math.max(1, Math.floor(sx));

        const gh = Math.floor(h / sy) + 2;
        const gw = Math.floor(w / sx_val) + 2;

        // We need a fresh grid for every noise call to match python behavior
        // where it creates a new RNG or uses fresh randoms.
        const g = rng.randGrid(gh, gw);

        const out = new Float32Array(h * w);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const ys = y / sy;
                const xs = x / sx_val;

                const y0 = Math.floor(ys);
                const x0 = Math.floor(xs);

                const y0_cl = Math.max(0, Math.min(y0, gh - 1));
                const x0_cl = Math.max(0, Math.min(x0, gw - 1));
                const y1_cl = Math.max(0, Math.min(y0 + 1, gh - 1));
                const x1_cl = Math.max(0, Math.min(x0 + 1, gw - 1));

                const ty = ys - y0;
                const tx = xs - x0;

                const g00 = g[y0_cl * gw + x0_cl];
                const g01 = g[y0_cl * gw + x1_cl];
                const g10 = g[y1_cl * gw + x0_cl];
                const g11 = g[y1_cl * gw + x1_cl];

                const a = g00 * (1.0 - tx) + g01 * tx;
                const b = g10 * (1.0 - tx) + g11 * tx;

                out[y * w + x] = a * (1.0 - ty) + b * ty;
            }
        }
        return out;
    }

    static fbm(shape, rng, baseScale, octaves, p, lac) {
        const [h, w] = shape;
        const total = new Float32Array(h * w);
        let amp = 1.0;
        let freq = 1.0;
        let ampSum = 0.0;

        for (let i = 0; i < octaves; i++) {
            const scale = Math.max(1, Math.floor(baseScale / freq));
            // Note: Python passes seed + 1013 * i.
            // We use a single RNG stream, so we just generate the grid.
            // Since we re-instantiate RNG or continue the stream, distinct properties come from the stream.
            // But to emulate "seed + offset", we might want to re-seed?
            // Python: value_noise_2d(shape, seed + 1013 * i, scale)
            // Here, we'll just let the RNG progress. It won't be identical to Python anyway.

            const layer = Noise.valueNoise2d(shape, rng, scale);
            for (let k = 0; k < total.length; k++) {
                total[k] += amp * layer[k];
            }
            ampSum += amp;
            amp *= p;
            freq *= lac;
        }

        const max_val = Math.max(1e-6, ampSum);
        for (let k = 0; k < total.length; k++) {
            total[k] /= max_val;
        }
        return total;
    }

    static fbmAniso(shape, rng, baseSy, baseSx, octaves, p, lac) {
        const [h, w] = shape;
        const total = new Float32Array(h * w);
        let amp = 1.0;
        let freq = 1.0;
        let ampSum = 0.0;

        for (let i = 0; i < octaves; i++) {
            const sy = Math.max(1, Math.floor(baseSy / freq));
            const sx = Math.max(1, Math.floor(baseSx / freq));

            const layer = Noise.valueNoise2d(shape, rng, sy, sx);

            for (let k = 0; k < total.length; k++) {
                total[k] += amp * layer[k];
            }
            ampSum += amp;
            amp *= p;
            freq *= lac;
        }

        const max_val = Math.max(1e-6, ampSum);
        for (let k = 0; k < total.length; k++) {
            total[k] /= max_val;
        }
        return total;
    }
}

class GridUtils {
    static normalize01(arr) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let v of arr) {
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }

        const out = new Float32Array(arr.length);
        if (mx - mn < 1e-8) return out; // zeros

        const range = mx - mn;
        for (let i = 0; i < arr.length; i++) {
            out[i] = (arr[i] - mn) / range;
        }
        return out;
    }

    static smoothBox(arr, rows, cols, passes) {
        let out = new Float32Array(arr); // copy
        if (!passes || passes < 1) return out;

        for (let p = 0; p < Math.floor(passes); p++) {
            const temp = new Float32Array(out.length);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    let sum = 0;
                    // 3x3 kernel
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            // Python np.roll wraps around. We should wrap too.
                            const rr = (r + dr + rows) % rows;
                            const cc = (c + dc + cols) % cols;
                            sum += out[rr * cols + cc];
                        }
                    }
                    temp[r * cols + c] = sum / 9.0;
                }
            }
            out = temp;
        }
        return out;
    }

    static ridged01(n01) {
        const out = new Float32Array(n01.length);
        for (let i = 0; i < n01.length; i++) {
            out[i] = 1.0 - Math.abs(2.0 * n01[i] - 1.0);
        }
        return GridUtils.normalize01(out);
    }

    static warpInt(arr, rows, cols, wx, wy) {
        const out = new Float32Array(arr.length);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // wx, wy are int offsets
                const ox = wx[r * cols + c];
                const oy = wy[r * cols + c];

                // clip
                const r2 = Math.max(0, Math.min(rows - 1, r + oy));
                const c2 = Math.max(0, Math.min(cols - 1, c + ox));

                out[r * cols + c] = arr[r2 * cols + c2];
            }
        }
        return out;
    }

    static hash01(seed, r, c, tag) {
        // Simple hashing
        let str = `${seed}|${tag}|${r}|${c}`;
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return ((h >>> 0) / 4294967296);
    }
}

export class MapGenerator {
    constructor() { }

    generate(cfg) {
        this.cfg = cfg;
        this.rows = cfg.rows;
        this.cols = cfg.cols;
        this.seed = cfg.seed;

        // Main pipeline
        const fields = this.buildFields();
        const mtn = this.buildMountains(fields);
        const distToMtn = this.hexBfsDistance(mtn);

        const waterData = this.addLakes(fields.elev, fields.land, fields.distToWater, distToMtn);
        const water0 = waterData.water0;
        const ocean = waterData.ocean;
        const lakes = waterData.lakes;

        const land2 = new Uint8Array(this.rows * this.cols);
        for (let i = 0; i < land2.length; i++) land2[i] = water0[i] ? 0 : 1;

        // Rivers
        const riverRaw = this.carveRivers(fields.elev, land2, fields.distToWater, fields.peaks, fields.ridges, distToMtn);
        const river = this.pruneRivers(riverRaw, water0);

        // Biome Noisec
        const rng = new Random(this.seed);
        const noiseField = (off, scale, oct, smooth = 0) => {
            const r = new Random(this.seed + off);
            const raw = Noise.fbm([this.rows, this.cols], r, scale, oct, cfg.persistence, cfg.lacunarity);
            const norm = GridUtils.normalize01(raw);
            return GridUtils.smoothBox(norm, this.rows, this.cols, smooth);
        };

        const desertF = noiseField(200, cfg.desert_scale, cfg.desert_octaves, cfg.desert_smooth_passes);
        const wheatF = noiseField(210, cfg.wheat_scale, cfg.wheat_octaves, cfg.wheat_smooth_passes);
        const beachF = noiseField(220, cfg.beach_scale, cfg.beach_octaves, cfg.beach_smooth_passes);
        const jungleSeed = noiseField(230, cfg.jungle_seed_scale, cfg.jungle_seed_octaves, cfg.jungle_seed_smooth);

        // Tilemap construction
        const tilemap = new Array(this.rows * this.cols).fill("grass");

        for (let i = 0; i < tilemap.length; i++) {
            if (river[i] === 1 && land2[i]) tilemap[i] = "shallow_water";
        }

        const mtn2 = new Uint8Array(mtn.length);
        for (let i = 0; i < mtn.length; i++) mtn2[i] = mtn[i] && land2[i];

        const hillsNear = this.hexBfsDistance(mtn2); // returns dist matrix
        // logic: dist <= hill_near_mountain_dist

        const lat = new Float32Array(this.rows);
        for (let r = 0; r < this.rows; r++) lat[r] = r / this.rows;

        // Iteration
        for (let r = 0; r < this.rows; r++) {
            const eq = 1.0 - Math.abs(lat[r] * 2.0 - 1.0);

            for (let c = 0; c < this.cols; c++) {
                const idx = r * this.cols + c;
                if (!land2[idx] || tilemap[idx] === "shallow_water") continue;

                // Determine biomes
                const t = fields.temp[idx];
                const h = fields.humid[idx];
                const e = fields.elev[idx];

                if (t <= cfg.snow_temp) {
                    tilemap[idx] = "snow";
                } else if (t <= cfg.cold_temp) {
                    if (h >= cfg.dry_humid) tilemap[idx] = "taiga";
                    else tilemap[idx] = "dirt";
                }

                // Mountains
                if (mtn[idx]) {
                    if (t <= cfg.cold_temp) tilemap[idx] = "snow";
                    else tilemap[idx] = "mountains";
                }

                // Hills
                if (!mtn[idx]) {
                    const isNear = hillsNear[idx] <= cfg.hill_near_mountain_dist;
                    // Python: noise_field(900, 14, 1, 0)
                    // We need that noise field. But for performance, maybe skip or quick hack?
                    // Let's create it once outside loop if accurate replication matters.
                    // Or just use a random check
                    if ((e >= cfg.hill_level && isNear)) {
                        tilemap[idx] = "hills"; // simplified slightly
                    }
                }

                // Fix overwritten snow/hills
                if (tilemap[idx] === "hills" && t <= cfg.snow_temp) tilemap[idx] = "snow";

                // Warm biomes
                if (t > cfg.cold_temp && tilemap[idx] === "grass") {
                    const hotCut = cfg.hot_temp - 0.02 * eq;
                    const desertScore = desertF[idx] + (t - hotCut) + cfg.desert_hot_boost + cfg.equator_desert_strength * eq;

                    if (t >= hotCut && h <= 0.44 && desertScore > 0.90) {
                        tilemap[idx] = h <= cfg.very_dry_humid ? "dunes" : "sand";
                    } else if (h >= cfg.wet_humid) {
                        // Swamp
                        const v = GridUtils.hash01(cfg.seed, r, c, "swamp");
                        if (v < 0.33) tilemap[idx] = "swamp";
                        else if (v < 0.66) tilemap[idx] = "swamp_pads";
                        else tilemap[idx] = "swamp_reeds";
                    } else {
                        const forestCut = cfg.forest_humid + cfg.equator_forest_suppress * eq;
                        if (h >= forestCut) {
                            tilemap[idx] = "forest";
                            // Jungle check
                            if (h >= (cfg.jungle_humid - cfg.jungle_extra_humid_pad) &&
                                t >= cfg.jungle_temp_min &&
                                jungleSeed[idx] >= cfg.jungle_seed_thresh) {
                                tilemap[idx] = "jungle";
                            }
                        } else {
                            // Plains
                            const grassMin = Math.max(0.0, cfg.grass_humid_min - cfg.equator_fields_strength * eq);
                            if (h < grassMin) {
                                tilemap[idx] = h < cfg.dry_humid ? "clay" : "dirt";
                            }
                        }
                    }
                }

                // Wheat
                if (tilemap[idx] === "grass" && t > cfg.cold_temp &&
                    h >= 0.30 && h <= 0.64 &&
                    t >= 0.34 && t <= 0.78 &&
                    wheatF[idx] > cfg.wheat_thresh) {
                    tilemap[idx] = "wheat";
                }
            }
        }

        // Finalize water/ocean
        for (let i = 0; i < tilemap.length; i++) {
            if (lakes[i]) {
                // simplified lake logic
                tilemap[i] = "water";
            } else if (!land2[i]) {
                tilemap[i] = "deep_water"; // default ocean
            }
        }

        // Apply ocean depths (simplified)
        // In python: apply_ocean_depths does a lot.
        // For MVP, lets just say everything !land is deep_water, except near coast
        const distToLand = this.hexBfsDistance(land2);
        for (let i = 0; i < tilemap.length; i++) {
            if (!land2[i] && !lakes[i]) {
                if (distToLand[i] <= cfg.shallow_band) tilemap[i] = "shallow_water";
                else tilemap[i] = "deep_water";
            }
        }

        // Call generateRivers after initial tilemap is built
        this.generateRivers(this.rows, this.cols, fields.elev, fields.humid, tilemap);

        const elevSmooth = GridUtils.smoothBox(fields.elev, this.rows, this.cols, cfg.height_smooth_passes);
        const dy = new Int32Array(this.rows * this.cols);

        for (let i = 0; i < dy.length; i++) {
            const isOcean = !land2[i] && !lakes[i]; // roughly
            if (isOcean) {
                dy[i] = 0;
            } else {
                const base = Math.max(0.0, elevSmooth[i] - cfg.sea_level);
                const h = Math.pow(base, cfg.height_gamma);
                dy[i] = Math.round(-h * cfg.height_px);
            }
        }

        return {
            tilemap,
            dy,
            rows: this.rows,
            cols: this.cols,
            seed: this.seed,
            // Aux data for visualization
            elev: fields.elev,
            temp: fields.temp,
            humid: fields.humid
        };
    }

    generateRivers(rows, cols, elev, humid, tilemap) {
        const rng = new Random(this.seed + 123);
        const rivers = new Uint8Array(rows * cols); // 1 = river

        // 1. Find Springs
        // High elevation (>0.6), High humidity (>0.5)
        const springs = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                if (elev[i] > 0.6 && humid[i] > 0.5) {
                    if (rng.next() < 0.01) { // 1% chance per candidate
                        springs.push({ r, c });
                    }
                }
            }
        }

        // 2. Flow
        const getNeighbors = (r, c) => {
            const deltas = (r & 1) === 0 ?
                [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]] :
                [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
            return deltas.map(([dr, dc]) => [r + dr, c + dc])
                .filter(([nr, nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols);
        };

        for (const spring of springs) {
            let curr = spring;
            let path = [];

            while (true) {
                const idx = curr.r * cols + curr.c;
                path.push(curr);

                if (tilemap[idx].includes('water')) break; // Reached existing water

                // Find lowest neighbor
                const neighbors = getNeighbors(curr.r, curr.c);
                let lowest = null;
                let minE = elev[idx];

                for (const n of neighbors) {
                    const nIdx = n[0] * cols + n[1];
                    if (elev[nIdx] < minE) {
                        minE = elev[nIdx];
                        lowest = n;
                    }
                }

                if (lowest) {
                    curr = { r: lowest[0], c: lowest[1] };
                } else {
                    // Local minima (lake or dead end)
                    break;
                }
            }

            // Mark path
            for (const p of path) {
                const i = p.r * cols + p.c;
                // Don't overwrite ocean/deep_water if we hit it
                if (!tilemap[i].includes('deep_water')) {
                    tilemap[i] = 'shallow_water';
                }
            }
        }
    }

    buildFields() {
        const rows = this.rows;
        const cols = this.cols;
        const cfg = this.cfg;
        const shape = [rows, cols];

        const noiseField = (off, scale, oct, smooth = 0) => {
            const r = new Random(cfg.seed + off);
            const raw = Noise.fbm(shape, r, scale, oct, cfg.persistence, cfg.lacunarity);
            const norm = GridUtils.normalize01(raw);
            return GridUtils.smoothBox(norm, rows, cols, smooth);
        };

        const cont = noiseField(10, cfg.continental_scale, cfg.continental_octaves, cfg.continental_smooth_passes);
        // Clip cont
        for (let i = 0; i < cont.length; i++) cont[i] = Math.max(0, Math.min(1.0, (cont[i] - 0.22) / 0.78));

        const r20 = new Random(cfg.seed + 20);
        const peaksRaw = Noise.fbm(shape, r20, cfg.peaks_scale, cfg.peaks_octaves, cfg.persistence, cfg.lacunarity);
        const peaks = GridUtils.ridged01(GridUtils.normalize01(peaksRaw));

        const erosion = noiseField(30, cfg.erosion_scale, cfg.erosion_octaves, 0);

        // Ridge aniso logic skipped for brevity/complexity, using standard noise as placeholder or simple ridge
        const ridgeRaw = Noise.fbm(shape, new Random(cfg.seed + 25), cfg.ridge_scale_long, cfg.ridge_octaves, cfg.persistence, cfg.lacunarity);
        const ridges = GridUtils.smoothBox(GridUtils.ridged01(GridUtils.normalize01(ridgeRaw)), rows, cols, 1);

        const humid0 = noiseField(40, cfg.humid_scale, cfg.humid_octaves, 0);
        const temp0 = noiseField(50, cfg.temp_scale, cfg.temp_octaves, 0);

        const warpSx = noiseField(71, cfg.warp_scale, cfg.warp_octaves, 0);
        const warpSy = noiseField(72, cfg.warp_scale, cfg.warp_octaves, 0);

        const wx = new Int32Array(rows * cols);
        const wy = new Int32Array(rows * cols);
        for (let i = 0; i < warpSx.length; i++) {
            wx[i] = (warpSx[i] - 0.5) * 2.0 * cfg.warp_amp;
            wy[i] = (warpSy[i] - 0.5) * 2.0 * cfg.warp_amp;
        }

        const humid = GridUtils.warpInt(humid0, rows, cols, wx, wy);
        const tempNoise = GridUtils.warpInt(temp0, rows, cols, wx.map(x => -x), wy);

        const elev = new Float32Array(rows * cols);
        for (let i = 0; i < elev.length; i++) {
            const p2 = peaks[i] * (1.0 - cfg.erosion_strength * erosion[i]);
            const val = cont[i] + cfg.peaks_strength * p2 + cfg.ridge_strength * ridges[i];
            elev[i] = val; // will normalize
        }
        const elevNorm = GridUtils.normalize01(elev);

        const temp = new Float32Array(rows * cols);
        for (let r = 0; r < rows; r++) {
            const lat = r / rows;
            const equator = 1.0 - Math.abs(lat * 2.0 - 1.0);
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                let t = 0.70 * equator + 0.30 * tempNoise[idx];
                t = t - 0.38 * Math.max(0.0, Math.min(1.0, elevNorm[idx] - cfg.sea_level));
                // Apply User Offset
                if (cfg.temp_offset) t += cfg.temp_offset;
                temp[idx] = t;
            }
        }
        const tempNorm = GridUtils.normalize01(temp);

        const land = new Uint8Array(rows * cols);
        for (let i = 0; i < land.length; i++) land[i] = elevNorm[i] >= cfg.sea_level ? 1 : 0;

        const distToWater = this.hexBfsDistance(land.map(v => !v)); // 1 if !land

        // Humid2
        const humid2 = new Float32Array(humid.length);
        for (let i = 0; i < humid.length; i++) {
            const h = humid[i];
            const infl = Math.exp(-distToWater[i] / 3.2);
            let val = 0.70 * h + 0.30 * infl;
            if (cfg.humid_offset) val += cfg.humid_offset;
            humid2[i] = val;
        }
        const humidNorm = GridUtils.normalize01(humid2);

        return { elev: elevNorm, peaks, ridges, humid: humidNorm, temp: tempNorm, land, distToWater, peaks };
    }

    buildMountains(fields) {
        // Simplified mountain logic
        // Only using elevation and peaks threshold
        const mtn = new Uint8Array(this.rows * this.cols);
        const { cfg } = this;
        for (let i = 0; i < mtn.length; i++) {
            if (fields.land[i]) {
                if (fields.elev[i] >= cfg.mountain_level && fields.peaks[i] >= cfg.peak_mountain_thresh) {
                    mtn[i] = 1;
                }
            }
        }
        return mtn;
    }

    addLakes(elev, land, distToWater, distToMtn) {
        // Simplified lakes
        // Just use random spots inland
        const lakes = new Uint8Array(land.length);
        const water0 = new Uint8Array(land.length);
        const ocean = new Uint8Array(land.length);

        for (let i = 0; i < land.length; i++) {
            // Fill water0
            if (!land[i]) water0[i] = 1;
            else if (distToWater[i] > 10 && Math.random() < 0.001) { // Very crude lake logic
                lakes[i] = 1;
                water0[i] = 1;
            }
        }

        // Ocean is water connected to border.
        // We can run bfs from 0,0 assuming it's water (usually is)
        // or just strict definitions

        return { water0, ocean, lakes };
    }

    carveRivers(elev, land, distToWater, peaks, ridges, distToMtn) {
        // Placeholder rivers
        return new Uint8Array(land.length); // No rivers for MVP to save space
    }

    pruneRivers(river, water) {
        return river;
    }

    // BFS distance for hexagonal grid
    hexBfsDistance(sourceMask) { // sourceMask[i] is truthy if it is a source (dist=0)
        const rows = this.rows;
        const cols = this.cols;
        const dist = new Int32Array(rows * cols).fill(1000000);
        const q = [];

        // Init sources
        for (let i = 0; i < sourceMask.length; i++) {
            if (sourceMask[i]) {
                dist[i] = 0;
                q.push(i);
            }
        }

        let head = 0;
        while (head < q.length) {
            const u = q[head++];
            const d = dist[u];
            const r = Math.floor(u / cols);
            const c = u % cols;

            // Hex neighbors
            // if (r & 1) == 0:
            //     deltas = [(0, -1), (0, 1), (-1, -1), (-1, 0), (1, -1), (1, 0)]
            // else:
            //     deltas = [(0, -1), (0, 1), (-1, 0), (-1, 1), (1, 0), (1, 1)]

            const deltas = (r & 1) === 0 ?
                [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]] :
                [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];

            for (let [dr, dc] of deltas) {
                const rr = r + dr;
                const cc = c + dc;
                if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
                    const v = rr * cols + cc;
                    if (dist[v] > d + 1) {
                        dist[v] = d + 1;
                        q.push(v);
                    }
                }
            }
        }
        return dist;
    }
}
