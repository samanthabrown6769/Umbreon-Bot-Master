const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

const MAX_BODY_BYTES = 16 * 1024;

function isValidAuthorization(header, expected) {
  if (typeof header !== 'string') return false;
  const received = Buffer.from(header);
  const secret = Buffer.from(expected);
  return received.length === secret.length && timingSafeEqual(received, secret);
}

function createTopggWebhookServer({ authorization, onVote }) {
  if (typeof authorization !== 'string' || authorization.length === 0) {
    throw new TypeError('Top.gg webhook authorization must be a non-empty string.');
  }
  if (typeof onVote !== 'function') {
    throw new TypeError('onVote must be a function.');
  }

  return http.createServer((request, response) => {
    const requestPath = new URL(request.url || '/', 'http://localhost').pathname;
    if (requestPath !== '/topgg') {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    if (!isValidAuthorization(request.headers.authorization, authorization)) {
      response.writeHead(401).end();
      return;
    }

    const chunks = [];
    let bodyBytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', async () => {
      if (response.writableEnded) return;
      if (tooLarge) {
        response.writeHead(413).end('Payload too large');
        return;
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        response.writeHead(400).end('Invalid JSON');
        return;
      }
      if (payload?.type === 'test') {
        response.writeHead(200).end('Webhook test received');
        return;
      }
      if (payload?.type !== 'upvote' || !/^\d{17,20}$/.test(payload.user || '')) {
        response.writeHead(400).end('Invalid Top.gg vote payload');
        return;
      }
      try {
        await onVote(payload.user, payload);
        response.writeHead(200).end('Vote received');
      } catch (error) {
        console.error('[vote-webhook] Failed to process Top.gg vote:', error);
        response.writeHead(500).end('Vote processing failed');
      }
    });
  });
}

module.exports = { createTopggWebhookServer };
