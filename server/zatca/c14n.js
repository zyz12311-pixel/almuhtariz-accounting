import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'java', 'build');

function runtimeOptions(options) {
  const java = options.javaExecutable || process.env.ZATCA_JAVA || 'java';
  const libraryClasspath = options.classpath || process.env.ZATCA_XMLSEC_CLASSPATH;
  const compiledHelperDirectory = options.helperDirectory || process.env.ZATCA_XMLSEC_HELPER_DIR || helperDirectory;
  if (typeof libraryClasspath !== 'string' || !libraryClasspath.trim()) {
    throw new Error('يجب ضبط ZATCA_XMLSEC_CLASSPATH على مكتبة Apache Santuario المعتمدة');
  }
  if (!path.isAbsolute(compiledHelperDirectory) ||
      !existsSync(path.join(compiledHelperDirectory, 'C14n11.class'))) {
    throw new Error('يجب بناء محرك Java أولاً عبر tools/build-zatca-xmlsec.ps1');
  }
  const entries = [compiledHelperDirectory, ...libraryClasspath.split(path.delimiter)];
  if (entries.some(entry => !path.isAbsolute(entry) || !existsSync(entry))) {
    throw new TypeError('كل مسارات ZATCA_XMLSEC_CLASSPATH يجب أن تكون مطلقة وموجودة');
  }
  return { java, classpath: entries.join(path.delimiter) };
}

export function canonicalizeZatcaInvoiceXml(invoiceXml, options = {}) {
  if (typeof invoiceXml !== 'string' || !invoiceXml.trim()) throw new TypeError('XML الفاتورة مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'invoice'], {
    input: Buffer.from(invoiceXml, 'utf8'),
    windowsHide: true,
    shell: false,
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`تعذر تشغيل محرك C14N 1.1 باستخدام Java: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim().slice(0, 1000);
    throw new Error(`فشل Apache Santuario في canonicalization${detail ? `: ${detail}` : ''}`);
  }
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N 1.1 نتيجة فارغة');
  return result.stdout;
}

export function canonicalizeZatcaXmlSubtree(xml, options = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new TypeError('XML للعقدة مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'subtree'], {
    input: Buffer.from(xml, 'utf8'),
    windowsHide: true,
    shell: false,
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`تعذر تشغيل محرك C14N 1.1 باستخدام Java: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim().slice(0, 1000);
    throw new Error(`فشل Apache Santuario في canonicalization للعقدة${detail ? `: ${detail}` : ''}`);
  }
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N 1.1 نتيجة فارغة للعقدة');
  return result.stdout;
}

export function canonicalizeZatcaSignedInfo(signedInfoXml, options = {}) {
  if (typeof signedInfoXml !== 'string' || !signedInfoXml.trim()) throw new TypeError('XML SignedInfo مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const envelope = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}</ds:Signature>`;
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'signedinfo'], {
    input: Buffer.from(envelope, 'utf8'), windowsHide: true, shell: false,
    timeout: options.timeout ?? 30000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`تعذر canonicalize SignedInfo: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`فشل canonicalize SignedInfo: ${result.stderr?.toString('utf8').trim() || ''}`);
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N SignedInfo فارغًا');
  return result.stdout;
}

export function canonicalizeZatcaSignedProperties(signedPropertiesXml, options = {}) {
  if (typeof signedPropertiesXml !== 'string' || !signedPropertiesXml.trim()) throw new TypeError('XML SignedProperties مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const envelope = `<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedPropertiesXml}</xades:QualifyingProperties>`;
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'signedproperties'], {
    input: Buffer.from(envelope, 'utf8'), windowsHide: true, shell: false,
    timeout: options.timeout ?? 30000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`تعذر canonicalize SignedProperties: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`فشل canonicalize SignedProperties: ${result.stderr?.toString('utf8').trim() || ''}`);
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N SignedProperties فارغًا');
  return result.stdout;
}

export function canonicalizeZatcaSignedInfoDocument(documentXml, options = {}) {
  if (typeof documentXml !== 'string' || !documentXml.trim()) throw new TypeError('XML المستند مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'signedinfo-document'], {
    input: Buffer.from(documentXml, 'utf8'), windowsHide: true, shell: false,
    timeout: options.timeout ?? 30000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`تعذر canonicalize SignedInfo النهائية: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`فشل canonicalize SignedInfo النهائية: ${result.stderr?.toString('utf8').trim() || ''}`);
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N SignedInfo النهائية فارغًا');
  return result.stdout;
}

export function canonicalizeZatcaSignedPropertiesDocument(documentXml, options = {}) {
  if (typeof documentXml !== 'string' || !documentXml.trim()) throw new TypeError('XML المستند مطلوب');
  const { java, classpath } = runtimeOptions(options);
  const result = spawnSync(java, ['-cp', classpath, 'C14n11', 'signedproperties-document'], {
    input: Buffer.from(documentXml, 'utf8'), windowsHide: true, shell: false,
    timeout: options.timeout ?? 30000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`تعذر canonicalize SignedProperties النهائية: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`فشل canonicalize SignedProperties النهائية: ${result.stderr?.toString('utf8').trim() || ''}`);
  if (!result.stdout?.length) throw new Error('أعاد محرك C14N SignedProperties النهائية فارغًا');
  return result.stdout;
}

export function hashZatcaInvoiceC14n11(invoiceXml, options) {
  return createHash('sha256').update(canonicalizeZatcaInvoiceXml(invoiceXml, options)).digest('base64');
}
