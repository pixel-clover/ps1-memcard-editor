# WebMemCard - PS1 Save Manager

WebMemCard is a lightweight, web-based tool for managing PlayStation 1 (PS1) memory card files. It runs entirely in your browser or can be hosted locally.

## Features

- **Format Support**: Supports standard `.mcr`, `.bin`, and `.srm` (RetroArch) memory card files.
- **Save Management**:
    - View all 15 memory card slots.
    - Correctly decodes **Shift-JIS** game titles.
    - Renders save **Icons** (pixel art) directly from the save data.
    - **Delete** unwanted saves to free up slots.
- **Export**: Download your modified memory card file.

## Getting Started

### Run the App Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/habedi/web-mem-card.git
   ```

2. Start the local HTTP server:

   ```bash
   bash scripts/start_server.sh
   ```

3. Open [http://localhost:8085/](http://localhost:8085/) in your browser.

## Tech Stack

- **HTML5/CSS3**: Clean, dark-mode UI.
- **Vanilla JavaScript**: No heavy frameworks. Handles binary file parsing (Uint8Array) directly in the browser.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to make a contribution.

### License

This project is licensed under the MIT License ([LICENSE](LICENSE)).
