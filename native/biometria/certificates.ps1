$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
function Import-JpCertificate($path,$password,$store) {
    $collection=[Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
    $flags=[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet -bor [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet
    $collection.Import($path,$password,$flags)
    $private=@($collection | Where-Object {$_.HasPrivateKey})
    if($private.Count -ne 1){throw 'O arquivo deve conter exatamente uma chave de assinatura.'}
    $certificate=$private[0]
    $store.Add($certificate)
    # Install only public intermediates in CurrentUser CA. Never grant trust to a
    # PFX-provided root; the backend independently validates its pinned ICP roots.
    $intermediates=[Security.Cryptography.X509Certificates.X509Store]::new('CA','CurrentUser')
    try {
        $intermediates.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        foreach($item in $collection){
            $constraints=@($item.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19'})
            if(!$item.HasPrivateKey -and $item.Subject -ne $item.Issuer -and $constraints.Count -eq 1){
                $bc=[Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($constraints[0],$constraints[0].Critical)
                if($bc.CertificateAuthority){$public=[Security.Cryptography.X509Certificates.X509Certificate2]::new($item.RawData);$intermediates.Add($public);$public.Dispose()}
            }
        }
    } finally {$intermediates.Close();foreach($item in $collection){if($item.Thumbprint -ne $certificate.Thumbprint){$item.Dispose()}}}
    return $certificate
}
try {
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    $store = [Security.Cryptography.X509Certificates.X509Store]::new('My','CurrentUser')
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $cert = $null
    if ($request.action -eq 'configure') {
        $message = "Autorizar certificado para: $($request.companyName)`r`n$($request.target.registrationType): $($request.target.registrationNumber)`r`n`r`nO JPGED assinará somente fichas desta empresa confirmadas biometricamente. O certificado e sua senha não serão enviados ao site."

        if ([Windows.Forms.MessageBox]::Show($message,'JPGED — autorização',[Windows.Forms.MessageBoxButtons]::OKCancel) -ne 'OK') { throw 'Cancelado pelo usuário.' }
        $choice = [Windows.Forms.MessageBox]::Show('O certificado A1 já está instalado neste usuário do Windows?','JPGED',[Windows.Forms.MessageBoxButtons]::YesNoCancel)
        if ($choice -eq 'Cancel') { throw 'Cancelado pelo usuário.' }
        if ($choice -eq 'No') {
            $picker = [Windows.Forms.OpenFileDialog]::new()
            $picker.Title = 'Selecione o A1 e-CNPJ ou e-CPF'
            $picker.Filter = 'Certificado A1 (*.pfx;*.p12)|*.pfx;*.p12'
            if ($picker.ShowDialog() -ne 'OK') { throw 'Cancelado pelo usuário.' }
            $form = [Windows.Forms.Form]::new(); $form.Text='Senha do certificado — somente neste computador'; $form.Width=440; $form.Height=170; $form.StartPosition='CenterScreen'; $form.TopMost=$true
            $box=[Windows.Forms.TextBox]::new();$box.UseSystemPasswordChar=$true;$box.Width=390;$box.Left=15;$box.Top=20
            $button=[Windows.Forms.Button]::new();$button.Text='Instalar';$button.Left=300;$button.Top=65;$button.DialogResult='OK';$form.AcceptButton=$button
            $form.Controls.Add($box);$form.Controls.Add($button)
            if($form.ShowDialog() -ne 'OK'){throw 'Cancelado pelo usuário.'}
            $password=[Security.SecureString]::new();foreach($character in $box.Text.ToCharArray()){$password.AppendChar($character)};$password.MakeReadOnly();$box.Clear();$form.Dispose()
            try {
                $cert=Import-JpCertificate $picker.FileName $password $store
            } finally {$password.Dispose();$picker.Dispose()}
        } else {
            $valid=[Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
            foreach($candidate in $store.Certificates){if($candidate.HasPrivateKey -and $candidate.NotAfter -gt [DateTime]::Now -and $candidate.NotBefore -lt [DateTime]::Now){[void]$valid.Add($candidate)}}
            $selected=[Security.Cryptography.X509Certificates.X509Certificate2UI]::SelectFromCollection($valid,'JPGED — certificado da empresa',"Selecione o e-CNPJ A1 deste empregador ou um e-CPF A1",[Security.Cryptography.X509Certificates.X509SelectionFlag]::SingleSelection)
            if($selected.Count -ne 1){throw 'Nenhum certificado selecionado.'};$cert=$selected[0]
        }
    } elseif($request.action -eq 'sign') {
        $found=$store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,[string]$request.thumbprint,$false)
        if($found.Count -ne 1){throw 'Certificado não encontrado neste usuário do Windows. Configure-o novamente.'};$cert=$found[0]
    } else {throw 'Operação não permitida.'}
    if(!$cert.HasPrivateKey -or $cert.NotAfter -le [DateTime]::Now -or $cert.NotBefore -gt [DateTime]::Now){throw 'Certificado vencido ou sem chave privada disponível.'}
    $content=[Convert]::FromBase64String($request.contentBase64)
    if($content.Length -gt 2097152){throw 'Documento excedeu o tamanho permitido.'}
    $cms=[Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($content),$true)
    $signer=[Security.Cryptography.Pkcs.CmsSigner]::new([Security.Cryptography.Pkcs.SubjectIdentifierType]::IssuerAndSerialNumber,$cert)
    $signer.DigestAlgorithm=[Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
    # Collect public chain material without treating the Windows trust store as
    # the trust authority. The API verifies the complete chain against pinned
    # official ICP-Brasil roots and fresh signed CRLs before accepting anything.
    $signer.IncludeOption=[Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
    $chain=[Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode=[Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        $chain.ChainPolicy.UrlRetrievalTimeout=[TimeSpan]::FromSeconds(5)
        [void]$chain.Build($cert)
        foreach($element in $chain.ChainElements){if($element.Certificate.Thumbprint -ne $cert.Thumbprint){[void]$signer.Certificates.Add([Security.Cryptography.X509Certificates.X509Certificate2]::new($element.Certificate.RawData))}}
    } finally {$chain.Dispose()}
    # ESS SigningCertificateV2, SHA-256 default, binds this exact certificate.
    $sha=[Security.Cryptography.SHA256]::Create();$certificateHash=$sha.ComputeHash($cert.RawData);$sha.Dispose()
    [byte[]]$ess=@(0x30,0x26,0x30,0x24,0x30,0x22,0x04,0x20)+$certificateHash
    [void]$signer.SignedAttributes.Add([Security.Cryptography.AsnEncodedData]::new([Security.Cryptography.Oid]::new('1.2.840.113549.1.9.16.2.47'),$ess))
    [void]$signer.SignedAttributes.Add([Security.Cryptography.Pkcs.Pkcs9SigningTime]::new([DateTime]::UtcNow))
    $cms.ComputeSignature($signer,$false)
    @{ok=$true;cms=[Convert]::ToBase64String($cms.Encode())} | ConvertTo-Json -Compress
} catch {
    # Never return paths, raw exception details, passwords, keys or certificate bytes.
    @{ok=$false;message='Configuração ou assinatura não concluída. Confira o arquivo A1, a senha na janela local e a validade do certificado; tente novamente.'} | ConvertTo-Json -Compress
} finally {if($store){$store.Close()};if($cert){$cert.Dispose()}}
