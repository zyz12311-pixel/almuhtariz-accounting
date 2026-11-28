import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSdkResult } from './sdk-result.js';

const run = promisify(execFile);
export async function validateWithOfficialSdk(xml, { operation } = {}) {
  const configPath = process.env.ZATCA_SDK_COMMAND_CONFIG;
  if (!configPath || !path.isAbsolute(configPath)) throw new Error('اضبط ZATCA_SDK_COMMAND_CONFIG على مسار إعداد SDK الرسمي');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!path.isAbsolute(config.executable || '') || !Array.isArray(config.arguments) ||
      config.arguments.some(a => typeof a !== 'string') || !config.arguments.some(a => a.includes('{invoice}'))) {
    throw new Error('إعداد SDK الرسمي غير صالح');
  }
  const env = { ...process.env };
  if (config.sdkConfig) {
    if (!path.isAbsolute(config.sdkConfig)) throw new Error('SDK_CONFIG must be absolute');
    env.SDK_CONFIG = config.sdkConfig;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'almuhtariz-sdk-'));
  try {
    const invoice = path.join(dir, 'invoice.xml');
    const bytes = Buffer.from(xml, 'utf8');
    await fs.writeFile(invoice, bytes, { mode: 0o600 });
    const args = config.arguments.map(a => a.replaceAll('{invoice}', invoice));
    const result = await run(config.executable, args, { cwd: config.cwd || path.dirname(config.executable), env, encoding: 'utf8', shell: false, timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const validation = parseSdkResult(result.stdout + '\n' + result.stderr, { exitCode: 0 });
    if (!validation.passed || !(await fs.readFile(invoice)).equals(bytes)) throw new Error('فشل التحقق الرسمي من XML');
    return { ...validation, xmlSha256: createHash('sha256').update(bytes).digest('base64'), operation, validatedAt: new Date().toISOString() };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
