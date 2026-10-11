import { Router } from 'express';
import { list, listForDisplay, get, listWithRevision, transact } from '../db/store.js';
import { ok, empresaIdFrom, objectBody, recentListIds } from './_helpers.js';
import { consultarCA, normalizarCA } from '../services/caepi.service.js';
import { normalizeEquipment, listEquipmentCatalog, publicEquipment, equipmentKey, findEquipment, findRegisteredCA } from '../services/epis.service.js';
import { reportCatalog } from '../services/epi-report.js';
import { httpError } from '../middleware/auth.js';

const router = Router();
const scope = 'catalogo:epis';
const conflicts = new Set(['REGISTRO_ALTERADO', 'ESCOPO_ALTERADO', 'CONCORRENCIA_CONFLITO', 'TRANSACAO_CONFLITO']);
const duplicate=(res,item)=>ok(res,{item,reutilizado:true,code:'EPI_JA_CADASTRADO',message:'EPI já cadastrado'});
const registered=(records,ca)=>{const existing=findRegisteredCA(records,ca);return existing?publicEquipment(existing):reportCatalog.byCA(ca);};

router.get('/', async (req, res) => {
  empresaIdFrom(req); // Validate a supplied company context, even though only technical catalog fields are shared.
  const records=await listForDisplay('epi',null,recentListIds(req));
  ok(res, { items: listEquipmentCatalog(records), compartilhado: true, catalogo:reportCatalog.summary(records) });
});
router.get('/catalogo',async(req,res)=>{empresaIdFrom(req);res.set('Cache-Control','private, no-store');ok(res,reportCatalog.search(await listForDisplay('epi',null,recentListIds(req)),req.query));});
router.get('/catalogo/:id',async(req,res)=>{empresaIdFrom(req);res.set('Cache-Control','private, no-store');const existing=await get('epi',req.params.id);const item=existing?publicEquipment(existing):reportCatalog.get(req.params.id,{allowAmbiguous:true});if(!item)throw httpError(404,'Equipamento não encontrado.','EPI_NAO_ENCONTRADO');ok(res,{item});});
router.get('/cadastrado/:ca',async(req,res)=>{empresaIdFrom(req);const ca=normalizarCA(req.params.ca);if(!ca)throw httpError(400,'Informe um CA válido.','CA_INVALIDO');const item=registered(await listForDisplay('epi',null,recentListIds(req)),ca);ok(res,{item,cadastrado:Boolean(item),message:item?'EPI já cadastrado':''});});
router.get('/ca/:ca', async (req, res) => ok(res, { item: await consultarCA(req.params.ca) }));

router.post('/', async (req, res) => {
  empresaIdFrom(req);
  const body=objectBody(req);
  const ca=(!body.tipo||body.tipo==='epi_ca')&&(body.semCA==null||body.semCA===false)?normalizarCA(body.ca):'';
  if(ca){const existing=registered(await list('epi'),ca);if(existing)return duplicate(res,existing);}
  const data = normalizeEquipment(body);
  const key = equipmentKey(data);
  const id = `catalogo-${key}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await listWithRevision('epi', null, scope);
    const existing = data.ca?findRegisteredCA(snapshot.items,data.ca):findEquipment(snapshot.items, data);
    if (existing) return duplicate(res,publicEquipment(existing));
    try {
      await transact({ scope, expectedRevision: snapshot.revision, mutationId: `cadastro:${key}`, operations: [
        { type: 'create', entity: 'epi', id, data: { ...data, criadoPor: req.auth.sub } }
      ], result: { id } });
      return ok(res, { item: publicEquipment(await get('epi', id)), reutilizado: false });
    } catch (error) {
      if (error.code === 'IDEMPOTENCIA_DIVERGENTE') {
        // Two different companies may contribute this technical key concurrently.
        // Reuse only the matching catalog item; never overwrite it or suppress an unrelated conflict.
        const records=await list('epi');
        const concurrent = data.ca?findRegisteredCA(records,data.ca):findEquipment(records, data);
        if (concurrent) return duplicate(res,publicEquipment(concurrent));
      }
      if (!conflicts.has(error.code) || attempt === 3) throw error;
    }
  }
});

export default router;
