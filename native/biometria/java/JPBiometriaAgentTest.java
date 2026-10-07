import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;

/** Test-only synthetic data and reader; this class is excluded from the released JAR. */
public final class JPBiometriaAgentTest {
    private static int assertions;
    private static final String KEY = Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[32]);
    private static final String ORIGIN = "https://www.jptreinamentos.com.br";
    private static final String SHA = "1111111111111111111111111111111111111111";
    public static void main(String[] args) throws Exception {
        jsonTests(); imageTests(); httpTests();
        System.out.println("Java native bridge: " + assertions + " assertions passed (synthetic reader; no physical SDK/device).");
    }
    static void check(boolean condition, String label) { assertions++; if (!condition) throw new AssertionError(label); }
    interface Checked { void run() throws Exception; }
    static void rejects(Checked action, String label) throws Exception {
        boolean rejected = false; try { action.run(); } catch (Exception e) { rejected = true; } check(rejected, label);
    }
    static void jsonTests() throws Exception {
        Map<String, Object> value = Json.object("{\"purpose\":\"test\",\"requireTemplate\":false,\"unicode\":\"\\u00e7\"}");
        check(value.get("requireTemplate").equals(false), "JSON false is a boolean");
        check(value.get("unicode").equals("ç"), "JSON unicode escape");
        for (String invalid : new String[]{"{\"a\":1,\"a\":2}", "{\"a\":false}x", "{\"a\":{}}", "{\"a\":[]}", "{\"a\":01}", "{\"a\":\"\\u+123\"}", "{\"a\":\"\\u-123\"}", "{\"a\":\"\\u١٢٣٤\"}", "{\"a\":true,}"}) rejects(() -> Json.object(invalid), "strict JSON rejects " + invalid);
        check(Json.encode(JPBiometriaAgent.map("s", "\n\"\\")).equals("{\"s\":\"\\n\\\"\\\\\"}"), "JSON escaping");
        check(JPBiometriaAgent.hmac(KEY, "abc").equals("_XrbFSwF74Dcz1Ch-kwF1aPsbalVdfwxKufF0JGDY1E"), "stable HMAC-SHA256 test vector");
    }
    public static class Audit { public int ImageWidth, ImageHeight; public Finger[] FingerData; Audit(int width, int height, byte[] data) { ImageWidth=width; ImageHeight=height; FingerData=new Finger[]{new Finger(data)}; } }
    public static class Finger { public Template[] Template; Finger(byte[] data) { Template=new Template[]{new Template(data)}; } }
    public static class Template { public byte[] Data; Template(byte[] data) { Data=data; } }
    public static class Unrelated { public int ImageWidth=64, ImageHeight=64; public byte[] arbitrary=new byte[4096]; }
    static String syntheticImage() throws Exception { byte[] raw=new byte[64*64]; for(int i=0;i<raw.length;i++) raw[i]=(byte)(i%256); return NitgenReader.imageFromExport(new Audit(64,64,raw)).dataUrl; }
    static void imageTests() throws Exception {
        String image = syntheticImage(); check(image.startsWith("data:image/png;base64,"), "official raw audit schema creates PNG");
        byte[] png=Base64.getDecoder().decode(image.substring(image.indexOf(',')+1));
        BufferedImage decoded=ImageIO.read(new ByteArrayInputStream(png));
        check(decoded.getWidth()==64 && decoded.getHeight()==64, "generated image dimensions");
        check(!ImageIO.getUseCache(), "ImageIO disk cache disabled");
        NitgenReader.ImageResult encoded=NitgenReader.imageFromExport(new Audit(64,64,png));
        check(encoded.width==64 && encoded.height==64, "genuine encoded image validated");
        rejects(() -> NitgenReader.imageFromExport(new Audit(2049,64,new byte[0])), "invalid audit dimensions");
        rejects(() -> NitgenReader.imageFromExport(new Audit(64,64,new byte[4095])), "no guessed pixel dimensions");
        rejects(() -> NitgenReader.imageFromExport(new Unrelated()), "arbitrary byte arrays never treated as fingerprints");
        rejects(() -> NitgenReader.imageFromExport(new Audit(128,64,png)), "encoded dimensions must match audit");
        byte[] enormous=png.clone(); putInt(enormous,16,100000); putInt(enormous,20,100000);
        CRC32 crc=new CRC32(); crc.update(enormous,12,17); putInt(enormous,29,(int)crc.getValue());
        rejects(() -> NitgenReader.imageFromExport(new Audit(64,64,enormous)), "encoded dimensions checked before allocation");
        byte[] random=new byte[512*512]; new Random(42).nextBytes(random);
        rejects(() -> NitgenReader.imageFromExport(new Audit(512,512,random)), "image output size limit");
        Map<String,Object> missing=new NitgenReader(null,null,"SDK_NOT_FOUND").probe();
        check(Boolean.FALSE.equals(missing.get("ok")) && "SDK_NOT_FOUND".equals(missing.get("errorCode")), "missing SDK returns useful status");
    }
    static void putInt(byte[] b,int at,int value) { for(int i=0;i<4;i++) b[at+i]=(byte)(value>>>(24-i*8)); }

    static final class FakeReader implements BioReader {
        final AtomicInteger probes=new AtomicInteger(), captures=new AtomicInteger();
        volatile boolean match=true;
        public Map<String,Object> enroll(String finger){return JPBiometriaAgent.map("ok",true,"template","SYNTHETIC_TEMPLATE_NOT_REAL_BIOMETRIC_DATA_0123456789");}
        public Map<String,Object> verify(String finger,String template)throws BioFailure{
            try{return JPBiometriaAgent.map("ok",true,"matched",match,"fingerImageDataUrl",syntheticImage());}
            catch(Exception e){throw new BioFailure("TEST_IMAGE_FAILED","test",500);}
        }
        volatile CountDownLatch entered, release;
        public Map<String,Object> probe() { probes.incrementAndGet(); return JPBiometriaAgent.map("ok",true,"sdk",true,"reader",true,"deviceCount",1,"message","Synthetic test reader"); }
        public Map<String,Object> capture(String finger,String purpose) throws BioFailure {
            captures.incrementAndGet();
            if(entered!=null) entered.countDown();
            if(release!=null) try { if(!release.await(5,TimeUnit.SECONDS)) throw new BioFailure("TEST_TIMEOUT","synthetic test timeout",500); } catch(InterruptedException e) { throw new BioFailure("TEST_INTERRUPTED","test interrupted",500); }
            try { return JPBiometriaAgent.map("ok",true,"realFingerImage",true,"fingerImageDataUrl",syntheticImage(),"fingerCode",finger,"template","DO_NOT_RETURN","templateHash","DO_NOT_RETURN","matched",true,"matchScore",99,"message","synthetic capture"); }
            catch(Exception e) { throw new BioFailure("TEST_IMAGE_FAILED","synthetic image failed",500); }
        }
    }
    static JPBiometriaAgent start(FakeReader reader) throws Exception {
        for(int port=8789;port<=8799;port++) try { JPBiometriaAgent agent=new JPBiometriaAgent(port,KEY,SHA,reader); agent.start(); return agent; } catch(BindException e) { }
        throw new IOException("No test port available");
    }
    static void httpTests() throws Exception {
        FakeReader reader=new FakeReader(); JPBiometriaAgent agent=start(reader); int port=agent.port();
        try {
            long until=System.currentTimeMillis()+2000;
            while(Boolean.TRUE.equals(agent.status().get("checking")) && System.currentTimeMillis()<until) Thread.sleep(10);
            Response status=request(port,"GET","/status",ORIGIN,null,null);
            check(status.code==200 && status.body.contains("\"sdk\":true") && status.body.contains("\"captureMethod\":\"POST\""), "ready status with declared API");
            check(ORIGIN.equals(status.headers.get("access-control-allow-origin")), "exact allowed CORS origin");
            check("no-store".equals(status.headers.get("cache-control")), "responses never cached");
            check(!status.body.contains(KEY) && !status.body.contains("template"+"Hash"), "status excludes key and biometrics");
            check(request(port,"GET","/status",null,null,null).code==200, "local status without Origin");
            Response foreign=request(port,"GET","/status","https://untrusted.example",null,null);
            check(foreign.code==403 && !foreign.headers.containsKey("access-control-allow-origin"), "untrusted origin blocked without CORS");
            check(request(port,"GET","/status","null",null,null).code==403, "opaque origin blocked");
            check(request(port,"GET","/status","https://www.jptreinamentos.com.br.evil.example",null,null).code==403, "lookalike domain blocked");
            check(request(port,"GET","/status",ORIGIN,null,headers("Host","evil.example:"+port)).code==403, "DNS rebinding Host blocked");
            check(request(port,"GET","/status","http://127.0.0.1:"+port,null,null).code==200, "own diagnostic origin allowed");
            check(request(port,"GET","/status","http://127.0.0.1:"+(port+1),null,null).code==403, "different local port origin blocked");
            check(request(port,"GET","/introspect",ORIGIN,null,null).code==404, "no public SDK introspection");
            check(request(port,"GET","/shutdown",ORIGIN,null,null).code==404, "no public shutdown route");
            check(request(port,"GET","/api/capture",ORIGIN,null,null).code==405, "GET cannot capture");
            check(request(port,"POST","/api/capture",null,"{}",null).code==403, "no-Origin POST cannot capture");
            check(request(port,"POST","/api/signature",ORIGIN,"{}",null).code==400, "matching requires a scoped challenge");
            check(request(port,"POST","/api/capture",ORIGIN,"{\"requireTemplate\":true}",null).code==501, "template enrollment explicitly unsupported");
            check(request(port,"POST","/api/capture",ORIGIN,"{\"requireTemplate\":\"false\"}",null).code==400, "template flag strict boolean");
            check(request(port,"POST","/api/capture",ORIGIN,"{\"purpose\":\"test\",\"purpose\":\"signature\"}",null).code==400, "duplicate fields rejected");
            check(request(port,"POST","/api/capture",ORIGIN,"{\"template\":\"arbitrary\"}",null).code==400, "template input not accepted");
            check(request(port,"POST","/api/capture",ORIGIN,"{}",headers("Content-Type","text/plain-evil")).code==415, "exact MIME type required");
            char[] oversized=new char[17000]; Arrays.fill(oversized,'x');
            check(request(port,"POST","/api/capture",ORIGIN,new String(oversized),null).code==413, "request body bounded");
            Response options=request(port,"OPTIONS","/api/capture",ORIGIN,null,headers("Access-Control-Request-Method","POST","Access-Control-Request-Headers","Content-Type","Access-Control-Request-Private-Network","true"));
            check(options.code==204 && "true".equals(options.headers.get("access-control-allow-private-network")), "allowed preflight and legacy PNA compatibility");
            check(request(port,"OPTIONS","/api/capture",ORIGIN,null,headers("Access-Control-Request-Method","GET")).code==405, "preflight rejects capture GET");
            check(request(port,"OPTIONS","/api/capture",ORIGIN,null,headers("Access-Control-Request-Method","POST","Access-Control-Request-Headers","X-JP-Control")).code==403, "control header not browser allowed");
            check(request(port,"OPTIONS","/status","https://untrusted.example",null,headers("Access-Control-Request-Method","GET")).code==403, "foreign preflight blocked");
            Response debug=request(port,"GET","/debug/capture",null,null,null);
            check(debug.code==200 && debug.headers.get("content-security-policy").contains("frame-ancestors 'none'"), "local diagnostic has restrictive CSP");
            String capture="{\"cmd\":\"capture\",\"purpose\":\"test\",\"fingerCode\":\"R_INDEX\",\"agentFingerCode\":\"RIGHT_INDEX\",\"requireRealImage\":true,\"requireTemplate\":false}";
            Response result=request(port,"POST","/api/capture",ORIGIN,capture,null);
            check(result.code==200 && result.body.contains("data:image/png;base64,"), "frontend capture contract works");
            check(result.body.contains("\"biometricVerified\":false") && !result.body.contains("DO_NOT_RETURN") && !result.body.contains("\"matched\"") && !result.body.contains("matchScore"), "capture never claims a biometric match or returns templates");
            check(reader.captures.get()==1, "invalid routes never invoke SDK capture");
            Response fallback=request(port,"POST","/capture",ORIGIN,capture,null); check(fallback.code==200, "POST legacy alias supports same safe contract");
            Map<String,Object> enrollment=JPBiometriaAgent.map("kind","enroll","challengeId","test-challenge","workerId","worker-test","fichaId","","fingerCode","R_INDEX");
            Response enrolled=request(port,"POST","/api/enroll",ORIGIN,Json.encode(enrollment),null);
            check(enrolled.code==200,"enrollment produces signed template evidence");
            Map<String,Object> enrolledBody=Json.object(enrolled.body);
            check(enrolledBody.containsKey("template")&&enrolledBody.containsKey("proofSignature"),"enrollment returns template and proof");
            Map<String,Object> verification=JPBiometriaAgent.map("kind","verify","challengeId","verify-challenge","workerId","worker-test","fichaId","ficha-test","fingerCode","R_INDEX","template",enrolledBody.get("template"),"publicKey",enrolledBody.get("publicKey"));
            reader.match=false;
            Response mismatch=request(port,"POST","/api/signature",ORIGIN,Json.encode(verification),null);
            check(mismatch.code==422&&!mismatch.body.contains("proofSignature"),"mismatch cannot produce signature evidence");
            reader.match=true;
            Response matched=request(port,"POST","/api/signature",ORIGIN,Json.encode(verification),null);
            check(matched.code==200&&matched.body.contains("proofSignature"),"positive SDK result creates signed verification evidence");
            Map<String,Object> signed=Json.object(matched.body);
            java.security.PublicKey pub=java.security.KeyFactory.getInstance("EC").generatePublic(new java.security.spec.X509EncodedKeySpec(Base64.getDecoder().decode((String)signed.get("publicKey"))));
            java.security.Signature checkSignature=java.security.Signature.getInstance("SHA256withECDSA");checkSignature.initVerify(pub);checkSignature.update(((String)signed.get("proof")).getBytes(StandardCharsets.UTF_8));
            check(checkSignature.verify(Base64.getDecoder().decode((String)signed.get("proofSignature"))),"proof verifies with public key");
            verification.put("publicKey","different-device");check(request(port,"POST","/api/signature",ORIGIN,Json.encode(verification),null).code==409,"unrecognized workstation cannot verify");
            check(request(port,"POST","/api/enroll","https://foreign.example",Json.encode(enrollment),null).code==403,"foreign origin cannot enroll");
            java.nio.file.Path keyPath=java.nio.file.Files.createTempDirectory("jp-proof-test").resolve("key.txt");
            BioProof persisted=new BioProof(keyPath);check(persisted.publicKey().equals(new BioProof(keyPath).publicKey()),"workstation key survives restart");java.nio.file.Files.delete(keyPath);java.nio.file.Files.delete(keyPath.getParent());
            Response ping=control(port,"ping",KEY,null,null); check(ping.code==200 && ping.body.contains("\"owned\":true"), "private control authenticated");
            check(!ping.body.contains(KEY) && ping.body.contains("\"proof\":"), "control response proves ownership without key");
            byte[] wrongKey=new byte[32]; Arrays.fill(wrongKey,(byte)1);
            check(control(port,"ping",Base64.getUrlEncoder().withoutPadding().encodeToString(wrongKey),null,null).code==403, "wrong key rejected");
            check(control(port,"ping",KEY,ORIGIN,null).code==403, "browser cannot use control even with authentication");
            Map<String,String> reused=controlHeaders("ping",KEY,System.currentTimeMillis()/1000,"AAAAAAAAAAAAAAAAAAAAAA");
            check(control(port,"ping",KEY,null,reused).code==200, "fresh control nonce accepted");
            check(control(port,"ping",KEY,null,reused).code==403, "control nonce replay rejected");
            check(control(port,"ping",KEY,null,controlHeaders("ping",KEY,System.currentTimeMillis()/1000-120,"BBBBBBBBBBBBBBBBBBBBBB")).code==403, "expired control rejected");
            reader.entered=new CountDownLatch(1); reader.release=new CountDownLatch(1);
            ExecutorService pool=Executors.newSingleThreadExecutor();
            Future<Response> active=pool.submit(() -> request(port,"POST","/api/capture",ORIGIN,capture,null));
            check(reader.entered.await(2,TimeUnit.SECONDS), "capture started");
            int priorProbes=reader.probes.get(); long before=System.nanoTime();
            Response busy=request(port,"GET","/status",ORIGIN,null,null);
            check(busy.code==200 && busy.body.contains("\"busy\":true") && (System.nanoTime()-before)/1000000<500, "status responds promptly during capture");
            check(reader.probes.get()==priorProbes, "status never opens SDK during active capture");
            check(request(port,"POST","/api/capture",ORIGIN,capture,null).code==409, "concurrent capture rejected");
            check(control(port,"shutdown",KEY,null,null).code==409, "repair refuses shutdown during capture");
            reader.release.countDown(); check(active.get(2,TimeUnit.SECONDS).code==200, "active capture completes without interruption"); pool.shutdownNow();
            reader.entered=null; reader.release=null;
            check(control(port,"shutdown",KEY,null,null).code==200, "idle authenticated shutdown accepted");
            Thread.sleep(250);
        } finally { reader.release=null; agent.close(); }
    }
    static Map<String,String> headers(String... pairs) { Map<String,String> out=new LinkedHashMap<>(); for(int i=0;i<pairs.length;i+=2) out.put(pairs[i],pairs[i+1]); return out; }
    static Map<String,String> controlHeaders(String command,String key,long timestamp,String nonce) {
        String body="{\"command\":\""+command+"\"}";
        return headers("X-JP-Control","v1:"+timestamp+":"+nonce+":"+JPBiometriaAgent.hmac(key,"/control\n"+timestamp+"\n"+nonce+"\n"+body));
    }
    static Response control(int port,String command,String key,String origin,Map<String,String> extra) throws Exception {
        if(extra==null) extra=controlHeaders(command,key,System.currentTimeMillis()/1000,Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(UUID.randomUUID().toString().getBytes(StandardCharsets.US_ASCII),16)));
        return request(port,"POST","/control",origin,"{\"command\":\""+command+"\"}",extra);
    }
    static final class Response { int code; String body; Map<String,String> headers=new HashMap<>(); }
    static Response request(int port,String method,String path,String origin,String body,Map<String,String> extra) throws Exception {
        Map<String,String> headers=headers("Host","127.0.0.1:"+port,"Connection","close");
        if(origin!=null) headers.put("Origin",origin);
        byte[] data=body==null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        if(body!=null) { headers.put("Content-Type","text/plain;charset=UTF-8"); headers.put("Content-Length",String.valueOf(data.length)); }
        if(extra!=null) headers.putAll(extra);
        try(Socket socket=new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1",port),1000); socket.setSoTimeout(7000);
            StringBuilder raw=new StringBuilder(method+" "+path+" HTTP/1.1\r\n");
            for(Map.Entry<String,String> entry:headers.entrySet()) raw.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
            raw.append("\r\n"); socket.getOutputStream().write(raw.toString().getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().write(data); socket.getOutputStream().flush();
            ByteArrayOutputStream response=new ByteArrayOutputStream(); byte[] buffer=new byte[4096]; int n;
            while((n=socket.getInputStream().read(buffer))!=-1) { response.write(buffer,0,n); if(response.size()>1024*1024) throw new IOException("oversize test response"); }
            String rawResponse=new String(response.toByteArray(),StandardCharsets.UTF_8); int split=rawResponse.indexOf("\r\n\r\n");
            if(split<0) throw new IOException("invalid HTTP response");
            String[] lines=rawResponse.substring(0,split).split("\r\n"); Response out=new Response(); out.code=Integer.parseInt(lines[0].split(" ")[1]); out.body=rawResponse.substring(split+4);
            for(int i=1;i<lines.length;i++) { int colon=lines[i].indexOf(':'); if(colon>0) out.headers.put(lines[i].substring(0,colon).toLowerCase(Locale.ROOT),lines[i].substring(colon+1).trim()); }
            return out;
        }
    }
}
