import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Initialization/enumeration only. Never captures a finger or reads templates. */
public final class RuntimeProbe {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("PROBE_ARGUMENTS");
        NitgenReader reader = new NitgenReader(Paths.get(System.getProperty("jp.sdk.root")),
            Paths.get(System.getProperty("jp.sdk.bin")), "");
        Map<String,Object> status = reader.probe();
        // Whitelist output: discard native stdout/stderr and never persist biometric data.
        String code = String.valueOf(status.get("errorCode"));
        boolean initialized = Boolean.TRUE.equals(status.get("ok")) || "READER_NOT_FOUND".equals(code);
        String json = Json.encode(JPBiometriaAgent.map("initialized", initialized,
            "reader", Boolean.TRUE.equals(status.get("reader")), "code", code));
        Files.write(Paths.get(args[0]), json.getBytes(StandardCharsets.UTF_8), StandardOpenOption.TRUNCATE_EXISTING);
    }
}
