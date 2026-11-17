import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

/**
 * Built web app (apps/web/dist) served from the app container (tech §3: one origin for SPA, API and
 * SSE). Every file is read into memory once at startup and served by exact path lookup, so a
 * request can only ever return one of those files: there is no filesystem access per request and
 * no path traversal by construction. Symlinks and other non-regular files are skipped.
 */
export type SpaAssets = ReadonlyMap<string, SpaAsset>;

export interface SpaAsset {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

// Vite puts content-hashed bundles under /assets/: safe to cache forever. Everything else (index.html
// in particular) must be revalidated so a deploy is picked up.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function walk(dir: string, root: string, out: Map<string, SpaAsset>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else if (entry.isFile()) {
      const urlPath = `/${relative(root, full).split(sep).join('/')}`;
      out.set(urlPath, {
        body: readFileSync(full),
        contentType: CONTENT_TYPES[extensionOf(urlPath)] ?? 'application/octet-stream',
        cacheControl: urlPath.startsWith('/assets/') ? IMMUTABLE : REVALIDATE,
      });
    }
  }
}

/** Loads the built SPA. Throws (startup fails) if the directory has no `index.html`. */
export function loadSpaAssets(dir: string): SpaAssets {
  const assets = new Map<string, SpaAsset>();
  walk(dir, dir, assets);
  if (!assets.has('/index.html')) throw new Error('WEB_DIST_DIR has no index.html');
  return assets;
}

/**
 * GET/HEAD for every path that no API route claims. `/api/*` never falls back to the SPA: it keeps
 * the deny-by-default answer (401 without a session, 404 with one). Other paths return the exact
 * file, or `index.html` for client-side routes (paths whose last segment has no extension).
 * The route is public because the login screen itself is part of the SPA; it serves no household data.
 */
export function registerSpaRoutes(app: FastifyInstance, assets: SpaAssets): void {
  const index = assets.get('/index.html');
  app.get('/*', { config: { public: true } }, async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    let decoded: string;
    try {
      decoded = decodeURIComponent(path).toLowerCase();
    } catch {
      throw new AppError('not_found', 'not found');
    }
    // Decoded and case-folded so `/%61pi/..` and `/API/..` get the API answer, not the SPA shell.
    if (decoded === '/api' || decoded.startsWith('/api/')) {
      if (request.actor === null) throw new AppError('unauthenticated', 'authentication required');
      throw new AppError('not_found', 'not found');
    }
    const asset = assets.get(path) ?? (extensionOf(path) === '' ? index : undefined);
    if (asset === undefined) throw new AppError('not_found', 'not found');
    return reply
      .header('content-type', asset.contentType)
      .header('cache-control', asset.cacheControl)
      .send(asset.body);
  });
}
