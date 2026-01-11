
import json
import os
import re

TILE_DIR = "app/tiles/hex_1"
OUTPUT_FILE = "app/tiles/tiles.json"

def main():
    if not os.path.exists(TILE_DIR):
        print(f"Directory {TILE_DIR} not found.")
        return

    tiles = {}
    # Pattern: type_variant_tile.png
    # e.g. clay_0_tile.png -> type=clay, variant=0
    
    # Actually, let's just list the files. The JS side can parse them or we can structure them now.
    # Structuring them now is better for the JS loader.
    
    pattern = re.compile(r"^([a-z_]+)_(\d+)_tile\.(png|webp|bmp)$", re.IGNORECASE)
    
    file_list = []
    
    for f in sorted(os.listdir(TILE_DIR)):
        if pattern.match(f):
            file_list.append(f)
            
    with open(OUTPUT_FILE, "w") as f:
        json.dump(file_list, f, indent=2)
        
    print(f"Wrote {len(file_list)} tiles to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
