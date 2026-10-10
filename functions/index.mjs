import { beforeUserCreated as registerBeforeUserCreated } from 'firebase-functions/v2/identity';
import { HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { decideBetaAccess } from './access.mjs';

const betaAllowedEmails = defineSecret('BETA_ALLOWED_EMAILS');
const betaAccessMode = defineString('BETA_ACCESS_MODE', { default: 'invite-only' });

export const beforeUserCreated = registerBeforeUserCreated(
  { secrets: [betaAllowedEmails] },
  (event) => {
    const decision = decideBetaAccess({
      email: event.data?.email,
      mode: betaAccessMode.value(),
      allowlist: betaAllowedEmails.value(),
    });
    if (decision.allowed) return;

    throw new HttpsError('permission-denied', 'MarketMind is currently invite-only. Contact the beta administrator for access.');
  },
);
