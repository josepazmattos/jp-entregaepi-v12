import java.util.Map;

interface BioReader {
    Map<String, Object> probe();
    default Map<String,Object> enroll(String finger) throws BioFailure { throw new BioFailure("TEMPLATES_NOT_SUPPORTED","Atualize o componente biométrico.",501); }
    default Map<String,Object> verify(String finger,String template) throws BioFailure { throw new BioFailure("BIOMETRIC_MATCH_NOT_SUPPORTED","Atualize o componente biométrico.",501); }
    Map<String, Object> capture(String finger, String purpose) throws BioFailure;
}

final class BioFailure extends Exception {
    final String code;
    final int httpStatus;
    BioFailure(String code, String message, int status) { super(message); this.code = code; this.httpStatus = status; }
}
