import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const chunk = Buffer.alloc(1024 * 1024, '0'); // 1MB chunk
app.get('/api/speedtest/download', (req, res) => {
  const sizeMb = Math.min(parseInt(req.query['mb'] as string) || 25, 200);
  const size = sizeMb * 1024 * 1024;
  res.set('Content-Type', 'application/octet-stream');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  
  let sent = 0;
  let isAborted = false;
  req.on('close', () => { isAborted = true; });

  const sendChunk = () => {
    if (isAborted) return;
    let canWrite = true;
    while (canWrite && sent < size) {
      const toSend = Math.min(chunk.length, size - sent);
      canWrite = res.write(toSend === chunk.length ? chunk : chunk.subarray(0, toSend));
      sent += toSend;
    }
    if (sent < size) {
      res.once('drain', sendChunk);
    } else {
      res.end();
    }
  };
  sendChunk();
});

app.post('/api/speedtest/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  res.json({ success: true, size: req.body?.length || 0 });
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
