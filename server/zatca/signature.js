import { createHash, createPublicKey, sign as signBytes } from 'node:crypto';
import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import * as asn1js from 'asn1js';
import * as xadesjs from 'xadesjs';
import {
  Application,
  CryptoConfig,
  XmlDsigC14NTransform,
  setNodeDependencies,
} from 'xmldsigjs';
import { createNodeCryptoProvider, loadEcdsaCertificate, loadEcdsaPrivateKey } from './node-crypto.js';
import { buildZatcaQr } from './qr.js';
import {
  canonicalizeZatcaSignedInfo,
  canonicalizeZatcaSignedProperties,
  canonicalizeZatcaSignedInfoDocument,
  canonicalizeZatcaSignedPropertiesDocument,
  canonicalizeZatcaXmlSubtree,
} from './c14n.js';

const C14N11 = 'http://www.w3.org/2006/12/xml-c14n11';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const SIG = 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2';
const SAC = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2';
const SBC = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2';
const UBL_SIGNATURE = 'urn:oasis:names:specification:ubl:signature:Invoice';
const UBL = {
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
};

class C14N11Transform extends XmlDsigC14NTransform {
  constructor() {
    super();
    this.Algorithm = C14N11;
  }

  GetOutput() {
    if (!this.innerXml) throw new Error('عقدة XML المطلوبة لـ C14N 1.1 مفقودة');
    const xml = normalizeXmlNamespaceDeclarations(new XMLSerializer().serializeToString(this.innerXml));
    if (this.innerXml.localName === 'SignedInfo') {
      return canonicalizeZatcaSignedInfo(xml);
    }
    return canonicalizeZatcaXmlSubtree(xml);
  }
}

let initialized = false;

function initializeXmlSignature() {
  if (initialized) return;
  setNodeDependencies({ DOMParser, XMLSerializer, DOMImplementation, xpath });
  CryptoConfig.RegisterTransform(C14N11, C14N11Transform);
  Application.setEngine('Almuhtariz Node OpenSSL ECDSA', createNodeCryptoProvider());
  initialized = true;
}

function requireMatchingKeys(privateKey, certificate) {
  const certKey = certificate.publicKey.export({ format: 'der', type: 'spki' });
  const privatePublicKey = createPublicKey(privateKey.nodeKey).export({ format: 'der', type: 'spki' });
  if (!certKey.equals(privatePublicKey)) throw new Error('مفتاح التوقيع لا يطابق الشهادة');
}

function zatcaIssuerName(certificate) {
  const parts = certificate.issuer.split(/\r?\n/).reverse().filter(Boolean);
  if (!parts.length) throw new Error('تعذر قراءة الجهة المصدرة للشهادة');
  return parts.join(', ');
}

function normalizeXmlNamespaceDeclarations(xml) {
  return xml.replace(/<[^>]+>/g, startTag => {
    const declarations = [...startTag.matchAll(/(\s+xmlns(?::[^= \t\r\n]+)?="[^"]*")/g)];
    if (declarations.length < 2) return startTag;
    const seen = new Set();
    let normalized = startTag;
    for (const declaration of declarations.reverse()) {
      const name = declaration[1].match(/xmlns(?::[^=]+)?/)?.[0];
      if (!name) continue;
      if (seen.has(name)) normalized = normalized.replace(declaration[1], '');
      else seen.add(name);
    }
    return normalized;
  });
}

function riyadhDateValue(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ));
}

class ZatcaSignedXml extends xadesjs.SignedXml {
  constructor(certificate) {
    super();
    this.certificate = certificate;
  }

  async ApplySignOptions(signature, algorithm, key, options) {
    await super.ApplySignOptions(signature, algorithm, key, options);
    const signingProperties = this.Properties.SignedProperties.SignedSignatureProperties;
    const certificateDigest = createHash('sha256').update(this.certificate.raw).digest();
    signingProperties.SigningCertificate.ForEach(item => {
      item.CertDigest.DigestValue = new Uint8Array(certificateDigest);
      item.IssuerSerial.X509IssuerName = zatcaIssuerName(this.certificate);
    });
    signature.SignedInfo.References.ForEach(reference => {
      if (reference.Uri === '#xadesSignedProperties') {
        reference.Type = 'http://www.w3.org/2000/09/xmldsig#SignatureProperties';
      }
    });
  }

  async DigestReference(source, reference, checkHmac) {
    if (reference.Uri !== '#xadesSignedProperties') return super.DigestReference(source, reference, checkHmac);
    const signedProperties = this.Properties.SignedProperties.GetXml();
    if (!signedProperties) throw new Error('تعذر تسلسل خصائص التوقيع');
    const serialized = normalizeXmlNamespaceDeclarations(new XMLSerializer().serializeToString(signedProperties));
    const canonical = canonicalizeZatcaSignedProperties(serialized);
    return new Uint8Array(createHash('sha256').update(canonical).digest());
  }
}

function makeReferenceTransforms() {
  return [
    { name: 'xpath', selector: 'not(ancestor-or-self::ext:UBLExtensions)', namespaces: { ext: UBL.ext } },
    { name: 'xpath', selector: 'not(ancestor-or-self::cac:Signature)', namespaces: { cac: UBL.cac } },
    {
      name: 'xpath',
      selector: "not(ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
      namespaces: { cac: UBL.cac, cbc: UBL.cbc },
    },
    C14N11,
  ];
}

function certificateSignature(certificate) {
  const parsed = asn1js.fromBER(certificate.raw);
  if (parsed.offset !== certificate.raw.length) throw new Error('تعذر تحليل ترميز الشهادة');
  const fields = parsed.result.valueBlock.value;
  const signature = fields?.[2];
  if (fields?.length !== 3 || signature?.constructor?.name !== 'BitString' ||
      signature.valueBlock.unusedBits !== 0) {
    throw new Error('بنية توقيع الشهادة غير صالحة');
  }
  return Buffer.from(signature.valueBlock.valueHexView);
}

function xmlText(node, namespace, name) {
  const value = node.getElementsByTagNameNS(namespace, name).item(0)?.textContent?.trim();
  if (!value) throw new Error(`عنصر XML مطلوب: ${name}`);
  return value;
}

function qrFields(document, signatureResult) {
  const root = document.documentElement;
  const supplier = root.getElementsByTagNameNS(UBL.cac, 'AccountingSupplierParty').item(0);
  const monetaryTotal = root.getElementsByTagNameNS(UBL.cac, 'LegalMonetaryTotal').item(0);
  const taxTotal = root.getElementsByTagNameNS(UBL.cac, 'TaxTotal').item(0);
  if (!supplier || !monetaryTotal || !taxTotal) throw new Error('بيانات الفاتورة المطلوبة لـ QR غير مكتملة');
  const time = `${xmlText(root, UBL.cbc, 'IssueDate')}T${xmlText(root, UBL.cbc, 'IssueTime')}`;
  return {
    sellerName: xmlText(supplier, UBL.cbc, 'RegistrationName'),
    vatNumber: xmlText(supplier, UBL.cbc, 'CompanyID'),
    timestamp: time,
    total: xmlText(monetaryTotal, UBL.cbc, 'PayableAmount'),
    vat: xmlText(taxTotal, UBL.cbc, 'TaxAmount'),
    invoiceHash: signatureResult.invoiceHash,
    signatureValue: signatureResult.signatureValue,
    publicKey: signatureResult.publicKey,
    certificateSignature: signatureResult.certificateSignature,
  };
}

function element(document, qualifiedName, namespace, value) {
  const node = document.createElementNS(namespace, qualifiedName);
  if (value !== undefined) node.appendChild(document.createTextNode(value));
  return node;
}

function insertSignatureExtension(document, signatureXml, qr) {
  const root = document.documentElement;
  for (const reference of [...root.getElementsByTagNameNS(UBL.cac, 'AdditionalDocumentReference')]) {
    if (reference.getElementsByTagNameNS(UBL.cbc, 'ID').item(0)?.textContent?.trim() === 'QR') {
      reference.parentNode.removeChild(reference);
    }
  }

  const extension = element(document, 'ext:UBLExtensions', UBL.ext);
  const ublExtension = element(document, 'ext:UBLExtension', UBL.ext);
  const extensionContent = element(document, 'ext:ExtensionContent', UBL.ext);
  const signatures = element(document, 'sig:UBLDocumentSignatures', SIG);
  signatures.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:sig', SIG);
  signatures.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:sac', SAC);
  signatures.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:sbc', SBC);
  const information = element(document, 'sac:SignatureInformation', SAC);
  information.appendChild(element(document, 'cbc:ID', UBL.cbc, 'urn:oasis:names:specification:ubl:signature:1'));
  information.appendChild(element(document, 'sbc:ReferencedSignatureID', SBC, UBL_SIGNATURE));
  const signatureDocument = xadesjs.Parse(signatureXml);
  information.appendChild(document.importNode(signatureDocument.documentElement, true));
  signatures.appendChild(information);
  extensionContent.appendChild(signatures);
  ublExtension.appendChild(element(document, 'ext:ExtensionURI', UBL.ext, 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'));
  ublExtension.appendChild(extensionContent);
  extension.appendChild(ublExtension);
  root.insertBefore(extension, root.firstChild);

  const qrReference = element(document, 'cac:AdditionalDocumentReference', UBL.cac);
  qrReference.appendChild(element(document, 'cbc:ID', UBL.cbc, 'QR'));
  const attachment = element(document, 'cac:Attachment', UBL.cac);
  const binary = element(document, 'cbc:EmbeddedDocumentBinaryObject', UBL.cbc, qr);
  binary.setAttribute('mimeCode', 'text/plain');
  attachment.appendChild(binary);
  qrReference.appendChild(attachment);

  const supplier = root.getElementsByTagNameNS(UBL.cac, 'AccountingSupplierParty').item(0);
  if (!supplier) throw new Error('الفاتورة لا تتضمن AccountingSupplierParty');
  root.insertBefore(qrReference, supplier);
  const signature = element(document, 'cac:Signature', UBL.cac);
  signature.appendChild(element(document, 'cbc:ID', UBL.cbc, UBL_SIGNATURE));
  signature.appendChild(element(document, 'cbc:SignatureMethod', UBL.cbc, 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'));
  root.insertBefore(signature, supplier);
}

export async function createXadesSignature({ invoiceXml, privateKeyPem, certificatePem, signingTime = new Date() }) {
  if (typeof invoiceXml !== 'string' || !invoiceXml.trim()) throw new TypeError('XML الفاتورة مطلوب');
  if (!(signingTime instanceof Date) || !Number.isFinite(signingTime.getTime())) throw new TypeError('وقت التوقيع غير صالح');

  const privateKey = loadEcdsaPrivateKey(privateKeyPem);
  const certificate = loadEcdsaCertificate(certificatePem);
  requireMatchingKeys(privateKey, certificate);
  const now = new Date(signingTime);
  if (now < new Date(certificate.validFrom) || now > new Date(certificate.validTo)) {
    throw new Error('الشهادة خارج فترة صلاحيتها');
  }

  initializeXmlSignature();
  const document = xadesjs.Parse(invoiceXml);
  if (document.documentElement?.localName !== 'Invoice') throw new Error('المستند ليس فاتورة UBL');
  if (document.getElementsByTagNameNS(UBL.ext, 'UBLExtensions').length ||
      document.getElementsByTagNameNS(UBL.cac, 'Signature').length) {
    throw new Error('يجب توقيع XML مرشح غير موقع');
  }

  const signature = new ZatcaSignedXml(certificate);
  signature.XmlSignature.Id = 'signature';
  signature.Properties.Target = 'signature';
  signature.Properties.SignedProperties.Id = 'xadesSignedProperties';
  await signature.Sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    document,
    {
      x509: [certificate.raw.toString('base64')],
      signingCertificate: certificate.raw.toString('base64'),
      signingTime: { value: riyadhDateValue(now), format: "UTC:yyyy-mm-dd'T'HH:MM:ss" },
      canonicalization: C14N11,
      references: [{ uri: '', hash: 'SHA-256', transforms: makeReferenceTransforms() }],
    },
  );

  let signatureElement = signature.XmlSignature.GetXml();
  const references = signatureElement.getElementsByTagNameNS(DS, 'Reference');
  const invoiceReference = [...references].find(reference => reference.getAttribute('URI') === '');
  const invoiceDigest = invoiceReference?.getElementsByTagNameNS(DS, 'DigestValue').item(0)?.textContent;
  if (!invoiceDigest) throw new Error('تعذر استخراج بصمة مرجع الفاتورة من التوقيع');
  const invoiceDigestBytes = Buffer.from(invoiceDigest, 'base64');
  if (invoiceDigestBytes.length !== 32) throw new Error('بصمة الفاتورة غير صالحة للتوقيع');
  const signedInfo = signatureElement.getElementsByTagNameNS(DS, 'SignedInfo').item(0);
  if (!signedInfo) throw new Error('تعذر استخراج SignedInfo النهائي');
  const signedInfoXml = normalizeXmlNamespaceDeclarations(new XMLSerializer().serializeToString(signedInfo));
  const signedInfoCanonical = canonicalizeZatcaSignedInfo(signedInfoXml);
  const signedInfoSignature = signBytes('sha256', Buffer.from(signedInfoCanonical, 'utf8'), privateKey.nodeKey);
  signature.XmlSignature.SignatureValue = new Uint8Array(signedInfoSignature);
  signatureElement = signature.XmlSignature.GetXml();
  const signatureValue = signatureElement.getElementsByTagNameNS(DS, 'SignatureValue').item(0)?.textContent?.trim();
  if (!signatureValue) throw new Error('تعذر استخراج قيمة التوقيع');

  return {
    signatureXml: new XMLSerializer().serializeToString(signatureElement),
    invoiceHash: invoiceDigest,
    signatureValue,
    publicKey: certificate.publicKey.export({ format: 'der', type: 'spki' }),
    certificateSignature: certificateSignature(certificate),
    certificate,
  };
}

export async function signInvoiceXml(options) {
  const result = await createXadesSignature(options);
  const document = xadesjs.Parse(options.invoiceXml);
  let qr = buildZatcaQr(qrFields(document, result));
  insertSignatureExtension(document, result.signatureXml, qr);

  let fullXml = new XMLSerializer().serializeToString(document);
  const workingDocument = xadesjs.Parse(fullXml);
  const signedProperties = workingDocument.getElementsByTagNameNS('http://uri.etsi.org/01903/v1.3.2#', 'SignedProperties').item(0);
  const signatureElement = workingDocument.getElementsByTagNameNS(DS, 'Signature').item(0);
  if (!signedProperties || !signatureElement) throw new Error('تعذر إعادة ربط خصائص XAdES النهائية');

  const signedPropertiesCanonical = canonicalizeZatcaSignedPropertiesDocument(fullXml);
  const signedPropertiesDigest = createHash('sha256').update(signedPropertiesCanonical).digest('base64');
  const signedPropertiesReference = [...signatureElement.getElementsByTagNameNS(DS, 'Reference')]
    .find(reference => reference.getAttribute('URI') === '#xadesSignedProperties');
  const signedPropertiesDigestNode = signedPropertiesReference?.getElementsByTagNameNS(DS, 'DigestValue').item(0);
  if (!signedPropertiesDigestNode) throw new Error('تعذر استخراج مرجع SignedProperties النهائي');
  signedPropertiesDigestNode.textContent = signedPropertiesDigest;

  fullXml = new XMLSerializer().serializeToString(workingDocument);
  const signedInfoCanonical = canonicalizeZatcaSignedInfoDocument(fullXml);
  const privateKey = loadEcdsaPrivateKey(options.privateKeyPem);
  const finalSignature = signBytes('sha256', Buffer.from(signedInfoCanonical, 'utf8'), privateKey.nodeKey);
  const finalSignatureValue = Buffer.from(finalSignature).toString('base64');
  const signatureValueNode = signatureElement.getElementsByTagNameNS(DS, 'SignatureValue').item(0);
  if (!signatureValueNode) throw new Error('تعذر تحديث SignatureValue النهائي');
  signatureValueNode.textContent = finalSignatureValue;

  qr = buildZatcaQr(qrFields(workingDocument, { ...result, signatureValue: finalSignatureValue }));
  for (const reference of [...workingDocument.documentElement.getElementsByTagNameNS(UBL.cac, 'AdditionalDocumentReference')]) {
    if (reference.getElementsByTagNameNS(UBL.cbc, 'ID').item(0)?.textContent?.trim() === 'QR') {
      const qrText = reference.getElementsByTagNameNS(UBL.cbc, 'EmbeddedDocumentBinaryObject').item(0);
      if (qrText) qrText.textContent = qr;
    }
  }

  fullXml = new XMLSerializer().serializeToString(workingDocument);
  const finalDocument = xadesjs.Parse(fullXml);
  const finalSignatureElement = finalDocument.getElementsByTagNameNS(DS, 'Signature').item(0);
  const finalSignedProperties = finalDocument.getElementsByTagNameNS('http://uri.etsi.org/01903/v1.3.2#', 'SignedProperties').item(0);
  if (!finalSignatureElement || !finalSignedProperties) throw new Error('تعذر التحقق من بنية XAdES النهائية');
  return {
    xml: fullXml,
    invoiceHash: result.invoiceHash,
    qr,
  };
}
