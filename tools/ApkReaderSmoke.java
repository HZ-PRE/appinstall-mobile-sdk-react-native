import com.appinstall.internal.walle.PayloadReader;
import java.io.File;
/** Read the exact native SDK reader against a signed APK stamped by the official CLI. */
public final class ApkReaderSmoke {
    public static void main(String[] args) {
        String plain = PayloadReader.getString(new File(args[0]), 0x71777777);
        String stamped = PayloadReader.getString(new File(args[1]), 0x71777777);
        if (plain != null) throw new AssertionError("Base fixture already has channel data");
        if (stamped == null || !stamped.contains("\"channel\":\"" + args[2] + "\"")) {
            throw new AssertionError("SDK cannot read the Walle credential");
        }
        System.out.println("PASS: native APK reader reads the dedicated credential from a signed APK");
    }
}
