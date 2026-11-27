import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HEADER = Buffer.from('ALMUHTARIZ-DPAPI-1\n', 'ascii');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const script = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$operation = [Console]::In.ReadLine()',
  '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  "if ($operation -eq 'protect') { $result = [System.Security.Cryptography.ProtectedData]::Protect($data, $null, $scope) }",
  "elseif ($operation -eq 'unprotect') { $result = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $null, $scope) }",
  "else { throw 'Unsupported DPAPI operation' }",
  '[Console]::Out.Write([Convert]::ToBase64String($result))',
].join('\n');

function transform(operation, data) {
  if (process.platform !== 'win32') throw new Error('مخزن DPAPI متاح على Windows فقط');
  let encoded;
  try {
    encoded = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      input: `${operation}\n${Buffer.from(data).toString('base64')}`,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || '').trim();
    throw new Error(`تعذر تنفيذ حماية Windows DPAPI${detail ? `: ${detail}` : ''}`, { cause: error });
  }
  const result = Buffer.from(encoded, 'base64');
  if (!encoded || result.toString('base64') !== encoded) throw new Error('أعاد Windows DPAPI نتيجة غير صالحة');
  return result;
}

export function createWindowsDpapiStore(filePath) {
  if (process.platform !== 'win32') throw new Error('مخزن DPAPI متاح على Windows فقط');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('مسار مخزن DPAPI يجب أن يكون مطلقاً');

  return {
    has() {
      return existsSync(filePath);
    },
    async save(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('بيانات مخزن DPAPI يجب أن تكون كائناً');
      const serialized = Buffer.from(JSON.stringify(value), 'utf8');
      if (!serialized.length || serialized.length > 1024 * 1024) throw new Error('حجم بيانات مخزن DPAPI غير صالح');
      const protectedData = Buffer.concat([HEADER, transform('protect', serialized)]);
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, protectedData, { flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, filePath);
      } catch (error) {
        await unlink(temporaryPath).catch(cleanupError => {
          if (cleanupError.code !== 'ENOENT') throw cleanupError;
        });
        throw error;
      }
    },
    async load() {
      const stored = await readFile(filePath);
      if (!stored.subarray(0, HEADER.length).equals(HEADER)) throw new Error('صيغة مخزن DPAPI غير معروفة');
      const cleartext = transform('unprotect', stored.subarray(HEADER.length));
      try {
        const value = JSON.parse(cleartext.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('بيانات المخزن ليست كائناً');
        return value;
      } catch (error) {
        throw new Error('تعذر قراءة بيانات مخزن DPAPI', { cause: error });
      }
    },
  };
}
