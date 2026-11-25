param(
  [Parameter(Mandatory=$true)][string]$RootCerPath,
  [string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
$RootCerPath = (Resolve-Path -LiteralPath $RootCerPath).Path
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($RootCerPath)
$sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
$fp = ($sha | ForEach-Object { $_.ToString('X2') }) -join ':'
Write-Output "ROOT_SUBJECT=$($cert.Subject)"
Write-Output "ROOT_SHA256=$fp"
if ($ExpectedSha256) {
  $normalizedExpected = $ExpectedSha256.ToUpper().Replace('-', ':').Trim()
  if ($fp -ne $normalizedExpected) { throw "البصمة لا تطابق. المتوقع: $normalizedExpected الفعلي: $fp" }
  Write-Output 'FINGERPRINT_MATCH=true'
}
Write-Output ''
Write-Output 'سيتم تثبيت الجذر في CurrentUser\Root (Trusted Root Certification Authorities) للمستخدم الحالي.'
Write-Output 'لا تشغّل هذا السكربت إلا بعد التحقق من البصمة مع الجهاز الرئيسي.'
$confirm = Read-Host 'اكتب YES للتثبيت'
if ($confirm -ne 'YES') { throw 'تم الإلغاء دون تثبيت.' }
Import-Certificate -FilePath $RootCerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Write-Output 'تم تثبيت شهادة الجذر العامة بنجاح.'
