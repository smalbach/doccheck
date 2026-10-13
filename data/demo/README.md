# Demo samples

Curated synthetic shipments for the read-only demo (`DEMO_READONLY=true`): their PDFs, `truth.json`,
`labels.json` and `manifest.json`, copied from `data/eval/v1` by `scripts/demo-build.mjs` after it
ran each one through the API with the local model, so the extraction and agent answers they need
are in `eval/cache/` and their citation query vectors in `data/corpus/index/*.queries.json`.

Rebuild after changing a prompt or the model (the cached answers would no longer match):

    npm start                          # normal mode, Ollama running
    node scripts/demo-build.mjs

The demo only lists samples whose extraction is cached, so a stale folder shows fewer samples
rather than failing.
