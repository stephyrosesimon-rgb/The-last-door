import { getStore } from '@netlify/blobs';
import { handleGame } from '../../src/server/service.js';

// Standard filename-based endpoint: /.netlify/functions/game
// Netlify supplies Blobs credentials automatically in its Functions runtime.
export default async function game(request: Request): Promise<Response> {
  try {
    const store = getStore({ name: 'last-door-rooms-v1', consistency: 'strong' });
    return await handleGame(request, store);
  } catch {
    return Response.json({ error: 'Storage could not initialize. Deploy this complete project through signed-in Netlify Drop.' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' } });
  }
}
