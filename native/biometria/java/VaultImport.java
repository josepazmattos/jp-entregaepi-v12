import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import javax.swing.*;
import javax.swing.filechooser.FileNameExtensionFilter;

/** PFX decryption occurs only on the Master's computer. The server receives a
 * public chain, proof of possession and KMS-wrapped PKCS#8, never the PFX/password. */
final class VaultImport {
    static Map<String,Object> execute(String token,String company) throws Exception {
        JFileChooser chooser=new JFileChooser();chooser.setDialogTitle("JPGED — Selecione o certificado A1");
        chooser.setFileFilter(new FileNameExtensionFilter("Certificado A1 (.pfx ou .p12)","pfx","p12"));
        if(chooser.showOpenDialog(null)!=JFileChooser.APPROVE_OPTION)throw new BioFailure("CERT_CANCELLED","Configuração cancelada.",409);
        Path path=chooser.getSelectedFile().toPath();if(Files.size(path)>1024*1024)throw new BioFailure("CERT_FILE_LIMIT","O arquivo A1 excede o tamanho permitido.",422);
        JPasswordField field=new JPasswordField(25);
        if(JOptionPane.showConfirmDialog(null,field,"Senha do certificado A1",JOptionPane.OK_CANCEL_OPTION,JOptionPane.PLAIN_MESSAGE)!=JOptionPane.OK_OPTION)throw new BioFailure("CERT_CANCELLED","Configuração cancelada.",409);
        String importId=null;boolean completed=false;
        char[] password=field.getPassword();field.setText("");byte[] encoded=null;
        try {
            KeyStore store=KeyStore.getInstance("PKCS12");
            try(InputStream stream=Files.newInputStream(path)){store.load(stream,password);}
            String alias=null;Enumeration<String> aliases=store.aliases();
            while(aliases.hasMoreElements()){String next=aliases.nextElement();if(store.isKeyEntry(next)){if(alias!=null)throw new BioFailure("CERT_MULTIPLE_KEYS","O arquivo contém mais de uma chave. Use um A1 individual.",422);alias=next;}}
            if(alias==null)throw new BioFailure("CERT_NO_KEY","O arquivo não contém a chave privada do A1.",422);
            Key key=store.getKey(alias,password);
            if(!(key instanceof RSAPrivateKey))throw new BioFailure("CERT_KEY_TYPE","Use um certificado A1 RSA compatível.",422);
            encoded=key.getEncoded();java.security.cert.Certificate[] certificates=store.getCertificateChain(alias);
            if(certificates==null||certificates.length>8)throw new BioFailure("CERT_CHAIN","Cadeia pública do A1 incompleta.",422);
            ((X509Certificate)certificates[0]).checkValidity();
            List<String> chain=new ArrayList<>();for(java.security.cert.Certificate cert:certificates)chain.add(Base64.getEncoder().encodeToString(cert.getEncoded()));
            Map<String,Object> response=CertificateBridge.api("POST","/api/jpged/cofre/preparar",token,company,JPBiometriaAgent.map("chain",chain));
            Map<String,Object> configuration=CertificateBridge.object(response,"configuration");String id=CertificateBridge.value(configuration,"id");importId=id;
            if(!id.matches("[A-Za-z0-9_-]{1,128}"))throw new IOException();
            String name=CertificateBridge.value(configuration,"companyName");
            if(JOptionPane.showConfirmDialog(null,"Autorizar este certificado no cofre para:\n"+name+"\n\nUso: certificar fichas de EPI confirmadas biometricamente.\nA senha e o arquivo A1 não serão enviados ao site.","JPGED — Confirmar empresa",JOptionPane.OK_CANCEL_OPTION)!=JOptionPane.OK_OPTION)throw new BioFailure("CERT_CANCELLED","Configuração cancelada.",409);
            byte[] attrs=Base64.getDecoder().decode(CertificateBridge.value(configuration,"signingBase64"));
            if(attrs.length>16000)throw new IOException();
            Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign((PrivateKey)key);signer.update(attrs);
            response=CertificateBridge.api("POST","/api/jpged/cofre/"+id+"/comprovar",token,company,JPBiometriaAgent.map("signature",Base64.getEncoder().encodeToString(signer.sign())));
            byte[] wrapping=Base64.getDecoder().decode(CertificateBridge.value(response,"wrappingKey"));
            byte[] encrypted=wrap(encoded,wrapping);
            Map<String,Object> result=CertificateBridge.api("POST","/api/jpged/cofre/"+id+"/concluir",token,company,JPBiometriaAgent.map("wrappedKey",Base64.getEncoder().encodeToString(encrypted)));completed=true;return result;
        }catch(UnrecoverableKeyException e){throw new BioFailure("CERT_PASSWORD","Senha do certificado incorreta.",422);}
        catch(IOException e){throw new BioFailure("CERT_FILE","Não foi possível abrir o A1 ou concluir a comunicação. Confira a senha, o arquivo e a conexão.",422);}
        finally{Arrays.fill(password,'\0');if(encoded!=null)Arrays.fill(encoded,(byte)0);if(importId!=null&&!completed)try{CertificateBridge.api("POST","/api/jpged/cofre/"+importId+"/cancelar",token,company,JPBiometriaAgent.map());}catch(Exception ignored){}}
    }
    static byte[] wrap(byte[] pkcs8,byte[] wrappingSpki) throws Exception {
        byte[] aes=new byte[32];new SecureRandom().nextBytes(aes);
        byte[] padded=Arrays.copyOf(pkcs8,((pkcs8.length+7)/8)*8);
        try {
            // RFC 5649: RFC 3394's JCE implementation with the alternative IV.
            byte[] iv=java.nio.ByteBuffer.allocate(8).putInt(0xA65959A6).putInt(pkcs8.length).array();
            Cipher kw=Cipher.getInstance("AESWrap");kw.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(aes,"AES"),new IvParameterSpec(iv));
            byte[] wrapped=kw.doFinal(padded);
            PublicKey publicKey=KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(wrappingSpki));
            Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
            rsa.init(Cipher.ENCRYPT_MODE,publicKey,new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT));
            byte[] secret=rsa.doFinal(aes),result=Arrays.copyOf(secret,secret.length+wrapped.length);System.arraycopy(wrapped,0,result,secret.length,wrapped.length);return result;
        }finally{Arrays.fill(aes,(byte)0);Arrays.fill(padded,(byte)0);}
    }
}
