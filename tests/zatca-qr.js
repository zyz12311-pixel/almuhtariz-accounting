import assert from 'node:assert/strict';
import { buildZatcaQr, extractZatcaQr } from '../server/zatca/qr.js';

const qr = buildZatcaQr({
  sellerName: 'متجر اختبار',
  vatNumber: '300000000000003',
  timestamp: '2026-11-26T03:47:35',
  total: '230.00',
  vat: '30.00',
  invoiceHash: 'a'.repeat(44),
  signatureValue: 'b'.repeat(96),
  publicKey: Buffer.from([48, 1, 2]),
  certificateSignature: Buffer.from([48, 4, 5, 6]),
});
const payload = Buffer.from(qr, 'base64');
let offset = 0;
const fields = [];
while (offset < payload.length) {
  const tag = payload[offset++];
  const length = payload[offset++];
  const value = payload.subarray(offset, offset + length);
  assert.equal(value.length, length);
  fields.push([tag, value]);
  offset += length;
}
assert.equal(fields.length, 9);
assert.deepEqual(fields.slice(0, 5).map(([tag]) => tag), [1, 2, 3, 4, 5]);
assert.equal(fields[0][1].toString('utf8'), 'متجر اختبار');
assert.equal(fields[5][1].toString('utf8'), 'a'.repeat(44));
assert.deepEqual(fields[7][1], Buffer.from([48, 1, 2]));
assert.deepEqual(fields[8][1], Buffer.from([48, 4, 5, 6]));
assert.throws(() => buildZatcaQr({
  sellerName: 'x'.repeat(256), vatNumber: '1', timestamp: 't', total: '1', vat: '1',
  invoiceHash: 'h', signatureValue: 's', publicKey: Buffer.from([1]), certificateSignature: Buffer.from([2]),
}), /QR TLV limit/);
const qrXml='<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>'+qr+'</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>';
assert.equal(extractZatcaQr(qrXml),qr);
assert.throws(()=>extractZatcaQr(qrXml.replace(qr, 'not-base64!')),/Base64/);

console.log('PASS: QR TLV uses UTF-8 byte lengths, ordered tags, and the one-byte length limit');
