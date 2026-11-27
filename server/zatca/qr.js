import { DOMParser } from '@xmldom/xmldom';

const UBL_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const UBL_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const UBL_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

function textBytes(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required`);
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 255) throw new RangeError(`${name} exceeds the QR TLV limit`);
  return bytes;
}

function binaryBytes(value, name) {
  if (!Buffer.isBuffer(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${name} must be binary`);
  const bytes = Buffer.from(value.buffer || value, value.byteOffset || 0, value.byteLength || value.length);
  if (!bytes.length || bytes.length > 255) throw new RangeError(`${name} has an invalid QR TLV length`);
  return bytes;
}

export function extractZatcaQr(xml) {
  const document = new DOMParser({
    onError(_level, message) {
      throw new Error(`XML غير صالح لاستخراج QR: ${message}`);
    },
  }).parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (root?.localName !== 'Invoice' || root.namespaceURI !== UBL_INVOICE) {
    throw new Error('مستند QR ليس فاتورة UBL');
  }
  const references = [...document.getElementsByTagNameNS(UBL_CAC, 'AdditionalDocumentReference')]
    .filter(reference => [...reference.childNodes].some(node =>
      node.nodeType === 1 && node.namespaceURI === UBL_CBC && node.localName === 'ID' && node.textContent.trim() === 'QR'));
  if (references.length !== 1) throw new Error('يجب أن يحتوي XML النهائي على مرجع QR واحد فقط');
  const values = [...references[0].getElementsByTagNameNS(UBL_CBC, 'EmbeddedDocumentBinaryObject')];
  if (values.length !== 1) throw new Error('مرجع QR لا يحتوي قيمة واحدة');
  const qr = values[0].textContent.trim();
  if (!qr || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(qr) ||
      Buffer.from(qr, 'base64').toString('base64') !== qr) {
    throw new Error('قيمة QR النهائية ليست Base64 صالحة');
  }
  return qr;
}

export function buildZatcaQr({
  sellerName,
  vatNumber,
  timestamp,
  total,
  vat,
  invoiceHash,
  signatureValue,
  publicKey,
  certificateSignature,
}) {
  const values = [
    textBytes(sellerName, 'Seller name'),
    textBytes(vatNumber, 'VAT number'),
    textBytes(timestamp, 'Invoice timestamp'),
    textBytes(total, 'Invoice total'),
    textBytes(vat, 'VAT total'),
    textBytes(invoiceHash, 'Invoice hash'),
    textBytes(signatureValue, 'Invoice signature'),
    binaryBytes(publicKey, 'Public key'),
    binaryBytes(certificateSignature, 'Certificate signature'),
  ];
  return Buffer.concat(values.flatMap((value, index) => [
    Buffer.from([index + 1, value.length]),
    value,
  ])).toString('base64');
}
