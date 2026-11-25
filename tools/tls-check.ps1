param(
  [int]$HttpsPort = $(if ($env:PORT) { [int]$env:PORT } else { 3000 }),
  [int]$HttpPort = $(if ($env:PORT) { [int]$env:PORT + 1 } else { 3001 }),
  [string]$RootCer = (Join-Path (Get-Location) 'data\tls\almuhtariz-root-ca.cer'),
  [string]$RootPem = (Join-Path (Get-Location) 'data\tls\almuhtariz-root-ca.pem')
)
$ErrorActionPreference = 'Stop'

function Show-Port([int]$port) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if (-not $listeners) { Write-Output "PORT ${port}: not listening"; return }
  foreach ($l in $listeners) {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
    Write-Output "PORT ${port}: $($l.LocalAddress) pid=$($l.OwningProcess) process=$name"
  }
}

Write-Output '== فحص المنافذ =='
Show-Port -port $HttpsPort
Show-Port -port $HttpPort

Write-Output ''
Write-Output '== تحذيرات الربط =='
$httpsAll = Get-NetTCPConnection -State Listen -LocalPort $HttpsPort -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
$httpLoop = Get-NetTCPConnection -State Listen -LocalPort $HttpPort -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '::1' }
if ($httpsAll) { Write-Output "HTTPS_PORT ${HttpsPort} يستمع على واجهات الشبكة - مناسب لـ LAN بشرط وجود شهادة موثوقة." }
if ($httpLoop) { Write-Output "HTTP_PORT ${HttpPort} يستمع على loopback فقط - لا يمكن لأجهزة LAN الوصول إليه مباشرة." }
$httpLan = Get-NetTCPConnection -State Listen -LocalPort $HttpPort -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
if ($httpLan) { Write-Warning "HTTP_PORT ${HttpPort} يستمع على جميع الواجهات؛ هذا يخالف سياسة LAN الآمنة." }

if (Test-Path -LiteralPath $RootCer) {
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path -LiteralPath $RootCer).Path)
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData)
  $fp = ($sha | ForEach-Object { $_.ToString('X2') }) -join ':'
  Write-Output ''
  Write-Output '== بصمة الجذر =='
  Write-Output "ROOT_SUBJECT=$($cert.Subject)"
  Write-Output "ROOT_NOT_AFTER=$($cert.NotAfter.ToString('o'))"
  Write-Output "ROOT_SHA256=$fp"
  Write-Output "اعرض هذه البصمة على مسؤول الفرع قبل تثبيت $RootPem"
} elseif (Test-Path -LiteralPath $RootPem) {
  $pem = Get-Content -LiteralPath $RootPem -Raw
  $b64 = ($pem -replace '-----BEGIN CERTIFICATE-----','' -replace '-----END CERTIFICATE-----','' -replace '\s','')
  $raw = [Convert]::FromBase64String($b64)
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($raw)
  $fp = ($sha | ForEach-Object { $_.ToString('X2') }) -join ':'
  Write-Output ''
  Write-Output '== بصمة الجذر =='
  Write-Output "ROOT_SHA256=$fp"
  Write-Output "اعرض هذه البصمة على مسؤول الفرع قبل تثبيت $RootPem"
} else {
  Write-Warning "لم يتم العثور على ملف جذر عام في $RootCer أو $RootPem"
}
