param(
  [Parameter(Mandatory=$true)][string]$RootThumbprint,
  [string[]]$DnsNames = @($env:COMPUTERNAME, 'localhost'),
  [string[]]$IpAddresses = @(),
  [string]$OutDir = (Join-Path (Get-Location) 'data\tls'),
  [string]$CertName = 'almuhtariz-pos-server',
  [int]$ValidYears = 2
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$root = Get-Item "Cert:\CurrentUser\My\$RootThumbprint" -ErrorAction Stop
if (-not $root.HasPrivateKey) { throw 'شهادة الجذر لا تحتوي مفتاحًا خاصًا في هذا المخزن. أنشئ الجذر على نفس الجهاز أو استورد PFX الجذر مؤقتًا.' }

$sanEntries = @()
foreach ($d in $DnsNames | Where-Object { $_ }) { $sanEntries += "dns=$_" }
foreach ($ip in $IpAddresses | Where-Object { $_ }) { $sanEntries += "ipaddress=$_" }
if (-not $sanEntries.Count) { throw 'يجب تحديد اسم DNS أو عنوان IP واحد على الأقل في SAN.' }
$san = "2.5.29.17={critical}{text}" + ($sanEntries -join '&')

$server = New-SelfSignedCertificate `
  -Subject "CN=$($DnsNames[0])" `
  -Signer $root `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($ValidYears) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyUsage DigitalSignature,KeyEncipherment `
  -TextExtension @($san, '2.5.29.37={critical}{text}1.3.6.1.5.5.7.3.1') `
  -FriendlyName 'AlMuhtariz POS TLS Server'

$certBytes = $server.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$certPem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
$certPath = Join-Path $OutDir "$CertName.pem"
[IO.File]::WriteAllText($certPath, $certPem, [Text.UTF8Encoding]::new($false))

$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($server)
if (-not $rsa) { throw 'تعذر قراءة المفتاح الخاص RSA من شهادة الخادم.' }
try { $keyBytes = $rsa.ExportPkcs8PrivateKey() } catch { $keyBytes = $rsa.ExportRSAPrivateKey() }
$keyLabel = if ($keyBytes.Length -and $rsa.ExportPkcs8PrivateKey()) { 'PRIVATE KEY' } else { 'RSA PRIVATE KEY' }
# Export PKCS8 explicitly
$keyBytes = $rsa.ExportPkcs8PrivateKey()
$keyPem = "-----BEGIN PRIVATE KEY-----`n" + [Convert]::ToBase64String($keyBytes, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END PRIVATE KEY-----`n"
$keyPath = Join-Path $OutDir "$CertName.key.pem"
[IO.File]::WriteAllText($keyPath, $keyPem, [Text.UTF8Encoding]::new($false))

$fingerprint = ([System.Security.Cryptography.SHA256]::Create().ComputeHash($certBytes) | ForEach-Object { $_.ToString('X2') }) -join ':'
Write-Output "SERVER_CERT_THUMBPRINT=$($server.Thumbprint)"
Write-Output "SERVER_CERT_PEM=$certPath"
Write-Output "SERVER_KEY_PEM=$keyPath"
Write-Output "SERVER_CERT_SHA256=$fingerprint"
Write-Output "SAN=$($sanEntries -join ',')"
Write-Output ""
Write-Output "اضبط متغيرات البيئة قبل تشغيل الخادم:"
Write-Output "  ALMUHTARIZ_TLS_CERT=$certPath"
Write-Output "  ALMUHTARIZ_TLS_KEY=$keyPath"
Write-Output ""
Write-Output "ملف المفتاح الخاص حساس. لا تنسخه إلى Git ولا توزعه على أجهزة الفروع."
