import { randomUUID } from 'node:crypto';
import { httpError } from '../middleware/auth.js';
import { sha256, canonical } from './document-integrity.js';
import { signingBytes, embedCms } from './jpged-pdf.js';
import { detachedCms } from './jpged-cms.js';

export const COMPACT_LAYOUT = 'compact-1';
const fail = (message, code) => { throw httpError(409, message, code); };

// A presentation revision is a NEW signed original. Never rewrite DOC, its
// immutable PDF, the ficha, the biometric proof, or the original signing date.
export function createLayoutService({ ged, store, certificate, confirmedContent, buildPdf, validate, vault, audit }) {
  async function revision(company, document) {
    const item = await ged.get(company, 'LAYOUT', document.id);
    if (item && (item.sourcePdfHash !== document.pdfHash || item.documentHash !== document.documentHash || item.layoutVersion !== COMPACT_LAYOUT)) {
      fail('A versão de impressão não corresponde ao original preservado.', 'JPGED_INTEGRIDADE');
    }
    return item;
  }
  function summary(item) {
    return item ? { layoutVersion: item.layoutVersion, certifiedAt: item.certifiedAt, pdfHash: item.pdfHash } : null;
  }
  async function source(company, document) {
    const ficha = await store.get('ficha', document.fichaId);
    if (!ficha || ficha.empresaId !== company || ficha.certificacao?.documentId !== document.id ||
        confirmedContent(ficha) !== document.documentHash || ficha.assinaturaBiometrica.id !== document.biometricId ||
        ficha.trabalhadorId !== document.trabalhadorId || ficha.canceladaEm || ficha.excluidaEm) {
      fail('A ficha não corresponde ao original confirmado. A impressão anterior foi preservada.', 'JPGED_DOCUMENTO_ALTERADO');
    }
    return ficha;
  }
  async function reissue(company, actor, id) {
    const document = await ged.get(company, 'DOC', id);
    if (!document) throw httpError(404, 'Documento não encontrado.', 'JPGED_DOCUMENTO');
    const existing = await revision(company, document);
    if (existing || document.layoutVersion === COMPACT_LAYOUT) return { completed: true, documentId: id, alreadyCurrent: true, revision: summary(existing) };
    const ficha = await source(company, document);
    if (sha256(await ged.readBlob(document.path)) !== document.pdfHash) fail('O original preservado perdeu a integridade.', 'JPGED_INTEGRIDADE');
    const cert = await certificate(company);
    if (!cert || cert.mode !== 'vault') fail('Solicite ao Master o cadastro do certificado no cofre. O PDF anterior continua disponível.', 'COFRE_NAO_CONFIGURADO');
    if (!(Date.parse(cert.validTo) > Date.now()) || (cert.validFrom && Date.parse(cert.validFrom) > Date.now())) fail('Atualize a validade do certificado no cofre. O PDF anterior continua disponível.', 'CERTIFICADO_VENCIDO');
    const built = await buildPdf(ficha, cert), content = signingBytes(built.pdf, built.start, built.end);
    const signer = detachedCms(content, cert.chain), cms = signer.complete(await vault.sign(cert.keyArn, signer.signedBytes));
    const checked = await validate(cms, content, cert.target || cert.cnpj);
    if (checked.certificate.fingerprint !== cert.fingerprint) fail('O certificado foi alterado. Tente novamente.', 'CERTIFICADO_ALTERADO');
    const currentCert = await certificate(company);
    if (!currentCert || currentCert.version !== cert.version || currentCert.fingerprint !== cert.fingerprint) fail('O certificado foi alterado. Tente novamente.', 'CERTIFICADO_ALTERADO');
    const current = await source(company, document);
    if (JSON.stringify(canonical(current.assinaturaBiometrica)) !== JSON.stringify(canonical(ficha.assinaturaBiometrica))) fail('A confirmação biométrica foi alterada.', 'JPGED_DOCUMENTO_ALTERADO');
    const final = embedCms(built.pdf, built.start, built.end, cms), pdfHash = sha256(final), operationId = randomUUID();
    const path = `documents/${company}/${id}/layout/${operationId}/${pdfHash}.pdf`;
    const evidencePath = `evidence/${company}/${id}/layout/${operationId}/${pdfHash}.json`;
    await ged.saveBlob(path, final);
    const crls = await Promise.all((checked.evidence.crls || []).map(async ({der, ...metadata}) => {
      const path = `validation/crls/${metadata.sha256}.crl`;
      await ged.saveBlob(path, Buffer.from(der, 'base64'), 'application/pkix-crl');
      return {...metadata, path};
    }));
    await ged.saveBlob(evidencePath, Buffer.from(JSON.stringify({
      schema: 'JPGED-LAYOUT-1', layoutVersion: COMPACT_LAYOUT, documentId: id,
      sourcePdfHash: document.pdfHash, sourceCertifiedAt: document.certifiedAt,
      documentHash: document.documentHash, biometricId: document.biometricId,
      biometricAt: document.biometricAt, pdfHash, cmsSha256: sha256(cms),
      certificate: checked.certificate, authorizationPath: cert.authorizationPath,
      validation: {...checked.evidence, crls}, actor,
    })), 'application/json');
    let saved;
    try {
      saved = await ged.put(company, 'LAYOUT', id, {
        layoutVersion: COMPACT_LAYOUT, sourcePdfHash: document.pdfHash, documentHash: document.documentHash,
        biometricId: document.biometricId, path, evidencePath, pdfHash, sizeBytes: final.length,
        certifiedAt: checked.evidence.checkedAt, certificate: checked.certificate, actor,
      });
    } catch (error) {
      if (error.code !== 'JPGED_CONFLICT') throw error;
      // Concurrent sessions converge on one published revision, without ever
      // overwriting either original. Unreferenced immutable attempts are private.
      saved = await revision(company, document);
      if (!saved) throw error;
    }
    await audit(company, actor, 'DOCUMENTO_LAYOUT_ATUALIZADO', {documentId: id, sourcePdfHash: document.pdfHash, pdfHash: saved.pdfHash, layoutVersion: COMPACT_LAYOUT});
    return { completed: true, documentId: id, revision: summary(saved) };
  }
  return { revision, summary, reissue };
}
