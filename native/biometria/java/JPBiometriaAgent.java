import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Loopback-only bridge. A local private control key is never exposed to browser responses. */
public final class JPBiometriaAgent implements AutoCloseable {
    static final String VERSION = "12.8.1", SERVICE = "JP Biometria Local Java";
    static final int FIRST_PORT = 8789, LAST_PORT = 8799, MAX_BODY = 16384;
    static final Set<String> WEB_ORIGINS = new HashSet<>(Arrays.asList("https://www.jptreinamentos.com.br", "https://jptreinamentos.com.br"));
    private final HttpServer server;
    private final BioReader reader;
    private final String controlKey, instance = UUID.randomUUID().toString();
    private final String buildSha;
    private final ExecutorService requests = Executors.newFixedThreadPool(6, daemon("jp-http"));
    private final ExecutorService sdk = Executors.newSingleThreadExecutor(daemon("jp-sdk-status"));
    private final ReentrantLock deviceLock = new ReentrantLock();
    private final AtomicBoolean probeQueued = new AtomicBoolean();
    private final CountDownLatch stopped = new CountDownLatch(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Map<String, Long> controlNonces = new LinkedHashMap<>();
    private volatile boolean shuttingDown;
    private volatile boolean capturing;
    private volatile long checkedAt;
    private volatile Map<String, Object> deviceStatus = map("ok", false, "sdk", false, "reader", false, "deviceCount", 0,
        "errorCode", "INITIALIZING", "message", "Verificando o SDK e o leitor NITGEN.");

    JPBiometriaAgent(int port, String key, String sha, BioReader reader) throws IOException {
        if (port < FIRST_PORT || port > LAST_PORT) throw new IllegalArgumentException("PORT_NOT_ALLOWED");
        if (key == null || !key.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("CONTROL_KEY_INVALID");
        this.reader = reader; this.controlKey = key; this.buildSha = sha;
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        server.createContext("/", this::handle); server.setExecutor(requests);
    }
    int port() { return server.getAddress().getPort(); }
    void start() { server.start(); refreshStatus(); }
    private static ThreadFactory daemon(final String name) { return runnable -> { Thread t = new Thread(runnable, name); t.setDaemon(true); return t; }; }

    private void refreshStatus() {
        if (shuttingDown || capturing || !probeQueued.compareAndSet(false, true)) return;
        sdk.execute(() -> {
            if (!deviceLock.tryLock()) { probeQueued.set(false); return; }
            try { if (!shuttingDown) { deviceStatus = new LinkedHashMap<>(reader.probe()); checkedAt = System.currentTimeMillis(); } }
            catch (Throwable e) { deviceStatus = map("ok", false, "sdk", false, "reader", false, "deviceCount", 0,
                "errorCode", "SDK_STATUS_FAILED", "message", "O SDK não concluiu a verificação do leitor."); checkedAt = System.currentTimeMillis(); }
            finally { deviceLock.unlock(); probeQueued.set(false); }
        });
    }
    Map<String, Object> status() {
        Map<String, Object> out = new LinkedHashMap<>(deviceStatus);
        out.putAll(map("version", VERSION, "service", SERVICE, "agent", "JPBiometria", "buildSha", buildSha,
            "instanceId", instance, "port", port(), "busy", capturing, "checking", probeQueued.get(),
            "capabilities", map("capture", true, "captureMethod", "POST", "capturePath", "/api/capture", "templates", false, "verify", false)));
        if (capturing) { out.put("message", "Captura em andamento. Aguarde a conclusão."); }
        return out;
    }
    private void handle(HttpExchange exchange) throws IOException {
        try {
            String host = exchange.getRequestHeaders().getFirst("Host");
            if (!exchange.getRemoteAddress().getAddress().isLoopbackAddress() || !validHost(host)) { error(exchange, 403, "HOST_NOT_ALLOWED", "Destino local não permitido."); return; }
            String path = exchange.getRequestURI().getPath(); String method = exchange.getRequestMethod();
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            if (path.equals("/control")) { control(exchange, origin); return; }
            if (origin != null && !allowedOrigin(origin)) { error(exchange, 403, "ORIGIN_NOT_ALLOWED", "Origem não autorizada a usar o leitor."); return; }
            boolean statusPath = path.equals("/status") || path.equals("/debug/status");
            boolean debugPath = path.equals("/debug/capture") || path.equals("/");
            boolean capturePath = path.equals("/api/capture") || path.equals("/capture");
            boolean verifyPath = path.equals("/api/signature") || path.equals("/verify");
            if (!statusPath && !debugPath && !capturePath && !verifyPath) { error(exchange, 404, "NOT_FOUND", "Rota não disponível."); return; }
            if (method.equals("OPTIONS")) {
                if (origin == null) { error(exchange, 403, "ORIGIN_REQUIRED", "Origem necessária."); return; }
                String requested = exchange.getRequestHeaders().getFirst("Access-Control-Request-Method");
                if (requested == null || !(requested.equals("GET") && (statusPath || debugPath) || requested.equals("POST") && (capturePath || verifyPath))) {
                    error(exchange, 405, "METHOD_NOT_ALLOWED", "Método não permitido."); return;
                }
                String headers = exchange.getRequestHeaders().getFirst("Access-Control-Request-Headers");
                if (headers != null) for (String header : headers.split(",")) if (!Arrays.asList("content-type", "x-jp-entregaepi").contains(header.trim().toLowerCase(Locale.ROOT))) {
                    error(exchange, 403, "HEADER_NOT_ALLOWED", "Cabeçalho não permitido."); return;
                }
                responseHeaders(exchange); exchange.sendResponseHeaders(204, -1); exchange.close(); return;
            }
            if (statusPath) {
                if (!method.equals("GET")) { error(exchange, 405, "METHOD_NOT_ALLOWED", "Use GET para consultar o status."); return; }
                if (System.currentTimeMillis() - checkedAt > 5000) refreshStatus();
                json(exchange, 200, status()); return;
            }
            if (debugPath) {
                if (!method.equals("GET")) { error(exchange, 405, "METHOD_NOT_ALLOWED", "Método não permitido."); return; }
                debug(exchange); return;
            }
            // Side effects require an explicitly allowed Origin and POST. No image-tag/navigation capture.
            if (!method.equals("POST")) { error(exchange, 405, "METHOD_NOT_ALLOWED", "Use POST para a captura."); return; }
            if (origin == null) { error(exchange, 403, "ORIGIN_REQUIRED", "Abra o teste no aplicativo JP ou no diagnóstico local."); return; }
            if (verifyPath) { error(exchange, 501, "BIOMETRIC_MATCH_NOT_SUPPORTED", "Esta ponte captura a imagem. A comparação de identidade biométrica não está habilitada."); return; }
            capture(exchange);
        } catch (IllegalArgumentException e) { error(exchange, 400, "INVALID_REQUEST", "Os parâmetros da solicitação são inválidos."); }
        catch (BioFailure e) { error(exchange, e.httpStatus, e.code, e.getMessage()); }
        finally { exchange.close(); }
    }
    boolean validHost(String host) { return ("127.0.0.1:" + port()).equals(host) || ("localhost:" + port()).equals(host); }
    boolean allowedOrigin(String origin) { return WEB_ORIGINS.contains(origin) || ("http://127.0.0.1:" + port()).equals(origin) || ("http://localhost:" + port()).equals(origin); }
    private void capture(HttpExchange exchange) throws IOException, BioFailure {
        String type = exchange.getRequestHeaders().getFirst("Content-Type");
        if (type == null || !Arrays.asList("text/plain", "application/json").contains(type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT)))
            throw new BioFailure("CONTENT_TYPE_REQUIRED", "Envie os parâmetros da captura em JSON.", 415);
        Map<String, Object> body = Json.object(readBody(exchange));
        Set<String> permitted = new HashSet<>(Arrays.asList("cmd", "purpose", "fingerCode", "agentFingerCode", "requireRealImage", "requireImage", "requireTemplate"));
        for (String key : body.keySet()) if (!permitted.contains(key)) throw new IllegalArgumentException("UNKNOWN_FIELD");
        for (String flag : Arrays.asList("requireRealImage", "requireImage")) if (body.containsKey(flag) && !(body.get(flag) instanceof Boolean)) throw new IllegalArgumentException("IMAGE_FLAG_INVALID");
        if (body.containsKey("cmd") && !"capture".equals(body.get("cmd"))) throw new IllegalArgumentException("COMMAND_INVALID");
        if (body.containsKey("requireTemplate") && !(body.get("requireTemplate") instanceof Boolean)) throw new IllegalArgumentException("TEMPLATE_FLAG_INVALID");
        if (Boolean.TRUE.equals(body.get("requireTemplate"))) throw new BioFailure("TEMPLATES_NOT_SUPPORTED", "O cadastro de templates não está habilitado nesta ponte de captura.", 501);
        String purpose = text(body, "purpose", "test");
        if (!Arrays.asList("test", "signature").contains(purpose)) throw new IllegalArgumentException("PURPOSE_INVALID");
        String finger = text(body, "fingerCode", "R_INDEX");
        if (!finger.matches("(R|L)_(THUMB|INDEX|MIDDLE|RING|LITTLE)|(?:RIGHT|LEFT)_(THUMB|INDEX|MIDDLE|RING|LITTLE)")) throw new IllegalArgumentException("FINGER_INVALID");
        if (!deviceLock.tryLock()) throw new BioFailure("READER_BUSY", "O leitor está em uso ou em verificação. Aguarde e tente novamente.", 409);
        capturing = true;
        try {
            if (shuttingDown) throw new BioFailure("AGENT_STOPPING", "O agente está sendo reiniciado. Aguarde.", 503);
            Map<String, Object> result = reader.capture(finger, purpose);
            // Enforce the capture-only contract even if an adapter is changed later.
            result.remove("template"); result.remove("templateHash"); result.remove("matched"); result.remove("matchScore");
            result.put("biometricVerified", false); result.put("version", VERSION); result.put("service", SERVICE); result.put("buildSha", buildSha);
            json(exchange, 200, result);
        } finally { capturing = false; deviceLock.unlock(); checkedAt = 0; }
    }
    private void control(HttpExchange exchange, String origin) throws IOException, BioFailure {
        if (!exchange.getRequestMethod().equals("POST") || origin != null) { error(exchange, 403, "CONTROL_DENIED", "Controle local não autorizado."); return; }
        String payload = readBody(exchange), token = exchange.getRequestHeaders().getFirst("X-JP-Control");
        String[] auth = token == null ? new String[0] : token.split(":", -1);
        if (!validControl(auth, payload)) {
            error(exchange, 403, "CONTROL_DENIED", "Controle local não autorizado."); return;
        }
        Map<String, Object> body = Json.object(payload); String command = text(body, "command", "");
        if (!command.equals("ping") && !command.equals("shutdown")) { error(exchange, 400, "CONTROL_COMMAND_INVALID", "Comando não permitido."); return; }
        if (command.equals("shutdown")) {
            if (!deviceLock.tryLock()) { error(exchange, 409, "READER_BUSY", "Aguarde a conclusão da captura ou verificação antes de reparar o agente."); return; }
            try { shuttingDown = true; } finally { deviceLock.unlock(); }
        }
        String proof = hmac(controlKey, "response\n" + auth[1] + "\n" + auth[2] + "\n" + command + "\n" + instance + "\n" + VERSION + "\n" + port() + "\n" + buildSha);
        json(exchange, 200, map("ok", true, "owned", true, "version", VERSION, "buildSha", buildSha, "instanceId", instance, "port", port(), "proof", proof));
        if (command.equals("shutdown")) { Thread thread = new Thread(() -> { try { Thread.sleep(150); } catch (InterruptedException ignored) { } close(); }); thread.setDaemon(true); thread.start(); }
    }
    private synchronized boolean validControl(String[] auth, String payload) {
        if (auth.length != 4 || !auth[0].equals("v1") || !auth[1].matches("[0-9]{10,11}") || !auth[2].matches("[A-Za-z0-9_-]{22}") || !auth[3].matches("[A-Za-z0-9_-]{43}")) return false;
        long now = System.currentTimeMillis() / 1000, timestamp = Long.parseLong(auth[1]);
        if (Math.abs(now - timestamp) > 30) return false;
        String expected = hmac(controlKey, "/control\n" + auth[1] + "\n" + auth[2] + "\n" + payload);
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII), auth[3].getBytes(StandardCharsets.US_ASCII))) return false;
        Iterator<Map.Entry<String, Long>> it = controlNonces.entrySet().iterator();
        while (it.hasNext()) if (now - it.next().getValue() > 60) it.remove();
        if (controlNonces.containsKey(auth[2])) return false;
        if (controlNonces.size() >= 128) controlNonces.remove(controlNonces.keySet().iterator().next());
        controlNonces.put(auth[2], now); return true;
    }
    static String hmac(String key, String payload) {
        try { Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(Base64.getUrlDecoder().decode(key), "HmacSHA256")); return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException("CONTROL_CRYPTO_UNAVAILABLE"); }
    }
    private String readBody(HttpExchange exchange) throws IOException, BioFailure {
        String length = exchange.getRequestHeaders().getFirst("Content-Length");
        if (length != null && Long.parseLong(length) > MAX_BODY) throw new BioFailure("REQUEST_TOO_LARGE", "Solicitação excedeu o tamanho permitido.", 413);
        ByteArrayOutputStream body = new ByteArrayOutputStream(); byte[] buffer = new byte[2048]; int n;
        while ((n = exchange.getRequestBody().read(buffer)) != -1) { if (body.size() + n > MAX_BODY) throw new BioFailure("REQUEST_TOO_LARGE", "Solicitação excedeu o tamanho permitido.", 413); body.write(buffer, 0, n); }
        return new String(body.toByteArray(), StandardCharsets.UTF_8);
    }
    private static String text(Map<String, Object> body, String name, String defaultValue) { Object value = body.get(name); if (value == null) return defaultValue; if (!(value instanceof String)) throw new IllegalArgumentException("STRING_REQUIRED"); return (String)value; }
    private void responseHeaders(HttpExchange exchange) {
        Headers headers = exchange.getResponseHeaders(); String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin != null && allowedOrigin(origin) && !exchange.getRequestURI().getPath().equals("/control")) {
            headers.set("Access-Control-Allow-Origin", origin); headers.set("Vary", "Origin");
            headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); headers.set("Access-Control-Allow-Headers", "Content-Type, X-JP-EntregaEPI");
            if (exchange.getRequestMethod().equals("OPTIONS") && "true".equals(exchange.getRequestHeaders().getFirst("Access-Control-Request-Private-Network"))) headers.set("Access-Control-Allow-Private-Network", "true");
        }
        headers.set("Cache-Control", "no-store"); headers.set("X-Content-Type-Options", "nosniff"); headers.set("X-Frame-Options", "DENY");
    }
    private void json(HttpExchange exchange, int status, Map<String, Object> body) throws IOException { bytes(exchange, status, Json.encode(body).getBytes(StandardCharsets.UTF_8), "application/json; charset=utf-8"); }
    private void error(HttpExchange exchange, int status, String code, String message) throws IOException { json(exchange, status, map("ok", false, "version", VERSION, "errorCode", code, "message", message)); }
    private void bytes(HttpExchange exchange, int status, byte[] body, String type) throws IOException { responseHeaders(exchange); exchange.getResponseHeaders().set("Content-Type", type); exchange.sendResponseHeaders(status, body.length); exchange.getResponseBody().write(body); }
    private void debug(HttpExchange exchange) throws IOException {
        String nonce = UUID.randomUUID().toString();
        exchange.getResponseHeaders().set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'");
        String html = "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>JP Biometria</title>"
            + "<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:20px;color:#15382c}button{padding:12px;margin:5px}pre{white-space:pre-wrap}img{max-width:250px}</style>"
            + "<h1>JP Biometria 12.8.1</h1><p>Teste local de conexão e captura. A imagem aparece apenas nesta janela e não é salva.</p>"
            + "<button id='status'>Verificar leitor</button><button id='capture'>Testar captura</button><pre id='result'>Clique em Verificar leitor.</pre><img id='image' alt='Captura do leitor' hidden>"
            + "<script nonce='" + nonce + "'>const out=document.getElementById('result'),img=document.getElementById('image');"
            + "document.getElementById('status').onclick=async()=>{try{const r=await fetch('/status',{cache:'no-store'}),j=await r.json();out.textContent=j.message+'\\nVersão: '+j.version+'\\nSDK: '+j.sdk+' | Leitor: '+j.reader;}catch(e){out.textContent='Não foi possível consultar o serviço.'}};"
            + "document.getElementById('capture').onclick=async function(){this.disabled=true;img.hidden=true;img.removeAttribute('src');out.textContent='Posicione o dedo no leitor.';try{const r=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({purpose:'test',requireTemplate:false})}),j=await r.json();out.textContent=j.message;if(r.ok&&j.ok&&j.realFingerImage){img.src=j.fingerImageDataUrl;img.hidden=false}}catch(e){out.textContent='A captura não foi concluída.'}finally{this.disabled=false}};</script></html>";
        bytes(exchange, 200, html.getBytes(StandardCharsets.UTF_8), "text/html; charset=utf-8");
    }
    static Map<String, Object> map(Object... pairs) { Map<String, Object> out = new LinkedHashMap<>(); for (int i = 0; i < pairs.length; i += 2) out.put((String)pairs[i], pairs[i+1]); return out; }
    public void close() { if (closed.compareAndSet(false, true)) { shuttingDown = true; server.stop(0); requests.shutdownNow(); sdk.shutdownNow(); stopped.countDown(); } }
    public static void main(String[] args) throws Exception {
        String keyFile = System.getProperty("jp.control.file", "");
        if (keyFile.isEmpty()) throw new IllegalArgumentException("A chave privada de controle local não foi configurada.");
        String key = new String(Files.readAllBytes(Paths.get(keyFile)), StandardCharsets.US_ASCII).trim();
        Path root = pathProperty("jp.sdk.root"), bin = pathProperty("jp.sdk.bin");
        BioReader reader = new NitgenReader(root, bin, System.getProperty("jp.runtime.problem", ""));
        int port = Integer.parseInt(System.getProperty("jp.port", "8789"));
        JPBiometriaAgent agent = new JPBiometriaAgent(port, key, System.getProperty("jp.build.sha", "development"), reader);
        Runtime.getRuntime().addShutdownHook(new Thread(agent::close));
        agent.start(); agent.stopped.await(); System.exit(0);
    }
    private static Path pathProperty(String name) { String value = System.getProperty(name, ""); return value.isEmpty() ? null : Paths.get(value); }
}
