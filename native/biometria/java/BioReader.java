import java.util.Map;

interface BioReader {
    Map<String, Object> probe();
    Map<String, Object> capture(String finger, String purpose) throws BioFailure;
}

final class BioFailure extends Exception {
    final String code;
    final int httpStatus;
    BioFailure(String code, String message, int status) { super(message); this.code = code; this.httpStatus = status; }
}
