import java.awt.image.BufferedImage;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** SDK adapter; no vendor code or binaries are redistributed. */
final class NitgenReader implements BioReader {
    static { ImageIO.setUseCache(false); }
    private static final String BSP = "com.nitgen.SDK.BSP.NBioBSPJNI";
    private final Path root, bin;
    private final String runtimeProblem;
    private Class<?> sdkClass;
    NitgenReader(Path root, Path bin, String runtimeProblem) { this.root = root; this.bin = bin; this.runtimeProblem = runtimeProblem; }

    public Map<String, Object> probe() {
        Map<String, Object> result = JPBiometriaAgent.map("ok", false, "sdk", false, "reader", false,
            "deviceCount", 0, "deviceName", "", "javaArch", System.getProperty("os.arch"), "checkedAt", Instant.now().toString());
        Object bsp = null, devices = null;
        try {
            load(); result.put("sdk", true); bsp = sdkClass.getConstructor().newInstance(); checkError(bsp, "Initialize");
            devices = inner(bsp, BSP + "$DEVICE_ENUM_INFO"); invoke(bsp, "EnumerateDevice", devices); checkError(bsp, "EnumerateDevice");
            int count = integer(devices, "DeviceCount");
            result.put("deviceCount", Math.max(0, count)); result.put("reader", count > 0); result.put("ok", count > 0);
            result.put("deviceName", count > 0 ? readerName(devices) : "");
            result.put("errorCode", count > 0 ? "" : "READER_NOT_FOUND");
            result.put("message", count > 0 ? "Leitor NITGEN localizado. Pronto para testar a captura." : "SDK disponível. Conecte o leitor e feche outros programas que estejam usando a captura.");
        } catch (Throwable e) {
            BioFailure f = failure(e); result.put("errorCode", f.code); result.put("message", f.getMessage());
        } finally { dispose(devices); dispose(bsp); }
        return result;
    }

    public Map<String, Object> capture(String finger, String purpose) throws BioFailure {
        return perform(finger,purpose,null);
    }
    public Map<String,Object> enroll(String finger) throws BioFailure { return perform(finger,"enroll",null); }
    public Map<String,Object> verify(String finger,String template) throws BioFailure { return perform(finger,"verify",template); }
    private Map<String,Object> perform(String finger,String purpose,String storedTemplate) throws BioFailure {
        Object bsp = null, devices = null, fir = null, audit = null, input = null, exporter = null, textFir = null, stored = null, captured = null, payload = null;
        boolean opened = false;
        try {
            load(); bsp = sdkClass.getConstructor().newInstance(); checkError(bsp, "Initialize");
            devices = inner(bsp, BSP + "$DEVICE_ENUM_INFO"); invoke(bsp, "EnumerateDevice", devices); checkError(bsp, "EnumerateDevice");
            if (integer(devices, "DeviceCount") < 1) throw new BioFailure("READER_NOT_FOUND", "O SDK não localizou o leitor NITGEN.", 503);
            openDevice(bsp, devices); opened = true;
            fir = inner(bsp, BSP + "$FIR_HANDLE"); audit = inner(bsp, BSP + "$FIR_HANDLE");
            Object window = windowOptions(bsp);
            // Capture VERIFY with an audit handle is documented by the original Java SDK sample.
            int verifyPurpose = sdkClass.getClassLoader().loadClass(BSP + "$FIR_PURPOSE").getField("VERIFY").getInt(null);
            invoke(bsp, "Capture", verifyPurpose, fir, 15000, audit, window); checkError(bsp, "Capture");
            input = inner(bsp, BSP + "$INPUT_FIR"); invoke(input, "SetFIRHandle", audit);
            exporter = inner(bsp, BSP + "$Export"); checkError(bsp, "InitializeExport"); Object data = inner(exporter, BSP + "$Export$AUDIT");
            invoke(exporter, "ExportAudit", input, data); checkError(bsp, "ExportAudit");
            if (purpose.equals("enroll")) {
                textFir=inner(bsp,BSP+"$FIR_TEXTENCODE");invoke(bsp,"GetTextFIRFromHandle",fir,textFir);checkError(bsp,"GetTextFIRFromHandle");
                String template=(String)field(textFir,"TextFIR");
                if(template==null||template.length()<40||template.length()>120000)throw new BioFailure("TEMPLATE_INVALID","O SDK não retornou o template biométrico.",422);
                return JPBiometriaAgent.map("ok",true,"template",template,"fingerImageDataUrl",imageFromExport(data).dataUrl);
            }
            if (purpose.equals("verify")) {
                textFir=inner(bsp,BSP+"$FIR_TEXTENCODE");textFir.getClass().getField("TextFIR").set(textFir,storedTemplate);
                stored=inner(bsp,BSP+"$INPUT_FIR");invoke(stored,"SetTextFIR",textFir);
                captured=inner(bsp,BSP+"$INPUT_FIR");invoke(captured,"SetFIRHandle",fir);
                payload=inner(bsp,BSP+"$FIR_PAYLOAD");
                // The vendor JNI fills this dedicated Boolean, as in its official Java sample.
                Boolean matched=new Boolean(false);
                invoke(bsp,"VerifyMatch",captured,stored,matched,payload);checkError(bsp,"VerifyMatch");
                if(!matched.booleanValue())throw new BioFailure("BIOMETRIA_DIVERGENTE","A digital não corresponde ao dedo cadastrado. A ficha continua sem assinatura.",422);
            }
            ImageResult image = imageFromExport(data);
            Object quality = quality(bsp, fir);
            return JPBiometriaAgent.map("ok", true, "sdk", true, "reader", true, "realFingerImage", true,
                "matched", purpose.equals("verify"), "biometricVerified", purpose.equals("verify"), "fingerCode", finger, "fingerSelectionVerified", false,
                "imageSource", "NITGEN_EXPORT_AUDIT", "imageWidth", image.width, "imageHeight", image.height,
                "fingerImageDataUrl", image.dataUrl, "quality", quality, "auditId", "CAP-" + UUID.randomUUID(),
                "capturedAt", Instant.now().toString(), "message", "Imagem capturada pelo NITGEN. Esta operação não compara identidade biométrica.");
        } catch (Throwable e) { throw failure(e); }
        finally {
            dispose(payload);dispose(captured);dispose(stored);dispose(textFir);
            dispose(input); dispose(exporter); dispose(audit); dispose(fir); dispose(devices);
            if (opened) try { invoke(bsp, "CloseDevice"); } catch (Throwable ignored) { }
            dispose(bsp);
        }
    }

    private synchronized void load() throws Exception {
        if (sdkClass != null) return;
        if (!runtimeProblem.isEmpty()) throw new BioFailure(runtimeProblem, runtimeMessage(runtimeProblem), 503);
        if (!System.getProperty("os.name", "").startsWith("Windows")) throw new BioFailure("WINDOWS_REQUIRED", "A captura NITGEN está disponível no Windows conectado ao leitor.", 503);
        if (root == null || bin == null || !Files.isRegularFile(root.resolve("Lib").resolve("NBioBSPJNI.jar")))
            throw new BioFailure("SDK_NOT_FOUND", "O driver pode estar instalado, mas o SDK eNBioBSP com o componente Java não foi localizado.", 503);
        for (String dll : new String[]{"NBioBSP.dll", "NBioBSPJNI.dll"}) {
            Path path = bin.resolve(dll); if (!Files.isRegularFile(path)) throw new BioFailure("SDK_DLL_NOT_FOUND", "Uma biblioteca necessária do SDK NITGEN não foi localizada.", 503);
            System.load(path.toAbsolutePath().toString());
        }
        sdkClass = Class.forName(BSP);
    }
    static String runtimeMessage(String code) {
        if (code.equals("JAVA_NOT_FOUND")) return "Java compatível não localizado. O reparador preservou o driver NITGEN instalado.";
        if (code.equals("JAVA_ARCH_MISMATCH")) return "Java e SDK NITGEN possuem arquiteturas diferentes. É necessário Java compatível com as bibliotecas do SDK.";
        if (code.equals("SDK_ARCH_MISMATCH")) return "As bibliotecas NITGEN encontradas possuem arquiteturas incompatíveis entre si.";
        return "O SDK eNBioBSP com NBioBSPJNI.jar não foi localizado. O driver do leitor foi preservado.";
    }
    private static void openDevice(Object bsp, Object devices) throws Exception {
        try { method(bsp, "OpenDevice", new Object[0]); invoke(bsp, "OpenDevice"); checkError(bsp, "OpenDevice"); return; }
        catch (NoSuchMethodException e) {
            Object first = first(field(devices, "DeviceInfo"));
            invoke(bsp, "OpenDevice", integer(first, "NameID"), integer(first, "Instance")); checkError(bsp, "OpenDevice");
        }
    }
    private static Object windowOptions(Object bsp) {
        try {
            Object window = inner(bsp, BSP + "$WINDOW_OPTION");
            Object invisible = Class.forName(BSP + "$WINDOW_STYLE").getField("INVISIBLE").get(null);
            Field style = window.getClass().getField("WindowStyle"); style.set(window, convert(invisible, style.getType()));
            return window;
        } catch (Throwable ignored) { return null; }
    }
    private static Object quality(Object bsp, Object handle) {
        Object fir = null;
        try { fir = inner(bsp, BSP + "$FIR"); invoke(bsp, "GetFIRFromHandle", handle, fir); checkError(bsp, "GetFIRFromHandle");
            int quality = integer(field(fir, "Header"), "Quality"); return quality >= 0 && quality <= 100 ? quality : null;
        } catch (Throwable ignored) { return null; } finally { dispose(fir); }
    }
    static final class ImageResult {
        final int width, height; final String dataUrl;
        ImageResult(int w, int h, String url) { width = w; height = h; dataUrl = url; }
    }
    /** Exact SDK schema: Export.AUDIT.ImageWidth/ImageHeight/FingerData[].Template[].Data. */
    static ImageResult imageFromExport(Object data) throws Exception {
        int width = integer(data, "ImageWidth"), height = integer(data, "ImageHeight");
        if (width < 32 || height < 32 || width > 2048 || height > 2048) throw new BioFailure("IMAGE_DIMENSIONS_INVALID", "O SDK retornou dimensões de imagem inválidas.", 422);
        Object finger = first(field(data, "FingerData")); Object template = first(field(finger, "Template"));
        Object value = field(template, "Data");
        if (!(value instanceof byte[])) throw new BioFailure("IMAGE_DATA_INVALID", "O SDK não retornou os pixels da captura.", 422);
        byte[] raw = (byte[])value;
        BufferedImage image;
        if (raw.length == width * height) {
            image = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_GRAY);
            image.getRaster().setDataElements(0, 0, width, height, raw);
        } else {
            // Only a genuinely encoded image can be accepted when byte count is not raw width*height.
            if (raw.length > 1024 * 1024 || !encodedImage(raw)) throw new BioFailure("IMAGE_DATA_INVALID", "O tamanho da imagem retornada pelo SDK não corresponde às dimensões. A captura não foi aproveitada.", 422);
            try (MemoryCacheImageInputStream input = new MemoryCacheImageInputStream(new ByteArrayInputStream(raw))) {
                Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw new BioFailure("IMAGE_DATA_INVALID", "A imagem retornada pelo SDK não pôde ser validada.", 422);
                ImageReader decoder = readers.next();
                try {
                    decoder.setInput(input, true, true);
                    if (decoder.getWidth(0) != width || decoder.getHeight(0) != height) throw new BioFailure("IMAGE_DATA_INVALID", "A imagem retornada pelo SDK não corresponde às dimensões informadas.", 422);
                    image = decoder.read(0);
                } finally { decoder.dispose(); }
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (MemoryCacheImageOutputStream memory = new MemoryCacheImageOutputStream(out)) {
            if (!ImageIO.write(image, "png", memory)) throw new BioFailure("IMAGE_DATA_INVALID", "Não foi possível converter a imagem da captura.", 422);
            memory.flush();
        }
        if (out.size() > 150 * 1024) throw new BioFailure("IMAGE_TOO_LARGE", "A captura excedeu o tamanho suportado.", 422);
        return new ImageResult(width, height, "data:image/png;base64," + Base64.getEncoder().encodeToString(out.toByteArray()));
    }
    private static boolean encodedImage(byte[] b) {
        return b.length >= 8 && ((b[0] == (byte)137 && b[1] == 80 && b[2] == 78 && b[3] == 71 && b[4] == 13 && b[5] == 10 && b[6] == 26 && b[7] == 10)
            || (b[0] == (byte)255 && b[1] == (byte)216 && b[2] == (byte)255));
    }
    private static String readerName(Object devices) {
        try { Object d = first(field(devices, "DeviceInfo")); for (String n : new String[]{"Name", "Description"}) {
            try { String s = String.valueOf(field(d, n)); if (!s.isEmpty() && !s.equals("null")) return s; } catch (Throwable ignored) { }
        } } catch (Throwable ignored) { }
        return "Leitor NITGEN";
    }
    private static void checkError(Object bsp, String operation) throws Exception {
        if (Boolean.TRUE.equals(invoke(bsp, "IsErrorOccured"))) {
            Object code = invoke(bsp, "GetErrorCode");
            throw new BioFailure("NITGEN_" + String.valueOf(code).replaceAll("[^0-9]", ""), "O SDK NITGEN não concluiu " + operation + ". Código: " + code + ". Feche o utilitário de diagnóstico e tente novamente.", 422);
        }
    }
    private static BioFailure failure(Throwable e) {
        while (e instanceof InvocationTargetException && ((InvocationTargetException)e).getTargetException() != null) e = ((InvocationTargetException)e).getTargetException();
        if (e instanceof BioFailure) return (BioFailure)e;
        if (e instanceof UnsatisfiedLinkError || e instanceof NoClassDefFoundError) return new BioFailure("SDK_LOAD_FAILED", "Não foi possível carregar o SDK NITGEN. Verifique Java e bibliotecas da mesma arquitetura.", 503);
        if (e instanceof ReflectiveOperationException) return new BioFailure("SDK_API_INCOMPATIBLE", "O SDK instalado não oferece o método ou formato de imagem esperado pela integração Java.", 503);
        return new BioFailure("CAPTURE_FAILED", "A captura não foi concluída pelo SDK NITGEN. Feche outros programas de captura e tente novamente.", 503);
    }
    private static Object first(Object a) throws BioFailure { if (a == null || !a.getClass().isArray() || Array.getLength(a) < 1) throw new BioFailure("IMAGE_DATA_MISSING", "O SDK retornou uma captura sem imagem.", 422); return Array.get(a, 0); }
    private static Object field(Object target, String name) throws Exception { return target.getClass().getField(name).get(target); }
    private static int integer(Object target, String name) throws Exception { Object n = field(target, name); if (!(n instanceof Number)) throw new NoSuchFieldException(name); return ((Number)n).intValue(); }
    private static Object inner(Object outer, String name) throws Exception {
        Class<?> c = Class.forName(name);
        for (Constructor<?> constructor : c.getConstructors()) {
            Class<?>[] types = constructor.getParameterTypes();
            if (types.length == 1 && types[0].isInstance(outer)) return constructor.newInstance(outer);
            if (types.length == 0) return constructor.newInstance();
        }
        throw new NoSuchMethodException(name);
    }
    private static Method method(Object target, String name, Object[] args) throws Exception {
        for (Method m : target.getClass().getMethods()) {
            if (!m.getName().equals(name) || m.getParameterTypes().length != args.length) continue;
            try { for (int i = 0; i < args.length; i++) convert(args[i], m.getParameterTypes()[i]); return m; } catch (IllegalArgumentException ignored) { }
        }
        throw new NoSuchMethodException(name);
    }
    private static Object invoke(Object target, String name, Object... args) throws Exception {
        Method m = method(target, name, args); Object[] converted = new Object[args.length];
        for (int i = 0; i < args.length; i++) converted[i] = convert(args[i], m.getParameterTypes()[i]);
        return m.invoke(target, converted);
    }
    private static Object convert(Object value, Class<?> type) {
        if (value == null && !type.isPrimitive()) return null;
        if (value != null && type.isInstance(value)) return value;
        if (value instanceof Number) { Number n = (Number)value;
            if (type == int.class || type == Integer.class) return n.intValue(); if (type == short.class || type == Short.class) return n.shortValue();
            if (type == long.class || type == Long.class) return n.longValue(); if (type == byte.class || type == Byte.class) return n.byteValue();
        }
        if ((type == boolean.class || type == Boolean.class) && value instanceof Boolean) return value;
        throw new IllegalArgumentException("SDK_ARGUMENT_INCOMPATIBLE");
    }
    private static void dispose(Object value) { if (value != null) try { invoke(value, "dispose"); } catch (Throwable ignored) { } }
}
