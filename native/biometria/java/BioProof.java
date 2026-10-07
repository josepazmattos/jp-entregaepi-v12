import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;
import java.util.*;

/** Persistent workstation attestation. Private key never enters HTTP responses. */
final class BioProof {
    private final KeyPair key;
    BioProof(Path path) throws Exception {
        KeyFactory factory=KeyFactory.getInstance("EC");
        if(path!=null && Files.exists(path)) {
            String[] values=new String(Files.readAllBytes(path),StandardCharsets.US_ASCII).trim().split("\\n");
            if(values.length!=2)throw new GeneralSecurityException("BIOMETRIC_KEY_INVALID");
            key=new KeyPair(factory.generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(values[1]))),factory.generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(values[0]))));
        } else {
            KeyPairGenerator generator=KeyPairGenerator.getInstance("EC");generator.initialize(new ECGenParameterSpec("secp256r1"));key=generator.generateKeyPair();
            if(path!=null) Files.write(path,(Base64.getEncoder().encodeToString(key.getPrivate().getEncoded())+"\n"+publicKey()+"\n").getBytes(StandardCharsets.US_ASCII),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
        }
    }
    String publicKey(){return Base64.getEncoder().encodeToString(key.getPublic().getEncoded());}
    static String hash(byte[] value) throws Exception {StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value))out.append(String.format("%02x",b&255));return out.toString();}
    Map<String,Object> attest(Map<String,Object> request,Map<String,Object> result) throws BioFailure {
        try {
            String kind=(String)request.get("kind");
            String template=kind.equals("enroll")?(String)result.get("template"):(String)request.get("template");
            if(template==null||template.length()<40||template.length()>120000)throw new IllegalArgumentException();
            Map<String,Object> proof=JPBiometriaAgent.map("v",1,"kind",kind,"challengeId",request.get("challengeId"),"workerId",request.get("workerId"),"fichaId",request.get("fichaId"),"fingerCode",request.get("fingerCode"),"templateHash",hash(template.getBytes(StandardCharsets.UTF_8)));
            if(kind.equals("enroll"))proof.put("enrolled",true);
            else {
                if(!Boolean.TRUE.equals(result.get("matched")))throw new BioFailure("BIOMETRIA_DIVERGENTE","A digital não corresponde ao cadastro. A ficha continua sem assinatura.",422);
                String image=(String)result.get("fingerImageDataUrl");
                proof.put("matched",true);proof.put("imageHash",hash(Base64.getDecoder().decode(image.substring(image.indexOf(',')+1))));
            }
            String payload=Json.encode(proof);Signature signature=Signature.getInstance("SHA256withECDSA");signature.initSign(key.getPrivate());signature.update(payload.getBytes(StandardCharsets.UTF_8));
            Map<String,Object> out=JPBiometriaAgent.map("ok",true,"proof",payload,"proofSignature",Base64.getEncoder().encodeToString(signature.sign()),"publicKey",publicKey());
            if(kind.equals("enroll"))out.put("template",template);
            else {out.put("fingerImageDataUrl",result.get("fingerImageDataUrl"));out.put("matched",true);out.put("realFingerImage",true);}
            return out;
        } catch(BioFailure e){throw e;}catch(Exception e){throw new BioFailure("BIOMETRIC_PROOF_FAILED","Não foi possível confirmar a operação biométrica.",503);}
    }
}
