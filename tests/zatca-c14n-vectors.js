import assert from 'node:assert/strict';
import { canonicalizeZatcaXmlSubtree } from '../server/zatca/c14n.js';

const java = process.env.ZATCA_JAVA;
const classpath = process.env.ZATCA_XMLSEC_CLASSPATH;
if (!java || !classpath) {
  console.log('SKIP: C14N 1.1 xml:base/xml:id vectors require ZATCA_JAVA and ZATCA_XMLSEC_CLASSPATH');
} else {
  const source = '<root xmlns="urn:test" xml:base="http://example.test/a/"><child xml:id="item-1" xml:lang="ar">قيمة</child></root>';
  const canonical = canonicalizeZatcaXmlSubtree(source, {
    javaExecutable: java,
    classpath,
  });
  assert.ok(canonical.includes('xml:base="http://example.test/a/"'), 'C14N 1.1 must preserve xml:base');
  assert.ok(canonical.includes('xml:id="item-1"'), 'C14N 1.1 must preserve xml:id');
  assert.ok(canonical.includes('xml:lang="ar"'), 'C14N 1.1 must preserve xml:lang');
  assert.ok(canonical.includes('قيمة'), 'C14N 1.1 must preserve Unicode text');
  console.log('PASS: C14N 1.1 xml:base/xml:id/xml:lang subtree vectors');
}
