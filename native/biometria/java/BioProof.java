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
    Map<String,Object> authorize(Map<String,Object> request) throws BioFailure {
        try {
            if(!request.keySet().equals(new HashSet<>(Arrays.asList("v","kind","companyId","challengeId","nonce","expiresAtEpoch")))||!(request.get("v") instanceof Number)||((Number)request.get("v")).longValue()!=1||!"device".equals(request.get("kind")))throw new IllegalArgumentException();
            for(String name:Arrays.asList("companyId","challengeId","nonce"))if(!(request.get(name) instanceof String)||!((String)request.get(name)).matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException();
            if(!(request.get("expiresAtEpoch") instanceof Number))throw new IllegalArgumentException();
            long expires=((Number)request.get("expiresAtEpoch")).longValue(),now=System.currentTimeMillis()/1000;
            if(expires<=now||expires>now+600)throw new IllegalArgumentException();
            String payload=Json.encode(request);Signature signature=Signature.getInstance("SHA256withECDSA");signature.initSign(key.getPrivate());signature.update(payload.getBytes(StandardCharsets.UTF_8));
            return JPBiometriaAgent.map("ok",true,"publicKey",publicKey(),"proof",payload,"proofSignature",Base64.getEncoder().encodeToString(signature.sign()));
        } catch(Exception e){throw new BioFailure("DEVICE_AUTHORIZATION_INVALID","A autorização expirou ou é inválida. Inicie novamente pelo Master.",400);}
    }
    static String hash(byte[] value) throws Exception {StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value))out.append(String.format("%02x",b&255));return out.toString();}
    Map<String,Object> attest(Map<String,Object> request,Map<String,Object> result) throws BioFailure {
        try {
            String kind=(String)request.get("kind");
            String template=kind.equals("enroll")?(String)result.get("template"):(String)request.get("template");
            if(template==null||template.length()<40||template.length()>120000)throw new IllegalArgumentException();
            Map<String,Object> proof=JPBiometriaAgent.map("v",1,"kind",kind,"challengeId",request.get("challengeId"),"workerId",request.get("workerId"),"fichaId",request.get("fichaId"),"fingerCode",request.get("fingerCode"),"templateHash",hash(template.getBytes(StandardCharsets.UTF_8)));
            if(request.containsKey("documentHash"))proof.put("documentHash",request.get("documentHash"));
            if(kind.equals("enroll")){proof.put("enrolled",true);String image=(String)result.get("fingerImageDataUrl");proof.put("imageHash",hash(Base64.getDecoder().decode(image.substring(image.indexOf(',')+1))));}
            else {
                if(!Boolean.TRUE.equals(result.get("matched")))throw new BioFailure("BIOMETRIA_DIVERGENTE","A digital não corresponde ao cadastro. A ficha continua sem assinatura.",422);
                String image=(String)result.get("fingerImageDataUrl");
                proof.put("matched",true);proof.put("imageHash",hash(Base64.getDecoder().decode(image.substring(image.indexOf(',')+1))));
            }
            String payload=Json.encode(proof);Signature signature=Signature.getInstance("SHA256withECDSA");signature.initSign(key.getPrivate());signature.update(payload.getBytes(StandardCharsets.UTF_8));
            Map<String,Object> out=JPBiometriaAgent.map("ok",true,"proof",payload,"proofSignature",Base64.getEncoder().encodeToString(signature.sign()),"publicKey",publicKey());
            if(kind.equals("enroll")){out.put("template",template);out.put("fingerImageDataUrl",result.get("fingerImageDataUrl"));}
            else {out.put("fingerImageDataUrl",result.get("fingerImageDataUrl"));out.put("matched",true);out.put("realFingerImage",true);}
            return out;
        } catch(BioFailure e){throw e;}catch(Exception e){throw new BioFailure("BIOMETRIC_PROOF_FAILED","Não foi possível confirmar a operação biométrica.",503);}
    }
}
