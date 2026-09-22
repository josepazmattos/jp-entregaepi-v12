import serverless from 'serverless-http';
import app from './app.js';

export const handler = serverless(app, {
  request: (req, event) => {
    req.awsEvent = event;
  }
});
