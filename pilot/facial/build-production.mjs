import {build} from 'esbuild';
import {resolve} from 'node:path';
await build({entryPoints:['backend/production-provider.mjs'],bundle:true,minify:true,outfile:'../../backend/src/services/facial-provider.runtime.mjs',platform:'node',target:'node22',format:'esm',alias:{'@aws-sdk/client-kms':resolve('../../backend/node_modules/@aws-sdk/client-kms')},banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
await build({entryPoints:['web/production-widget.jsx'],bundle:true,minify:true,outfile:'../../frontend/EntregaEPI/assets/facial-widget.js',platform:'browser',target:['safari15','chrome100'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
console.log('Built facial provider and lazy camera widget.');
