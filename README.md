## Santa 2025 Solution Editor App

This is a simple web app for editing solutions for the
[Santa 2025 - Christmas Tree Packing Challenge](https://www.kaggle.com/competitions/santa-2025/overview) Kaggle competition.

> [!NOTE]
> Report any issues or feature requests in the [Issues](https://github.com/habedi/santa-2025-solution-editor/issues) section.


### Getting Started

To use the App, visit [this URL](https://habedi.github.io/santa-2025-solution-editor/index.html) in your browser.

#### Run the App Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/habedi/santa-2025-solution-editor.git
   ```

2. Start the local HTTP server:

   ```bash
   bash scripts/start_server.sh
   ```

and open [http://localhost:8085/app/solution_editor.html](http://localhost:8085/app/solution_editor.html) in your browser.

#### Helper Scripts

You can use the Python scripts in the [scripts](scripts) directory to:

- `validate_submission.py`: Check an edited solution is valid (like there are no collisions between trees).
- `visualize_submission.py`: Visualize tree configurations in a solution.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to make a contribution.

### License

This project is licensed under the MIT License ([LICENSE](LICENSE)).
