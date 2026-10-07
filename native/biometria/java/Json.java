import java.util.*;

/** Small strict JSON codec. Requests are flat objects; biometric bodies are never logged. */
final class Json {
    private Json() {}
    static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return String.valueOf(value);
        if (value instanceof Map) {
            StringBuilder out = new StringBuilder("{"); boolean comma = false;
            for (Object entry : ((Map<?, ?>) value).entrySet()) {
                Map.Entry<?, ?> e = (Map.Entry<?, ?>) entry;
                if (comma) out.append(','); comma = true;
                out.append(encode(String.valueOf(e.getKey()))).append(':').append(encode(e.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof Iterable) {
            StringBuilder out = new StringBuilder("["); boolean comma = false;
            for (Object item : (Iterable<?>) value) { if (comma) out.append(','); comma = true; out.append(encode(item)); }
            return out.append(']').toString();
        }
        StringBuilder out = new StringBuilder("\"");
        for (char c : String.valueOf(value).toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default: if (c < 32) out.append(String.format("\\u%04x", (int)c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    static Map<String, Object> object(String text) {
        Parser p = new Parser(text); Map<String, Object> result = p.object(); p.ws();
        if (p.i != p.s.length()) throw new IllegalArgumentException("JSON_TRAILING_DATA");
        return result;
    }
    static final class Parser {
        final String s; int i;
        Parser(String s) { this.s = s; }
        void ws() { while (i < s.length() && " \n\r\t".indexOf(s.charAt(i)) >= 0) i++; }
        void require(char c) { ws(); if (i >= s.length() || s.charAt(i++) != c) throw new IllegalArgumentException("JSON_INVALID"); }
        Map<String, Object> object() {
            require('{'); Map<String, Object> m = new LinkedHashMap<>(); ws();
            if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
            for (;;) {
                String key = string(); if (m.containsKey(key)) throw new IllegalArgumentException("JSON_DUPLICATE_KEY");
                require(':'); m.put(key, value()); ws();
                if (i >= s.length()) throw new IllegalArgumentException("JSON_INVALID");
                char c = s.charAt(i++); if (c == '}') return m; if (c != ',') throw new IllegalArgumentException("JSON_INVALID");
            }
        }
        Object value() {
            ws(); if (i >= s.length()) throw new IllegalArgumentException("JSON_INVALID");
            if (s.charAt(i) == '"') return string();
            for (String v : new String[]{"true", "false", "null"}) {
                if (s.startsWith(v, i)) { i += v.length(); return v.equals("null") ? null : Boolean.valueOf(v); }
            }
            int start = i; if (s.charAt(i) == '-') i++;
            while (i < s.length() && Character.isDigit(s.charAt(i))) i++;
            String n = s.substring(start, i);
            if (!n.matches("-?(0|[1-9][0-9]*)")) throw new IllegalArgumentException("JSON_SCALAR_REQUIRED");
            try { return Long.valueOf(n); } catch (NumberFormatException e) { throw new IllegalArgumentException("JSON_NUMBER_INVALID"); }
        }
        String string() {
            require('"'); StringBuilder out = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i++); if (c == '"') return out.toString();
                if (c < 32) throw new IllegalArgumentException("JSON_INVALID_STRING");
                if (c != '\\') { out.append(c); continue; }
                if (i >= s.length()) break; c = s.charAt(i++);
                switch (c) {
                    case '"': case '\\': case '/': out.append(c); break;
                    case 'b': out.append('\b'); break; case 'f': out.append('\f'); break;
                    case 'n': out.append('\n'); break; case 'r': out.append('\r'); break; case 't': out.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new IllegalArgumentException("JSON_INVALID_ESCAPE");
                        if (!s.substring(i, i + 4).matches("[0-9a-fA-F]{4}")) throw new IllegalArgumentException("JSON_INVALID_ESCAPE");
                        try { out.append((char)Integer.parseInt(s.substring(i, i + 4), 16)); } catch (NumberFormatException e) { throw new IllegalArgumentException("JSON_INVALID_ESCAPE"); }
                        i += 4; break;
                    default: throw new IllegalArgumentException("JSON_INVALID_ESCAPE");
                }
            }
            throw new IllegalArgumentException("JSON_UNTERMINATED_STRING");
        }
    }
}
