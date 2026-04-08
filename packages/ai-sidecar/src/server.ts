import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { generateText, streamText } from 'ai'
import { createLanguageModel } from './provider'
import { buildPrompt } from './prompt'
import { normalizeStreamPart } from './runtime/normalize-parts'
import { buildCorsHeaders } from './cors'
import { buildTools } from './tools'

const port = Number(process.env.FLOW_DESK_AI_SIDECAR_PORT || '4317')

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, buildCorsHeaders())
      response.end()
      return
    }

    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/test') {
      const payload = await readJsonBody(request)
      const model = createLanguageModel(payload)
      await generateText({
        model,
        prompt: 'Reply with exactly OK.'
      })
      sendJson(response, 200, { ok: true, message: '连接成功' })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/chat/complete') {
      const payload = await readJsonBody(request)
      const model = createLanguageModel(payload)
      const result = await generateText({
        model,
        prompt: buildPrompt(payload.prompt, payload.messages)
      })
      sendJson(response, 200, {
        ok: true,
        text: result.text,
        message: result.text
      })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/agent/stream') {
      const payload = await readJsonBody(request)
      const model = createLanguageModel(payload)
      const result = streamText({
        model,
        prompt: buildPrompt(payload.prompt, payload.messages),
        tools: buildTools(payload.tools)
      })

      let sentDone = false
      let sawError = false

      for await (const part of result.fullStream) {
        const event = normalizeStreamPart(part as Record<string, unknown>)
        if (!event) continue
        if (event.kind === 'error') {
          sawError = true
          sendSse(response, event)
          break
        }
        if (event.kind === 'done') sentDone = true
        sendSse(response, event)
      }

      if (!sentDone && !sawError) {
        sendSse(response, { kind: 'done', finishReason: 'stop' })
      }

      response.end()
      return
    }

    sendJson(response, 404, { ok: false, message: 'Not Found' })
  } catch (error) {
    handleError(request, response, error)
  }
})

server.listen(port, '127.0.0.1')

/**
 * @param request - Node request.
 * @returns Parsed JSON body.
 */
async function readJsonBody(request: IncomingMessage) {
  let raw = ''

  for await (const chunk of request) {
    raw += chunk.toString()
  }

  return raw ? JSON.parse(raw) : {}
}

/**
 * @param response - Node response.
 * @param status - HTTP status.
 * @param payload - JSON payload.
 */
function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    ...buildCorsHeaders()
  })
  response.end(JSON.stringify(payload))
}

/**
 * @param response - Node response.
 * @param payload - SSE event payload.
 */
function sendSse(response: ServerResponse, payload: unknown) {
  if (!response.headersSent) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...buildCorsHeaders()
    })
  }
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/**
 * @param request - Original request.
 * @param response - Response object.
 * @param error - Unknown error.
 */
function handleError(request: IncomingMessage, response: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  if (request.url === '/v1/agent/stream') {
    sendSse(response, { kind: 'error', message })
    response.end()
    return
  }

  sendJson(response, 500, {
    ok: false,
    message
  })
}
