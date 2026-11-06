param(
  [Parameter(Mandatory=$true)][string]$JavaExe,
  [Parameter(Mandatory=$true)][string]$SdkRoot,
  [Parameter(Mandatory=$true)][string]$Samples,
  [Parameter(Mandatory=$true)][string]$Results
)
# Development fixtures only. Uses the SDK's public sample certificate/key, never a taxpayer identity.
$ErrorActionPreference = 'Stop'
$JavaExe = (Resolve-Path -LiteralPath $JavaExe).Path
$SdkRoot = (Resolve-Path -LiteralPath $SdkRoot).Path
$Samples = (Resolve-Path -LiteralPath $Samples).Path
New-Item -ItemType Directory -Force -Path $Results | Out-Null
$Results = (Resolve-Path -LiteralPath $Results).Path
$jar = Join-Path $SdkRoot 'Apps/zatca-einvoicing-sdk-238-R3.4.8.jar'
if (!(Test-Path -LiteralPath $jar)) { throw 'This verifier requires official Java SDK 3.4.8' }
$utf8 = New-Object Text.UTF8Encoding $false
$config = Get-Content -LiteralPath (Join-Path $SdkRoot 'Configuration/defaults.json') -Raw | ConvertFrom-Json
foreach ($property in $config.PSObject.Properties) {
  $property.Value = [IO.Path]::GetFullPath((Join-Path (Join-Path $SdkRoot 'Configuration') $property.Value))
}
$config.pihPath = Join-Path $Results 'expected-pih.txt'
$configPath = Join-Path $Results 'sdk-test-config.json'
[IO.File]::WriteAllText($configPath,($config | ConvertTo-Json),$utf8)
$oldConfig = $env:SDK_CONFIG
$env:SDK_CONFIG = $configPath
function Invoke-Sdk([string[]]$SdkArgs) {
  $log = (& $JavaExe '-Dfile.encoding=UTF-8' -jar $jar @SdkArgs 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "SDK execution failed: $log" }
  return $log
}
try {
  $previous = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='
  $manifest = @()
  foreach ($kind in @('standard-invoice','standard-credit','standard-debit','simplified-invoice','simplified-credit','simplified-debit')) {
    $name = 'development-'+$kind+'.xml'
    $inputFile = Join-Path $Samples $name
    [xml]$document = Get-Content -LiteralPath $inputFile -Raw -Encoding UTF8
    $pih = $document.Invoice.AdditionalDocumentReference | Where-Object {$_.ID -eq 'PIH'}
    if ([string]$pih.Attachment.EmbeddedDocumentBinaryObject.'#text' -ne $previous) { throw "Broken original PIH chain: $name" }
    [IO.File]::WriteAllText($config.pihPath,$previous,$utf8)
    $hashLog = Invoke-Sdk -SdkArgs @('-generateHash','-invoice',$inputFile)
    $hash = [regex]::Match($hashLog,'INVOICE HASH = ([A-Za-z0-9+/=]+)').Groups[1].Value
    if (!$hash) { throw "Missing SDK hash: $name" }
    $outputFile = Join-Path $Results $name
    $sampleSigned = $kind.StartsWith('simplified')
    if ($sampleSigned) {
      $signLog = Invoke-Sdk -SdkArgs @('-sign','-invoice',$inputFile,'-signedInvoice',$outputFile)
      [IO.File]::WriteAllText((Join-Path $Results ($kind+'.sign.txt')),$signLog,$utf8)
      if (!(Test-Path -LiteralPath $outputFile)) { throw "No signed sample: $name" }
    } else { Copy-Item -LiteralPath $inputFile -Destination $outputFile -Force }
    $finalHashLog = Invoke-Sdk -SdkArgs @('-generateHash','-invoice',$outputFile)
    $finalHash = [regex]::Match($finalHashLog,'INVOICE HASH = ([A-Za-z0-9+/=]+)').Groups[1].Value
    if ($hash -ne $finalHash) { throw "Signing changed fiscal hash: $name" }
    $log = Invoke-Sdk -SdkArgs @('-validate','-invoice',$outputFile)
    [IO.File]::WriteAllText((Join-Path $Results ($kind+'.validation.txt')),$log,$utf8)
    $passed = $log -match 'GLOBAL VALIDATION RESULT = PASSED' -and $log -notmatch 'validation result\s*:\s*FAILED|GLOBAL VALIDATION RESULT = FAILED'
    foreach ($check in @('XSD','EN','KSA','PIH')) { $passed = $passed -and ($log -match "\[$check\] validation result\s*:\s*PASSED") }
    if ($sampleSigned) { foreach ($check in @('QR','SIGNATURE')) { $passed = $passed -and ($log -match "\[$check\] validation result\s*:\s*PASSED") } }
    $manifest += @{file=$name;passed=[bool]$passed;signedWithSdkSampleCertificate=$sampleSigned;hash=$hash;previousHash=$previous;chainVerified=$true;xmlSha256=(Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash}
    $previous = $hash
    Write-Output "$name : $passed"
  }
  [IO.File]::WriteAllText((Join-Path $Results 'manifest.json'),(@{sdk='3.4.8';developmentOnly=$true;authorityApproval=$false;checkedAt=(Get-Date).ToUniversalTime().ToString('o');results=$manifest}|ConvertTo-Json -Depth 6),$utf8)
  if ($manifest.Where({!$_.passed}).Count) { throw 'One or more official SDK validations failed; inspect reports' }
} finally { $env:SDK_CONFIG = $oldConfig }
