param(
  [string]$CommonName = 'AlMuhtariz Local Root CA',
  [string[]]$DnsNames = @('almuhtariz-pos.local'),
  [string]$OutDir = (Join-Path (Get-Location) 'data\tls'),
  [int]$ValidYears = 5
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$certStore = 'Cert:\CurrentUser\My'
$rootParams = @{
  Subject = "CN=$CommonName"
  KeyAlgorithm = 'RSA'
  KeyLength = 2048
  HashAlgorithm = 'SHA256'
  KeyExportPolicy = 'Exportable'
  NotAfter = (Get-Date).AddYears($ValidYears)
  CertStoreLocation = $certStore
  KeyUsage = 'CertSign','CRLSign','DigitalSignature'
  TextExtension = @('2.5.29.19={critical}{text}ca=TRUE&pathlength=1')
}
$root = New-SelfSignedCertificate @rootParams
$rootCer = Join-Path $OutDir 'almuhtariz-root-ca.cer'
$rootPem = Join-Path $OutDir 'almuhtariz-root-ca.pem'
Export-Certificate -Cert $root -FilePath $rootCer -Force | Out-Null
$certBytes = $root.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
[IO.File]::WriteAllText($rootPem, $pem, [Text.UTF8Encoding]::new($false))
$fingerprint = $root.Thumbprint
Write-Output "ROOT_CA_THUMBPRINT=$fingerprint"
Write-Output "ROOT_CA_CER=$rootCer"
Write-Output "ROOT_CA_PEM=$rootPem"
Write-Output "ROOT_CA_FINGERPRINT_SHA256=$(([System.Security.Cryptography.SHA256]::Create().ComputeHash($certBytes) | ForEach-Object { $_.ToString('X2') }) -join ':')"
Write-Output ""
Write-Output "وزّع فقط ملف الجذر العام على أجهزة نقاط البيع: $rootPem"
Write-Output "لا توزع مفتاح الجذر الخاص ولا تثبته في Git."
Write-Output "قبل تثبيت الجذر على أي جهاز فرع، تأكد أن بصمة SHA-256 أعلاه تطابق الجهاز الذي أنشأ الشهادة."
