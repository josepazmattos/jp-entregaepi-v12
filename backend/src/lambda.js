import serverless from 'serverless-http';
import app from './app.js';
import { gatewayClaimsKey } from './middleware/auth.js';

export const handler = serverless(app, {
  request(request, event) {
    // Only the Lambda invocation context populated by API Gateway supplies identity.
    // Browser headers/body cannot populate this symbol.
    request[gatewayClaimsKey] = event?.requestContext?.authorizer?.jwt?.claims || null;
  }
});
