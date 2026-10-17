# AI providers

DocCheck reads documents with three kinds of model, and each one can come from a different service:

| Role | Default (local) | Other providers |
| --- | --- | --- |
| Document model (extraction, agent review, classification, Data Q&A) | Ollama `qwen3.8` | Any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Together, Mistral, or self-hosted vLLM, LM Studio, llama.cpp), Azure OpenAI, Anthropic (Claude), Google Gemini |
| Embeddings (regulation citations, tariff description search) | Ollama `bge-m3` | OpenAI-compatible `/v1/embeddings`, Azure OpenAI, Gemini |
| OCR for scanned pages | Tesseract (in-process), Unlimited-OCR (Apple Silicon server) | Google Cloud Vision, Amazon Textract, Azure AI Document Intelligence |

An admin picks them in **Administration → Settings → AI providers**: provider and model for each role, keys and endpoints, a test button per service (it runs on the values in the form before saving), and the index rebuild. The cloud OCR engines are then chosen in the **OCR** tab. Changes apply without a restart, and a reset goes back to `.env`.

## Local only

**Local only** is on by default: DocCheck then refuses any service outside this machine or the private network. Loopback, RFC 1918 and link-local addresses, `*.local`, `*.internal`, `*.lan` and single-label host names (a container such as `vllm`) count as local, so a self-hosted OpenAI-compatible server stays allowed. The check runs when the configuration is saved, again when each provider is built, and before every cloud OCR call. A configuration that breaks it is refused with the reason; at start, a provider that cannot be built falls back to Ollama and logs an error.

Turning it off sends document text (model, embeddings) and page images (cloud OCR) to the chosen provider, under its terms and retention. The settings page says so in a warning.

## Keys

Keys are sealed with AES-256-GCM (`apps/api/src/messaging/secret-box.ts`, the same key as the mail passwords: `SETTINGS_KEY` or `.data/settings.key`) and stored in the `settings` table under `aiProviders`. The API never sends them back: the page only learns that a key is set, and an empty key field keeps the saved one. A test that fails returns the provider's message with any key in it replaced by `***`.

## How each provider is called

All providers return an object that is then validated against the request's Zod schema in `LlmClient` (one retry with the validation errors), so caching, tracing in `llm_calls` and the evaluation work the same with every provider. The provider id (`openai:gpt-…`, `anthropic:claude-…`) is part of the cache key, so answers of different models never mix.

- **OpenAI-compatible** (`packages/extraction/src/llm-providers.ts`): `POST {baseUrl}/chat/completions` with `response_format: json_schema`. A server that refuses it gets `json_object` with the schema in the prompt; one that refuses a temperature (some reasoning models) is asked again without it. Streaming uses server-sent events with `stream_options.include_usage`. Azure OpenAI uses the same class with `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…` and an `api-key` header.
- **Anthropic**: `POST /v1/messages` with one forced tool whose `input_schema` is the request schema; streaming reads `input_json_delta` events.
- **Gemini**: `generateContent` (or `streamGenerateContent?alt=sse`) with `responseMimeType: application/json` and `responseJsonSchema`.
- **Embeddings** (`packages/regulations/src/embedders.ts`): OpenAI `/v1/embeddings` (with `dimensions` when set) and Gemini `batchEmbedContents` (with `outputDimensionality`), 96 texts per request.
- **Cloud OCR** (`packages/extraction/src/ocr-cloud.ts`): the page is rendered at 216 dpi and sent as PNG. Google Vision `DOCUMENT_TEXT_DETECTION` (with the OCR languages as hints), Textract `DetectDocumentText` (signed with AWS Signature Version 4, no SDK), Azure Document Intelligence `prebuilt-read` (polled until done). Words come back with their boxes in PDF points, like Tesseract's, so citations and highlighting work the same.

## Embeddings and indexes

Vectors of two embedding models are never compared. Each index file is named after its embedder: `bge-m3.json` for Ollama (as before), `openai-text-embedding-3-small.json`, `gemini-gemini-embedding-001@768.json`. After a change of embedding model, findings have no regulation citations and tariff search falls back to keywords until the indexes are rebuilt: **Rebuild indexes** on the settings page (`POST /admin/ai/reindex`, in the background) or `npm run corpus:index` and `npm run tariff:index` with the same variables. Migration 052 lets the pgvector column of tariff vectors take any size.

## Environment variables

The same variables configure the API at start and the command-line tools (evaluation, indexing). A configuration saved from the settings page overrides them until it is reset.

| Variable | Meaning |
| --- | --- |
| `AI_LOCAL_ONLY` | `false` allows outside services (default on) |
| `LLM_PROVIDER` | `ollama` (default), `openai`, `azure-openai`, `anthropic`, `gemini` |
| `LLM_MODEL` | Ollama model (default `qwen3.8`); also the model of another provider when `LLM_REMOTE_MODEL` is empty |
| `LLM_REMOTE_MODEL` | Model (Azure: deployment) of a provider other than Ollama |
| `EMBED_PROVIDER`, `EMBED_MODEL`, `EMBED_DIMENSIONS` | Embeddings: `ollama` (default, `bge-m3`), `openai`, `azure-openai`, `gemini` |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | OpenAI-compatible API (default `https://api.openai.com/v1`) |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION` | Azure OpenAI |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Anthropic |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL` | Gemini |
| `OCR_ENGINE` | `tesseract`, `unlimited`, `google-vision`, `aws-textract`, `azure-di` |
| `GOOGLE_VISION_API_KEY` | Google Cloud Vision |
| `TEXTRACT_REGION`, `TEXTRACT_ACCESS_KEY_ID`, `TEXTRACT_SECRET_ACCESS_KEY` | Amazon Textract (else `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_API_KEY` | Azure AI Document Intelligence |

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/admin/ai` | Configuration (keys only as `hasKey`), what is in use, whether the indexes of the current embedder exist, the last rebuild |
| PUT | `/admin/ai` | `{ localOnly, llm: { provider, model }, embeddings: { provider, model, dimensions }, credentials: { openai, azureOpenai, anthropic, gemini, googleVision, awsTextract, azureDi } }`; a credential set to `null` is removed, an empty key keeps the saved one; refused (400) when a provider cannot run or breaks local only |
| DELETE | `/admin/ai` | Back to `.env` (refused while the OCR engine needs a key it would lose) |
| POST | `/admin/ai/test` | `{ target: llm \| embeddings \| google-vision \| aws-textract \| azure-di, config? }`: one call with a test input, `{ ok, detail }` |
| POST | `/admin/ai/reindex` | `{ scope?: all \| regulations \| tariff }`: rebuilds the indexes with the current embedding model in the background (202; 409 while one runs) |

## Tests

`packages/extraction/src/llm-providers.test.ts` checks each provider against a fake server (request shape, streaming, usage, fallbacks, errors without keys), the cloud OCR mappings and the SigV4 signature against the `post-vanilla` case of the AWS test suite. `packages/regulations/src/embedders.test.ts` and `packages/schemas/src/ai-policy.test.ts` cover the embedders and the local-only rule. `apps/api/test/ai-providers.test.mjs` runs the settings end to end against fakes: local only, sealed keys, tests, the OCR engine guard, the index rebuild and the reset.
