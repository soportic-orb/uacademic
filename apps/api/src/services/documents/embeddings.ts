/**
 * Embeddings, behind an interface, because the provider is a decision a center
 * gets to change without the rest of this phase noticing.
 *
 * Three implementations, in the order they are tried:
 *
 *  1. **Local ONNX** (`multilingual-e5-small`), run in the worker process.
 *     Slower than a hosted API and that is the point: no document text leaves
 *     the server, which makes the GDPR story a paragraph instead of a project.
 *     Both the runtime and the model file are optional — neither is bundled,
 *     and a host without them simply falls through.
 *  2. **A hosted provider**, for a center that would rather pay for speed.
 *     Anthropic has no embeddings API, so this speaks the OpenAI-compatible
 *     `/v1/embeddings` shape that most of them expose.
 *  3. **Hashed bag-of-words**, always available, no model, no network. It is
 *     weaker than either — it matches words, not meanings — but the search
 *     that uses it is hybrid: the full-text half carries the exact terms
 *     ("article 14", "240 hores") and this half still groups documents that
 *     share vocabulary. A center with no model configured gets a usable
 *     search rather than none, and the UI says which provider answered.
 */
import { createHash } from 'node:crypto'

import { env } from '../../config/env.js'

export interface EmbeddingProvider {
  readonly id: string
  readonly dimensions: number
  /** False when the model or the runtime is not installed on this host. */
  available(): Promise<boolean>
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

/* ─────────────────────────── serialisation ─────────────────────────── */

/** MySQL 8 has no vector type; a Float32 blob is the honest way to store one. */
export function toBlob(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(vector.byteLength)
  new Float32Array(buffer).set(vector)
  return new Uint8Array(buffer)
}

export function fromBlob(blob: Uint8Array): Float32Array {
  // Copied rather than viewed: the buffer a driver hands back is not ours to
  // keep, and an unaligned offset would make the view throw.
  const copy = new ArrayBuffer(blob.byteLength)
  new Uint8Array(copy).set(blob)
  return new Float32Array(copy)
}

export function normalize(vector: Float32Array): Float32Array {
  let norm = 0
  for (const value of vector) norm += value * value
  if (norm === 0) return vector

  const scale = 1 / Math.sqrt(norm)
  const out = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = (vector[index] as number) * scale
  }
  return out
}

/* ─────────────────────────── hashed fallback ─────────────────────────── */

const FALLBACK_DIMENSIONS = 512

/**
 * Random-projection bag of words: every token is hashed into a handful of
 * dimensions with a stable sign. No model, no network, deterministic, and
 * good enough to rank documents that share vocabulary.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'hashed-bow-512'
  readonly dimensions = FALLBACK_DIMENSIONS

  async available(): Promise<boolean> {
    return true
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.#embedOne(text))
  }

  #embedOne(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions)

    for (const token of tokenize(text)) {
      const digest = createHash('sha1').update(token).digest()
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const slot = digest.readUInt16BE(repeat * 2) % this.dimensions
        const sign = (digest[repeat + 6] as number) % 2 === 0 ? 1 : -1
        vector[slot] = (vector[slot] as number) + sign
      }
    }

    return normalize(vector)
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && token.length < 30)
}

/* ─────────────────────────── local ONNX ─────────────────────────── */

interface OnnxSession {
  run(
    feeds: Record<string, unknown>,
  ): Promise<Record<string, { data: Float32Array; dims: number[] }>>
}

/**
 * `multilingual-e5-small` through ONNX Runtime, loaded lazily so a host without
 * it starts perfectly well. The model directory is configured, never bundled:
 * it is ~120 MB and belongs next to the deployment, not in the repository.
 */
export class LocalOnnxEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'multilingual-e5-small'
  readonly dimensions = 384

  #session: OnnxSession | null = null
  #tokenizer: { encode(text: string): { ids: number[]; attentionMask: number[] } } | null = null
  #checked = false

  async available(): Promise<boolean> {
    if (this.#checked) return this.#session !== null
    this.#checked = true

    const modelPath = env().EMBEDDING_MODEL_PATH
    if (!modelPath) return false

    try {
      // Imported by name at run time so TypeScript never needs the package
      // to be installed: it is an operator's choice, not a dependency.
      const load = new Function('name', 'return import(name)') as (name: string) => Promise<unknown>

      const runtime = (await load('onnxruntime-node')) as {
        InferenceSession: { create(path: string): Promise<OnnxSession> }
      }
      this.#session = await runtime.InferenceSession.create(`${modelPath}/model.onnx`)

      const tokenizers = (await load('@huggingface/transformers')) as {
        AutoTokenizer: { from_pretrained(path: string): Promise<never> }
      }
      this.#tokenizer = (await tokenizers.AutoTokenizer.from_pretrained(modelPath)) as never

      return true
    } catch {
      // Neither the runtime nor the model is a dependency of this product:
      // not having them is a configuration, not a failure.
      this.#session = null
      return false
    }
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (!(await this.available()) || !this.#session || !this.#tokenizer) {
      throw new Error('The local embedding model is not installed on this host')
    }

    const out: Float32Array[] = []

    for (const text of texts) {
      // e5 expects the prefix; without it the vectors are noticeably worse.
      const encoded = this.#tokenizer.encode(`passage: ${text}`)
      const result = await this.#session.run({
        input_ids: encoded.ids,
        attention_mask: encoded.attentionMask,
      })

      const tensor = Object.values(result)[0]
      if (!tensor) throw new Error('The embedding model returned nothing')

      out.push(normalize(meanPool(tensor.data, tensor.dims)))
    }

    return out
  }
}

/** Mean pooling over the token dimension, which is what e5 was trained with. */
function meanPool(data: Float32Array, dims: number[]): Float32Array {
  const [, tokens = 1, hidden = data.length] = dims
  const pooled = new Float32Array(hidden)

  for (let token = 0; token < tokens; token += 1) {
    for (let index = 0; index < hidden; index += 1) {
      pooled[index] = (pooled[index] as number) + (data[token * hidden + index] as number)
    }
  }

  for (let index = 0; index < hidden; index += 1) {
    pooled[index] = (pooled[index] as number) / tokens
  }

  return pooled
}

/* ─────────────────────────── hosted ─────────────────────────── */

/** An OpenAI-compatible `/v1/embeddings` endpoint, for whoever wants one. */
export class HostedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string
  readonly dimensions: number
  readonly #url: string
  readonly #key: string
  readonly #fetch: typeof fetch

  constructor(input: {
    url: string
    apiKey: string
    model: string
    dimensions: number
    fetchImpl?: typeof fetch
  }) {
    this.id = input.model
    this.dimensions = input.dimensions
    this.#url = input.url
    this.#key = input.apiKey
    this.#fetch = input.fetchImpl ?? fetch
  }

  async available(): Promise<boolean> {
    return Boolean(this.#url && this.#key)
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const response = await this.#fetch(this.#url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#key}`,
      },
      body: JSON.stringify({ model: this.id, input: texts, dimensions: this.dimensions }),
    })

    if (!response.ok) {
      throw new Error(`Embedding provider answered ${response.status}`)
    }

    const payload = (await response.json()) as { data: { embedding: number[] }[] }
    return payload.data.map((entry) => normalize(Float32Array.from(entry.embedding)))
  }
}

/* ─────────────────────────── selection ─────────────────────────── */

let cached: EmbeddingProvider | undefined
let override: EmbeddingProvider | undefined

/** Test seam. */
export function setEmbeddingProvider(provider: EmbeddingProvider | undefined): void {
  override = provider
  cached = undefined
}

export async function embeddingProvider(): Promise<EmbeddingProvider> {
  if (override) return override
  if (cached) return cached

  const configuration = env()

  if (configuration.EMBEDDING_API_URL && configuration.EMBEDDING_API_KEY) {
    cached = new HostedEmbeddingProvider({
      url: configuration.EMBEDDING_API_URL,
      apiKey: configuration.EMBEDDING_API_KEY,
      model: configuration.EMBEDDING_MODEL,
      dimensions: configuration.EMBEDDING_DIMENSIONS,
    })
    return cached
  }

  const local = new LocalOnnxEmbeddingProvider()
  cached = (await local.available()) ? local : new HashingEmbeddingProvider()
  return cached
}
