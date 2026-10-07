package main

// The launcher installs only JP code. It never downloads a runtime, SDK or driver.
import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"debug/pe"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const version = "12.8.2"
const firstPort, lastPort = 8789, 8799
const installedName, jarName = "JPBiometria.exe", "JPBiometriaAgent.jar"

var buildSHA = "development"

//go:embed payload/JPBiometriaAgent.jar
var agentJar []byte

type sdkLocation struct{ Root, Bin, Arch string }
type javaRuntime struct {
	Path, Arch string
	Major      int
}
type runtimeSelection struct {
	Java    javaRuntime
	SDK     sdkLocation
	Problem string
}
type controlResponse struct {
	OK         bool   `json:"ok"`
	Owned      bool   `json:"owned"`
	Version    string `json:"version"`
	BuildSHA   string `json:"buildSha"`
	InstanceID string `json:"instanceId"`
	Port       int    `json:"port"`
	Proof      string `json:"proof"`
	ErrorCode  string `json:"errorCode"`
}
type launchResult struct {
	Port   int
	Status map[string]any
}

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var allowedWebOrigins = map[string]bool{"https://www.jptreinamentos.com.br": true, "https://jptreinamentos.com.br": true}

func main() {
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "--diagnostic-agent" {
		if err := runDiagnosticArgs(args[1:]); err != nil {
			os.Exit(1)
		}
		return
	}
	quiet := len(args) > 0 && args[0] == "--install-quiet"
	mode, err := parseMode(args)
	if err != nil {
		failMain(err.Error(), quiet)
	}
	if err := requireWindows(); err != nil {
		failMain(err.Error(), quiet)
	}
	dir, err := installDirectory()
	if err != nil {
		failMain(err.Error(), quiet)
	}
	release, err := launcherMutex(dir)
	if err != nil {
		failMain("Já existe uma inicialização ou reparo em andamento. Aguarde a conclusão.", quiet)
	}
	defer release()
	if mode == "start" {
		key, err := readControlKey(dir)
		if err == nil {
			_, err = startAgent(dir, key)
		}
		if err != nil {
			failMain("Não foi possível iniciar a ponte JP Biometria. Execute o reparador 12.8.2.\n\n"+err.Error(), quiet)
		}
		return
	}
	result, err := install(dir)
	if err != nil {
		failMain("O reparo não foi concluído.\n\n"+err.Error(), quiet)
	}
	if quiet {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "version": version, "buildSha": buildSHA, "port": result.Port})
		return
	}
	message, _ := result.Status["message"].(string)
	if message == "" {
		message = "A verificação do SDK e do leitor ainda está em andamento."
	}
	notifyUser(fmt.Sprintf("JP Biometria %s instalado e iniciado na porta %d.\n\n%s\n\nAbra o aplicativo JP, clique em Verificar leitor e depois em Testar captura. A instalação não confirma uma captura física.", version, result.Port, message), false)
}
func failMain(message string, quiet bool) {
	if quiet {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": false, "version": version, "buildSha": buildSHA, "message": message})
	} else {
		notifyUser(message, true)
	}
	os.Exit(1)
}
func parseMode(args []string) (string, error) {
	if len(args) == 0 {
		return "install", nil
	}
	if len(args) == 1 && args[0] == "--install-quiet" {
		return "install-quiet", nil
	}
	if len(args) >= 1 && len(args) <= 2 && args[0] == "--start" && (len(args) == 1 || validStartURI(args[1])) {
		return "start", nil
	}
	return "", errors.New("Argumentos de inicialização não reconhecidos.")
}

func installDirectory() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" || !filepath.IsAbs(base) {
		return "", errors.New("A pasta local do usuário do Windows não foi localizada.")
	}
	return filepath.Join(base, "JP", "Biometria"), nil
}
func validStartURI(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && strings.EqualFold(u.Scheme, "jpbiometria") && strings.EqualFold(u.Host, "start") && (u.Path == "" || u.Path == "/") && u.User == nil && u.Fragment == ""
}
func install(dir string) (launchResult, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return launchResult{}, fmt.Errorf("Não foi possível criar a pasta do componente: %w", err)
	}
	if err := protectInstallDirectory(dir); err != nil {
		return launchResult{}, fmt.Errorf("Não foi possível proteger a configuração local: %w", err)
	}
	key, err := loadOrCreateKey(dir)
	if err != nil {
		return launchResult{}, err
	}
	// Authenticate each owned instance. Foreign/legacy listeners are never stopped.
	for _, owned := range ownedAgents(key) {
		if err := stopOwned(owned.Port, key); err != nil {
			return launchResult{}, err
		}
	}
	executable, err := os.Executable()
	if err != nil {
		return launchResult{}, err
	}
	dest := filepath.Join(dir, installedName)
	if !samePath(executable, dest) {
		if err := copyFileAtomic(executable, dest, 0700); err != nil {
			return launchResult{}, fmt.Errorf("Não foi possível atualizar o inicializador: %w", err)
		}
	}
	if err := writeAtomic(filepath.Join(dir, jarName), agentJar, 0600); err != nil {
		return launchResult{}, fmt.Errorf("Não foi possível gravar o agente Java: %w", err)
	}
	if err := registerLauncher(dest); err != nil {
		return launchResult{}, fmt.Errorf("Não foi possível registrar o protocolo e a inicialização do usuário: %w", err)
	}
	return startAgent(dir, key)
}
func samePath(a, b string) bool {
	aa, errA := filepath.Abs(a)
	bb, errB := filepath.Abs(b)
	return errA == nil && errB == nil && strings.EqualFold(filepath.Clean(aa), filepath.Clean(bb))
}
func readControlKey(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, "control.key"))
	if err != nil {
		return "", errors.New("A configuração privada do agente não foi encontrada. Execute o reparador.")
	}
	key := strings.TrimSpace(string(data))
	decoded, decodeErr := base64.RawURLEncoding.DecodeString(key)
	if !keyPattern.MatchString(key) || decodeErr != nil || len(decoded) != 32 {
		return "", errors.New("A configuração privada do agente é inválida. O reparo foi interrompido para preservar a instância existente.")
	}
	return key, nil
}
func loadOrCreateKey(dir string) (string, error) {
	if _, err := os.Stat(filepath.Join(dir, "control.key")); err == nil {
		return readControlKey(dir)
	} else if !os.IsNotExist(err) {
		return "", err
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	key := base64.RawURLEncoding.EncodeToString(random)
	if err := writeAtomic(filepath.Join(dir, "control.key"), []byte(key+"\n"), 0600); err != nil {
		return "", err
	}
	return key, nil
}
func writeAtomic(path string, data []byte, mode os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".jp-write-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(mode); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	// MoveFileEx on Windows replaces atomically; this never deletes a locked running file.
	for attempt := 0; attempt < 10; attempt++ {
		err = replaceFile(name, path)
		if err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}
func copyFileAtomic(source, dest string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return writeAtomic(dest, data, mode)
}

func requestMAC(key, data string) string {
	raw, _ := base64.RawURLEncoding.DecodeString(key)
	mac := hmac.New(sha256.New, raw)
	mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func controlAt(port int, key, command string) (controlResponse, error) {
	var out controlResponse
	if port < firstPort || port > lastPort || !keyPattern.MatchString(key) || command != "ping" && command != "shutdown" {
		return out, errors.New("invalid local control request")
	}
	nonceBytes := make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		return out, err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	stamp := strconv.FormatInt(time.Now().Unix(), 10)
	payload := `{"command":"` + command + `"}`
	request, _ := http.NewRequest("POST", localURL(port, "/control"), strings.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-JP-Control", "v1:"+stamp+":"+nonce+":"+requestMAC(key, "/control\n"+stamp+"\n"+nonce+"\n"+payload))
	response, err := localClient(800 * time.Millisecond).Do(request)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err = json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&out); err != nil {
		return out, err
	}
	if response.StatusCode == 409 && out.ErrorCode == "READER_BUSY" {
		return out, errors.New("Aguarde a conclusão da captura ou verificação do leitor antes de reparar.")
	}
	if response.StatusCode != 200 || !out.OK || !out.Owned || out.Port != port || out.InstanceID == "" {
		return out, errors.New("agent ownership not established")
	}
	expected := requestMAC(key, "response\n"+stamp+"\n"+nonce+"\n"+command+"\n"+out.InstanceID+"\n"+out.Version+"\n"+strconv.Itoa(port)+"\n"+out.BuildSHA)
	if !hmac.Equal([]byte(expected), []byte(out.Proof)) {
		return out, errors.New("agent ownership proof invalid")
	}
	return out, nil
}
func localURL(port int, path string) string { return "http://127.0.0.1:" + strconv.Itoa(port) + path }
func localClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("local redirects are not allowed") }}
}
func ownedAgents(key string) []controlResponse {
	var list []controlResponse
	for port := firstPort; port <= lastPort; port++ {
		if owned, err := controlAt(port, key, "ping"); err == nil {
			list = append(list, owned)
		}
	}
	return list
}
func stopOwned(port int, key string) error {
	if _, err := controlAt(port, key, "ping"); err != nil {
		return errors.New("O agente não confirmou sua identidade. Nenhum processo foi encerrado.")
	}
	if _, err := controlAt(port, key, "shutdown"); err != nil {
		return fmt.Errorf("O agente não aceitou a parada segura: %w", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 150*time.Millisecond)
		if err != nil {
			return nil
		}
		connection.Close()
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("O agente não concluiu a parada. Nenhum processo foi encerrado à força. Aguarde e execute o reparador novamente.")
}
func availablePort() (int, error) {
	for port := firstPort; port <= lastPort; port++ {
		listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
		if err == nil {
			listener.Close()
			return port, nil
		}
	}
	return 0, errors.New("As portas locais 8789 a 8799 estão ocupadas. Nenhum dos programas que as utilizam foi encerrado.")
}
func readStatus(port int) (map[string]any, error) {
	response, err := localClient(1200 * time.Millisecond).Get(localURL(port, "/status"))
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("status unavailable")
	}
	var status map[string]any
	if err = json.NewDecoder(io.LimitReader(response.Body, 32768)).Decode(&status); err != nil {
		return nil, err
	}
	return status, nil
}
func startAgent(dir, key string) (launchResult, error) {
	ownedList := ownedAgents(key)
	for _, owned := range ownedList {
		if owned.Version == version && owned.BuildSHA == buildSHA {
			status, err := readStatus(owned.Port)
			if err == nil {
				if runtimeNeedsRefresh(status) && status["errorCode"] != discoverRuntime().Problem {
					// A SDK installed after startup must be rediscovered. Only stop the
					// authenticated JP instance; busy captures remain protected.
					if err := stopOwned(owned.Port, key); err != nil {
						return launchResult{}, err
					}
					continue
				}
				return launchResult{owned.Port, status}, nil
			}
		}
	}
	if len(ownedAgents(key)) > 0 {
		return launchResult{}, errors.New("Existe outra versão do agente JP em execução. Execute o reparador para atualizá-la com uma parada segura.")
	}
	if _, err := os.Stat(filepath.Join(dir, jarName)); err != nil {
		return launchResult{}, errors.New("O agente Java do aplicativo não está instalado. Execute o reparador.")
	}
	selection := discoverRuntime()
	port, err := availablePort()
	if err != nil {
		return launchResult{}, err
	}
	var cmd *exec.Cmd
	if selection.Java.Path != "" {
		cmd = exec.Command(selection.Java.Path, javaArguments(dir, port, selection)...)
		cmd.Env = environmentWith(os.Environ(), "PATH", selection.SDK.Bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	} else {
		cmd = exec.Command(filepath.Join(dir, installedName), "--diagnostic-agent", "--port", strconv.Itoa(port), "--problem", selection.Problem)
	}
	cmd.Dir = dir
	configureHidden(cmd)
	// The JVM's stdout/stderr are deliberately not persisted: native SDK output may include biometric data.
	if err = cmd.Start(); err != nil {
		return launchResult{}, errors.New("O processo do agente não iniciou. Verifique se o Java ou o componente foi bloqueado pelo Windows.")
	}
	finished := make(chan error, 1)
	go func() { finished <- cmd.Wait() }()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		if owned, controlErr := controlAt(port, key, "ping"); controlErr == nil && owned.Version == version && owned.BuildSHA == buildSHA {
			status, statusErr := readStatus(port)
			if statusErr == nil {
				// An available diagnostic bridge is a successful start; SDK readiness is a separate result.
				return launchResult{port, status}, nil
			}
		}
		select {
		case <-finished:
			return launchResult{}, errors.New("O agente encerrou antes de confirmar a conexão local. Confira a compatibilidade do Java e do SDK NITGEN.")
		default:
		}
		time.Sleep(150 * time.Millisecond)
	}
	return launchResult{}, errors.New("O agente não confirmou a inicialização no prazo previsto. Nenhum processo foi encerrado à força.")
}
func javaArguments(dir string, port int, selected runtimeSelection) []string {
	args := []string{"-Djp.control.file=" + filepath.Join(dir, "control.key"), "-Djp.port=" + strconv.Itoa(port), "-Djp.build.sha=" + buildSHA}
	classpath := filepath.Join(dir, jarName)
	if selected.Problem != "" {
		args = append(args, "-Djp.runtime.problem="+selected.Problem)
	}
	if selected.SDK.Root != "" {
		args = append(args, "-Djp.sdk.root="+selected.SDK.Root, "-Djp.sdk.bin="+selected.SDK.Bin, "-Djava.library.path="+selected.SDK.Bin)
		classpath += ";" + filepath.Join(selected.SDK.Root, "Lib", "NBioBSPJNI.jar")
	}
	return append(args, "-cp", classpath, "JPBiometriaAgent")
}
func environmentWith(env []string, name, value string) []string {
	out := make([]string, 0, len(env)+1)
	for _, entry := range env {
		key, _, found := strings.Cut(entry, "=")
		if !found || !strings.EqualFold(key, name) {
			out = append(out, entry)
		}
	}
	return append(out, name+"="+value)
}

func uniquePaths(paths []string) []string {
	seen := map[string]bool{}
	var result []string
	for _, path := range paths {
		if path == "" {
			continue
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			continue
		}
		abs = filepath.Clean(abs)
		key := strings.ToLower(abs)
		if !seen[key] {
			seen[key] = true
			result = append(result, abs)
		}
	}
	return result
}
func sdkRoots() []string {
	roots := []string{os.Getenv("JP_BIOMETRIA_SDK")}
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("ProgramW6432"), os.Getenv("SystemDrive") + string(os.PathSeparator)} {
		if base == "" || base == string(os.PathSeparator) {
			continue
		}
		for _, sdk := range []string{"eNBSP SDK Professional", "eNBioBSP SDK", "NBioBSP SDK"} {
			roots = append(roots, filepath.Join(base, "NITGEN", sdk, "SDK"))
		}
		roots = append(roots, filepath.Join(base, "NITGEN", "SDK"))
	}
	return uniquePaths(roots)
}
func discoverSDK(roots []string) ([]sdkLocation, string) {
	var locations []sdkLocation
	problem := "SDK_NOT_FOUND"
	for _, root := range uniquePaths(roots) {
		if !regularFile(filepath.Join(root, "Lib", "NBioBSPJNI.jar")) {
			continue
		}
		problem = "SDK_DLL_NOT_FOUND"
		for _, bin := range []string{filepath.Join(root, "Bin", "x64"), filepath.Join(root, "Bin"), filepath.Join(root, "Bin", "x86")} {
			archA, errA := peArchitecture(filepath.Join(bin, "NBioBSP.dll"))
			archB, errB := peArchitecture(filepath.Join(bin, "NBioBSPJNI.dll"))
			if errA != nil || errB != nil {
				continue
			}
			if archA != archB {
				problem = "SDK_ARCH_MISMATCH"
				continue
			}
			locations = append(locations, sdkLocation{root, bin, archA})
		}
	}
	if len(locations) > 0 {
		return locations, ""
	}
	return nil, problem
}
func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
func peArchitecture(path string) (string, error) {
	file, err := pe.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	switch file.Machine {
	case pe.IMAGE_FILE_MACHINE_I386:
		return "x86", nil
	case pe.IMAGE_FILE_MACHINE_AMD64:
		return "amd64", nil
	}
	return "", errors.New("unsupported architecture")
}
func javaCandidates() []string {
	var candidates []string
	for _, home := range []string{os.Getenv("JAVA_HOME"), os.Getenv("JRE_HOME")} {
		if home != "" {
			candidates = append(candidates, filepath.Join(home, "bin", "java.exe"))
		}
	}
	if path, err := exec.LookPath("java.exe"); err == nil {
		candidates = append(candidates, path)
	}
	candidates = append(candidates, registryJavaCandidates()...)
	bases := uniquePaths([]string{os.Getenv("ProgramFiles"), os.Getenv("ProgramW6432"), os.Getenv("ProgramFiles(x86)"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs")})
	for _, base := range bases {
		for _, vendor := range []string{"Java", "Eclipse Adoptium", "Eclipse Foundation", "Amazon Corretto", "Microsoft", "BellSoft", "Azul Systems"} {
			matches, _ := filepath.Glob(filepath.Join(base, vendor, "*", "bin", "java.exe"))
			candidates = append(candidates, matches...)
			matches, _ = filepath.Glob(filepath.Join(base, vendor, "*", "jre", "bin", "java.exe"))
			candidates = append(candidates, matches...)
		}
		candidates = append(candidates, filepath.Join(base, "Common Files", "Oracle", "Java", "javapath", "java.exe"))
	}
	return uniquePaths(candidates)
}
func javaProperties(output string) (javaRuntime, error) {
	props := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok {
			props[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	arch := props["os.arch"]
	switch strings.ToLower(arch) {
	case "amd64", "x86_64":
		arch = "amd64"
	case "x86", "i386", "i486", "i586", "i686":
		arch = "x86"
	default:
		return javaRuntime{}, errors.New("unsupported Java architecture")
	}
	majorText := strings.TrimPrefix(props["java.specification.version"], "1.")
	major, err := strconv.Atoi(majorText)
	if err != nil || major < 8 {
		return javaRuntime{}, errors.New("Java 8 or later is required")
	}
	return javaRuntime{Arch: arch, Major: major}, nil
}

type limitedBuffer struct {
	bytes.Buffer
	Limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if b.Len() < b.Limit {
		remaining := b.Limit - b.Len()
		if len(p) > remaining {
			p = p[:remaining]
		}
		b.Buffer.Write(p)
	}
	return n, nil
}
func inspectJava(path string) (javaRuntime, error) {
	if !regularFile(path) {
		return javaRuntime{}, errors.New("Java executable unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-XshowSettings:properties", "-version")
	configureHidden(cmd)
	output := &limitedBuffer{Limit: 64 * 1024}
	cmd.Stdout = output
	cmd.Stderr = output
	if err := cmd.Run(); err != nil {
		return javaRuntime{}, err
	}
	runtime, err := javaProperties(output.String())
	runtime.Path = path
	return runtime, err
}
func selectRuntime(sdk []sdkLocation, sdkProblem string, runtimes []javaRuntime) runtimeSelection {
	for _, location := range sdk {
		for _, java := range runtimes {
			if java.Arch == location.Arch {
				return runtimeSelection{Java: java, SDK: location}
			}
		}
	}
	if len(runtimes) == 0 {
		return runtimeSelection{Problem: "JAVA_NOT_FOUND"}
	}
	if len(sdk) > 0 {
		return runtimeSelection{Problem: "JAVA_ARCH_MISMATCH", SDK: sdk[0]}
	}
	if sdkProblem == "" {
		sdkProblem = "SDK_NOT_FOUND"
	}
	return runtimeSelection{Java: runtimes[0], Problem: sdkProblem}
}
func discoverRuntime() runtimeSelection {
	sdk, problem := discoverInstalledSDK()
	var runtimes []javaRuntime
	for _, candidate := range javaCandidates() {
		if java, err := inspectJava(candidate); err == nil {
			runtimes = append(runtimes, java)
		}
	}
	return selectRuntime(sdk, problem, runtimes)
}

// Arguments are passed directly to reg.exe, never through cmd.exe or PowerShell.
func registryOperations(executable string) [][]string {
	return [][]string{
		{"ADD", `HKCU\Software\Classes\jpbiometria`, "/ve", "/t", "REG_SZ", "/d", "URL:JP Biometria Protocol", "/f"},
		{"ADD", `HKCU\Software\Classes\jpbiometria`, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"},
		{"ADD", `HKCU\Software\Classes\jpbiometria\shell\open\command`, "/ve", "/t", "REG_SZ", "/d", `"` + executable + `" --start "%1"`, "/f"},
		{"ADD", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "JPBiometria", "/t", "REG_SZ", "/d", `"` + executable + `" --start`, "/f"},
	}
}
