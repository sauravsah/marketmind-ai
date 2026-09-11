import { handleVercelRequest } from '../../server/vercel-adapter.mjs';

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

export default handleVercelRequest;
