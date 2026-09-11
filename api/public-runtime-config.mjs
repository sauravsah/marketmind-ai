import { handleVercelRequest } from '../server/vercel-adapter.mjs';

export const config = {
  api: { bodyParser: false },
};

export default handleVercelRequest;
