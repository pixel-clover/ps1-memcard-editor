
import { MapGenerator } from './map_generator.js';

const generator = new MapGenerator();

self.onmessage = function (e) {
    const { type, config } = e.data;

    if (type === 'generate') {
        try {
            const t0 = performance.now();
            const mapData = generator.generate(config);
            const t1 = performance.now();

            // We can transfer the large arrays to avoid copying if we want to optimize further
            // But structured clone is usually fast enough for this size
            const transferables = [
                mapData.tilemap.buffer,
                mapData.dy.buffer,
                // If we add more raw layer arrays later, add their buffers here
                // mapData.elev.buffer
            ].filter(b => b); // filter nulls

            // Note: tilemap is Array of strings in previous impl? 
            // Wait, let's check map_generator.js
            // tilemap = new Array(...).fill("grass")
            // Strings cannot be transferred. 
            // Optimally we would map strings to integers (enums) for transfer, 
            // but for now let's just send the object. 
            // Cloning 60k strings might be slow but acceptable for MVP.

            self.postMessage({
                type: 'success',
                mapData: mapData,
                duration: t1 - t0
            });
        } catch (error) {
            self.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }
};
