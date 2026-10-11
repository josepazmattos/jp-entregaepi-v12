import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** No private certificate or password crosses the loopback API. Signing material
 * comes directly from the fixed authenticated API, never from browser content. */
final class CertificateBridge {
    static final String API="https://g4pdu3t1va.execute-api.sa-east-1.amazonaws.com";
    private static final int LIMIT=4*1024*1024;
    private static final java.util.concurrent.locks.ReentrantLock LOCK=new java.util.concurrent.locks.ReentrantLock();
    static Map<String,Object> execute(String action,Map<String,Object> input) throws BioFailure {
        if(!System.getProperty("os.name","").startsWith("Windows"))throw new BioFailure("CERT_WINDOWS_REQUIRED","A configuração do certificado exige Windows.",409);
        if(!LOCK.tryLock())throw new BioFailure("CERT_BUSY","Uma operação de certificado está em andamento.",409);
        try {
            Set<String> permitted=new HashSet<>(Arrays.asList("token","empresaId","jobId"));
            for(String k:input.keySet())if(!permitted.contains(k))throw new IllegalArgumentException();
            String token=value(input,"token"),company=value(input,"empresaId"),job=value(input,"jobId");
            if(!token.matches("[A-Za-z0-9_.-]{100,16000}")||!company.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException();
            if(action.equals("sign")&&!job.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException();
            Map<String,Object> answer,packet;
            String route;
            if(action.equals("configure")) {
                answer=api("POST","/api/jpged/certificado/configurar",token,company,JPBiometriaAgent.map());
                packet=object(answer,"configuration");route="/api/jpged/certificado/configurar/"+value(packet,"id");
            } else {
                answer=api("GET","/api/jpged/assinaturas/"+job,token,company,null);
                packet=object(answer,"package");if(Boolean.TRUE.equals(packet.get("completed")))return packet;
                route="/api/jpged/assinaturas/"+job;
            }
            Path folder=Paths.get(System.getenv("LOCALAPPDATA"),"JPBiometria","certificados");Files.createDirectories(folder);
            Path binding=folder.resolve(company+".json");
            if(action.equals("sign")) {
                if(!Files.exists(binding))throw new BioFailure("CERT_NOT_CONFIGURED","Configure o certificado desta empresa neste computador em Biometria.",409);
                Map<String,Object> saved=Json.object(new String(Files.readAllBytes(binding),StandardCharsets.UTF_8));
                if(!value(saved,"fingerprint").equals(value(packet,"certificateFingerprint")))throw new BioFailure("CERT_CHANGED","O certificado mudou. Configure-o novamente neste computador.",409);
            }
            Map<String,Object> request=new LinkedHashMap<>(packet);request.put("action",action);request.put("empresaId",company);
            Map<String,Object> signed=windows(request);
            Map<String,Object> result=api("POST",route,token,company,JPBiometriaAgent.map("cms",signed.get("cms")));
            if(action.equals("configure")) {
                Map<String,Object> metadata=object(result,"certificate");
                Path temp=Files.createTempFile(folder,"binding-",".tmp");
                Files.write(temp,Json.encode(JPBiometriaAgent.map("fingerprint",metadata.get("fingerprint"),"thumbprint",metadata.get("thumbprint"))).getBytes(StandardCharsets.UTF_8));
                Files.move(temp,binding,StandardCopyOption.REPLACE_EXISTING);
            }
            return result;
        }catch(BioFailure e){throw e;}catch(Exception e){throw new BioFailure("CERT_OPERATION_FAILED","Não foi possível concluir a certificação. A biometria já salva foi preservada.",503);}
        finally{LOCK.unlock();}
    }
    private static Map<String,Object> windows(Map<String,Object> request) throws Exception {
        String script;
        try(InputStream stream=CertificateBridge.class.getResourceAsStream("/certificates.ps1")){if(stream==null)throw new IOException();script=new String(read(stream,100000),StandardCharsets.UTF_8);}
        String executable=Paths.get(System.getenv("SystemRoot"),"System32","WindowsPowerShell","v1.0","powershell.exe").toString();
        Process process=new ProcessBuilder(executable,"-NoProfile","-STA","-EncodedCommand",Base64.getEncoder().encodeToString(script.getBytes(StandardCharsets.UTF_16LE))).start();
        ExecutorService pool=Executors.newFixedThreadPool(2);
        try {
            Future<byte[]> output=pool.submit(()->read(process.getInputStream(),100000));
            Future<byte[]> errors=pool.submit(()->read(process.getErrorStream(),10000));
            try(OutputStream stream=process.getOutputStream()){stream.write((Json.encode(request)+"\n").getBytes(StandardCharsets.UTF_8));}
            if(!process.waitFor(180,TimeUnit.SECONDS)){process.destroyForcibly();throw new BioFailure("CERT_TIMEOUT","A configuração demorou demais. Tente novamente.",408);}
            String text=new String(output.get(5,TimeUnit.SECONDS),StandardCharsets.UTF_8).trim();errors.get(5,TimeUnit.SECONDS);
            Map<String,Object> result=Json.object(text);
            if(!Boolean.TRUE.equals(result.get("ok")))throw new BioFailure("CERT_LOCAL_FAILED",value(result,"message"),422);
            return result;
        }finally{pool.shutdownNow();process.destroy();}
    }
    private static Map<String,Object> api(String method,String route,String token,String company,Map<String,Object> body) throws Exception {
        if(!route.matches("/api/jpged/(certificado/configurar(?:/[A-Za-z0-9_-]+)?|assinaturas/[A-Za-z0-9_-]+)"))throw new IllegalArgumentException();
        HttpURLConnection connection=(HttpURLConnection)new URL(API+route).openConnection();connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);connection.setConnectTimeout(10000);connection.setReadTimeout(30000);
        connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("x-empresa-id",company);
        if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(OutputStream stream=connection.getOutputStream()){stream.write(Json.encode(body).getBytes(StandardCharsets.UTF_8));}}
        try {
            int status=connection.getResponseCode();InputStream stream=status<400?connection.getInputStream():connection.getErrorStream();
            Map<String,Object> result;try(InputStream source=stream){result=Json.responseObject(new String(read(source,LIMIT),StandardCharsets.UTF_8));}
            if(status!=200||!Boolean.TRUE.equals(result.get("ok")))throw new BioFailure(value(result,"code"),value(result,"error"),status>=400?status:503);
            return result;
        }finally{connection.disconnect();}
    }
    private static byte[] read(InputStream stream,int max) throws IOException {if(stream==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=stream.read(buffer))!=-1){if(out.size()+n>max)throw new IOException();out.write(buffer,0,n);}return out.toByteArray();}
    @SuppressWarnings("unchecked") private static Map<String,Object> object(Map<String,Object> in,String key){Object value=in.get(key);if(!(value instanceof Map))throw new IllegalArgumentException();return (Map<String,Object>)value;}
    private static String value(Map<String,Object> in,String key){Object value=in.get(key);return value instanceof String?(String)value:"";}
}
