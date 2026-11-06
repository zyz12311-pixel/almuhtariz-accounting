// Recognizes the English output of the official Java SDK 3.4.8. Unknown output fails closed.
export function parseSdkResult(output, {exitCode = null, executionError = null} = {}) {
  const checks = [...output.matchAll(/\[([A-Z]+)\] validation result\s*:\s*(PASSED|FAILED)/g)].map(m => ({check:m[1], result:m[2]}));
  const globals = [...output.matchAll(/GLOBAL VALIDATION RESULT\s*=\s*(PASSED|FAILED)/g)].map(m => m[1]);
  const failed = checks.some(c => c.result === 'FAILED') || globals.includes('FAILED');
  const required = ['XSD','EN','KSA','PIH'];
  const passed = !executionError && exitCode === 0 && !failed && globals.length === 1 && globals[0] === 'PASSED' && required.every(name => checks.some(c => c.check === name && c.result === 'PASSED'));
  return {passed, checks, globalResult:globals.at(-1) || 'UNKNOWN', codes:[...new Set([...output.matchAll(/CODE\s*:\s*([^,\r\n]+)/g)].map(m => m[1].trim()))]};
}
