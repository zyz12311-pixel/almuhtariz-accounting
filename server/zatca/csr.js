import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import * as asn1js from 'asn1js';

const OID = {
  country: '2.5.4.6',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  surname: '2.5.4.4',
  uid: '0.9.2342.19200300.100.1.1',
  title: '2.5.4.12',
  registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15',
  extensionRequest: '1.2.840.113549.1.9.14',
  certificateTemplate: '1.3.6.1.4.1.311.20.2',
  subjectAlternativeName: '2.5.29.17',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
};
const TEMPLATES = new Set(['TSTZATCA-Code-Signing','PREZATCA-Code-Signing','ZATCA-Code-Signing']);

function encode(value) {
  return Buffer.from(value.toBER(false));
}

function objectIdentifier(value) {
  return new asn1js.ObjectIdentifier({ value });
}

function string(value, printable = false) {
  return printable ? new asn1js.PrintableString({ value }) : new asn1js.Utf8String({ value });
}

function attribute(oid, value, printable = false) {
  return new asn1js.Set({
    value: [new asn1js.Sequence({ value: [objectIdentifier(oid), string(value, printable)] })],
  });
}

function x500Name(entries) {
  return new asn1js.Sequence({ value: entries.map(entry => attribute(...entry)) });
}

function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('بيانات CSR مطلوبة');
  const fields = {
    commonName: input.commonName,
    serialNumber: input.serialNumber,
    organizationIdentifier: input.organizationIdentifier,
    organizationUnitName: input.organizationUnitName,
    organizationName: input.organizationName,
    countryName: input.countryName,
    invoiceType: input.invoiceType,
    location: input.location,
    industry: input.industry,
  };
  for (const [name, raw] of Object.entries(fields)) {
    if (typeof raw !== 'string') throw new TypeError(`حقل CSR مطلوب: ${name}`);
    fields[name] = raw.trim();
    if (!fields[name] || fields[name].length > 256 || /[\u0000-\u001f\u007f]/.test(fields[name])) {
      throw new TypeError(`قيمة حقل CSR غير صالحة: ${name}`);
    }
  }
  if (fields.countryName !== 'SA') throw new TypeError('رمز الدولة في CSR يجب أن يكون SA');
  if (!/^3\d{13}3$/.test(fields.organizationIdentifier)) throw new TypeError('معرّف المنشأة في CSR يجب أن يكون رقم VAT سعوديًا من 15 رقمًا');
  if (!/^1-[^|]+\|2-[^|]+\|3-[^|]+$/.test(fields.serialNumber)) {
    throw new TypeError('رقم CSR التسلسلي يجب أن يتبع الصيغة 1-…|2-…|3-…');
  }
  if (!/^[01]{4}$/.test(fields.invoiceType)) throw new TypeError('مؤشر أنواع الفواتير في CSR يجب أن يتكون من أربعة أرقام 0 أو 1');
  if (fields.organizationIdentifier[10] === '1' && !/^\d{10}$/.test(fields.organizationUnitName)) {
    throw new TypeError('وحدة المنشأة في مجموعة VAT يجب أن تكون رقم TIN من 10 أرقام');
  }
  if (typeof input.template !== 'string' || !TEMPLATES.has(input.template)) {
    throw new TypeError('قالب CSR مطلوب ويجب أن يطابق بيئة الهيئة');
  }
  return { ...fields, template: input.template };
}

function extension(oid, innerDer) {
  return new asn1js.Sequence({
    value: [objectIdentifier(oid), new asn1js.OctetString({ valueHex: innerDer.buffer.slice(innerDer.byteOffset, innerDer.byteOffset + innerDer.byteLength) })],
  });
}

function extensionRequest(config) {
  const sanName = x500Name([
    [OID.surname, config.serialNumber],
    [OID.uid, config.organizationIdentifier],
    [OID.title, config.invoiceType],
    [OID.registeredAddress, config.location],
    [OID.businessCategory, config.industry],
  ]);
  const directoryName = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 4, isConstructed: true },
    value: [sanName],
  });
  const generalNames = new asn1js.Sequence({ value: [directoryName] });
  const extensions = new asn1js.Sequence({
    value: [
      extension(OID.certificateTemplate, encode(string(config.template))),
      extension(OID.subjectAlternativeName, encode(generalNames)),
    ],
  });
  return new asn1js.Sequence({
    value: [objectIdentifier(OID.extensionRequest), new asn1js.Set({ value: [extensions] })],
  });
}

function pem(label, der) {
  const base64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

function decodePem(value) {
  if (typeof value !== 'string') throw new TypeError('CSR PEM مطلوب');
  const match = value.trim().match(/^-----BEGIN CERTIFICATE REQUEST-----\s+([A-Za-z0-9+/=\r\n]+)\s+-----END CERTIFICATE REQUEST-----$/);
  if (!match) throw new TypeError('تنسيق CSR PEM غير صالح');
  const base64 = match[1].replace(/\s/g, '');
  const der = Buffer.from(base64, 'base64');
  if (!der.length || der.toString('base64') !== base64) throw new TypeError('ترميز CSR Base64 غير صالح');
  return der;
}

function decodeDer(data, label) {
  const decoded = asn1js.fromBER(data);
  if (decoded.offset !== data.length || decoded.result.error) throw new Error(`ترميز ASN.1 غير صالح في ${label}`);
  return decoded.result;
}

function sequenceValues(block, expected, label) {
  if (!(block instanceof asn1js.Sequence)) throw new Error(`بنية CSR غير صالحة: ${label}`);
  const values = block.valueBlock.value;
  if (expected !== undefined && values.length !== expected) throw new Error(`حقول CSR غير صالحة: ${label}`);
  return values;
}

function oidValue(block, label) {
  if (!(block instanceof asn1js.ObjectIdentifier)) throw new Error(`معرّف ASN.1 غير صالح: ${label}`);
  return block.getValue();
}

function stringValue(block, label) {
  if (typeof block?.valueBlock?.value !== 'string') throw new Error(`قيمة CSR النصية غير صالحة: ${label}`);
  return block.valueBlock.value;
}

function parseX500Name(block, label) {
  const result = {};
  for (const rdn of sequenceValues(block, undefined, label)) {
    if (!(rdn instanceof asn1js.Set) || rdn.valueBlock.value.length !== 1) {
      throw new Error(`بنية RDN غير صالحة: ${label}`);
    }
    const [typeAndValue] = sequenceValues(rdn.valueBlock.value[0], 2, label);
    const oid = oidValue(typeAndValue, label);
    const value = stringValue(rdn.valueBlock.value[0].valueBlock.value[1], label);
    if (Object.hasOwn(result, oid)) throw new Error(`حقل X.500 مكرر: ${oid}`);
    result[oid] = value;
  }
  return result;
}

function parseExtensions(attributeBlock) {
  const [attributeOid, set] = sequenceValues(attributeBlock, 2, 'extensionRequest');
  if (oidValue(attributeOid, 'extensionRequest') !== OID.extensionRequest ||
      !(set instanceof asn1js.Set) || set.valueBlock.value.length !== 1) {
    throw new Error('خاصية extensionRequest مفقودة أو غير صالحة');
  }
  const extensions = set.valueBlock.value[0];
  if (!(extensions instanceof asn1js.Sequence)) throw new Error('بنية Extensions غير صالحة');
  const byOid = new Map();
  for (const item of extensions.valueBlock.value) {
    const [oidBlock, valueBlock] = sequenceValues(item, 2, 'Extension');
    const oid = oidValue(oidBlock, 'Extension');
    if (!(valueBlock instanceof asn1js.OctetString) || byOid.has(oid)) {
      throw new Error(`امتداد CSR غير صالح أو مكرر: ${oid}`);
    }
    byOid.set(oid, Buffer.from(valueBlock.getValue()));
  }
  if (byOid.size !== 2 || !byOid.has(OID.certificateTemplate) || !byOid.has(OID.subjectAlternativeName)) {
    throw new Error('امتدادات CSR لا تطابق قالب ZATCA');
  }
  const template = stringValue(decodeDer(byOid.get(OID.certificateTemplate), 'certificateTemplate'), 'certificateTemplate');
  if (!TEMPLATES.has(template)) throw new Error('قالب CSR غير معتمد');
  const [generalName] = sequenceValues(decodeDer(byOid.get(OID.subjectAlternativeName), 'subjectAlternativeName'), 1, 'subjectAlternativeName');
  if (generalName.idBlock.tagClass !== 3 || generalName.idBlock.tagNumber !== 4 ||
      generalName.valueBlock.value.length !== 1) {
    throw new Error('اسم SAN يجب أن يكون directoryName');
  }
  const san = parseX500Name(generalName.valueBlock.value[0], 'subjectAlternativeName');
  if (Object.keys(san).length !== 5) throw new Error('حقول SAN في CSR غير مكتملة أو تتضمن قيماً إضافية');
  return { template, san };
}

function configFromParsed(parsed) {
  const required = (values, oid, label) => {
    const value = values[oid];
    if (typeof value !== 'string' || !value) throw new Error(`حقل CSR مفقود: ${label}`);
    return value;
  };
  if (Object.keys(parsed.subject).length !== 4) throw new Error('حقول subject في CSR غير مكتملة أو تتضمن قيماً إضافية');
  return normalizeConfig({
    commonName: required(parsed.subject, OID.commonName, 'commonName'),
    organizationUnitName: required(parsed.subject, OID.organizationalUnit, 'organizationUnitName'),
    organizationName: required(parsed.subject, OID.organization, 'organizationName'),
    countryName: required(parsed.subject, OID.country, 'countryName'),
    serialNumber: required(parsed.san, OID.surname, 'serialNumber'),
    organizationIdentifier: required(parsed.san, OID.uid, 'organizationIdentifier'),
    invoiceType: required(parsed.san, OID.title, 'invoiceType'),
    location: required(parsed.san, OID.registeredAddress, 'location'),
    industry: required(parsed.san, OID.businessCategory, 'industry'),
    template: parsed.template,
  });
}

function validateExpectedFields(parsed, expectedConfig) {
  if (!expectedConfig) return;
  const expected = normalizeConfig(expectedConfig);
  const subjectFields = {
    [OID.country]: expected.countryName,
    [OID.organizationalUnit]: expected.organizationUnitName,
    [OID.organization]: expected.organizationName,
    [OID.commonName]: expected.commonName,
  };
  const sanFields = {
    [OID.surname]: expected.serialNumber,
    [OID.uid]: expected.organizationIdentifier,
    [OID.title]: expected.invoiceType,
    [OID.registeredAddress]: expected.location,
    [OID.businessCategory]: expected.industry,
  };
  for (const [oid, value] of Object.entries(subjectFields)) {
    if (parsed.subject[oid] !== value) throw new Error(`قيمة subject في CSR لا تطابق الإعداد: ${oid}`);
  }
  for (const [oid, value] of Object.entries(sanFields)) {
    if (parsed.san[oid] !== value) throw new Error(`قيمة SAN في CSR لا تطابق الإعداد: ${oid}`);
  }
  if (parsed.template !== expected.template) throw new Error('قالب CSR لا يطابق الإعداد');
}

export function createZatcaCsr({ privateKeyPem, config }) {
  const fields = normalizeConfig(config);
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'secp256k1') {
    throw new TypeError('مفتاح CSR يجب أن يكون ECDSA secp256k1');
  }
  const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const subject = x500Name([
    [OID.country, fields.countryName, true],
    [OID.organizationalUnit, fields.organizationUnitName],
    [OID.organization, fields.organizationName],
    [OID.commonName, fields.commonName],
  ]);
  const requestInfo = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 0 }),
      subject,
      decodeDer(publicKeyDer, 'SubjectPublicKeyInfo'),
      new asn1js.Constructed({
        idBlock: { tagClass: 3, tagNumber: 0, isConstructed: true },
        value: [extensionRequest(fields)],
      }),
    ],
  });
  const requestInfoDer = encode(requestInfo);
  const signature = sign('sha256', requestInfoDer, privateKey);
  const request = new asn1js.Sequence({
    value: [
      requestInfo,
      new asn1js.Sequence({ value: [objectIdentifier(OID.ecdsaWithSha256)] }),
      new asn1js.BitString({ valueHex: signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) }),
    ],
  });
  const csrPem = pem('CERTIFICATE REQUEST', encode(request));
  const verified = verifyZatcaCsr(csrPem, fields);
  if (!verified.valid) throw new Error('فشل التحقق المحلي من توقيع CSR');
  if (verified.publicKeyFingerprint !== createHash('sha256').update(publicKeyDer).digest('hex')) {
    throw new Error('مفتاح CSR لا يطابق مفتاح وحدة الإصدار');
  }
  return { csrPem, fingerprint: verified.publicKeyFingerprint, subject: fields };
}

export function verifyZatcaCsr(csrPem, expectedConfig) {
  const der = decodePem(csrPem);
  const request = decodeDer(der, 'CertificationRequest');
  if (!(request instanceof asn1js.Sequence) || request.valueBlock.value.length !== 3) {
    throw new Error('بنية PKCS#10 غير صالحة');
  }
  if (!encode(request).equals(der)) throw new Error('CSR ليس بترميز DER معياري');
  const [requestInfo, algorithm, signature] = request.valueBlock.value;
  if (!(requestInfo instanceof asn1js.Sequence) || requestInfo.valueBlock.value.length !== 4 ||
      !(algorithm instanceof asn1js.Sequence) || !(signature instanceof asn1js.BitString)) {
    throw new Error('حقول PKCS#10 غير مكتملة');
  }
  const [version, subjectBlock, publicKeyBlock, attributes] = requestInfo.valueBlock.value;
  if (!(version instanceof asn1js.Integer) || version.valueBlock.valueDec !== 0 ||
      algorithm.valueBlock.value.length !== 1 ||
      oidValue(algorithm.valueBlock.value[0], 'signatureAlgorithm') !== OID.ecdsaWithSha256) {
    throw new Error('خوارزمية توقيع CSR غير مدعومة');
  }
  if (attributes.idBlock.tagClass !== 3 || attributes.idBlock.tagNumber !== 0 || !attributes.idBlock.isConstructed ||
      attributes.valueBlock.value.length !== 1) {
    throw new Error('حقول attributes في CSR غير صالحة');
  }
  if (signature.valueBlock.unusedBits !== 0) throw new Error('ترميز توقيع CSR غير صالح');
  const publicKeyDer = encode(publicKeyBlock);
  const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'secp256k1') {
    throw new Error('مفتاح CSR العام ليس ECDSA secp256k1');
  }
  const requestInfoDer = encode(requestInfo);
  const signatureBytes = signature.valueBlock.valueHexView;
  const valid = verify('sha256', requestInfoDer, publicKey, signatureBytes);
  if (!valid) throw new Error('توقيع CSR لا يثبت امتلاك المفتاح الخاص المطابق');
  const subject = parseX500Name(subjectBlock, 'subject');
  const { template, san } = parseExtensions(attributes.valueBlock.value[0]);
  const parsed = { subject, san, template };
  const config = configFromParsed(parsed);
  validateExpectedFields(parsed, expectedConfig);
  return {
    valid,
    subject,
    san,
    template,
    config,
    publicKeyFingerprint: createHash('sha256').update(publicKeyDer).digest('hex'),
  };
}
